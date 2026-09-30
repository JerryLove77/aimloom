#Requires -Version 7.0
# Applies a saved Profile to the game as one recoverable write. Scheme and audio both write
# primary/PrimaryUserSettings.json as keyed text edits, and their key sets never overlap, so
# applying a Profile is: resolve every component's saved file reference against what is
# actually installed, merge the edit lists in order (scheme -> audio), apply them to one text,
# stage one file, and build one plan with one Item -- one batch, one backup, one rollback.
# Dot-source; importing performs no writes.
#
# A Profile (format v2) is a complete snapshot: the Theme and all six sound events are always
# written. An empty kill or spawn list writes the empty string, which is "no sound". A Profile
# has no enemy or crosshair slot, so neither is touched here.
. (Join-Path $PSScriptRoot 'kvk-scheme.ps1')
. (Join-Path $PSScriptRoot 'kvk-audio.ps1')

# Resolves a Profile-recorded path to the installed entry (a theme or a sound) it names, or
# $null if it names nothing currently installed. Comparison is by full path, case-insensitive:
# a Profile binds to an installed *file*, never to a name alone, so a rename or a duplicate
# name elsewhere in the directory cannot silently resolve to the wrong file.
function Resolve-KvkProfileReference([string]$Path,$Entries) {
    $target=$null
    try { $target=Get-KvkFullPath $Path } catch { return $null }
    foreach ($entry in @($Entries)) { if ($entry.Path -ieq $target) { return $entry } }
    return $null
}

function New-KvkProfileApplyPlan($Context,[string]$ProfileId) {
    Assert-KvkContext $Context
    $read=Get-KvkProfile $Context.LocalDataRoot $ProfileId
    $profile=$read.profile
    if ($null -eq $profile) { Throw-KvkFailure 'ENGINE_ERROR' "找不到这个 Profile：「$ProfileId」" "The Profile was not found: `"$ProfileId`"." }
    $profilePath=$read.filePath
    $profileHash=Get-KvkHash $profilePath

    # A reference that does not resolve refuses the whole application before anything is built:
    # nothing is staged and no batch is created for a Profile that names a file the game no
    # longer has.
    $installedThemes=Get-KvkInstalledThemes $Context
    $entry=Resolve-KvkProfileReference $profile.theme.path $installedThemes.Themes
    if ($null -eq $entry) { Throw-KvkFailure 'ENGINE_ERROR' "Profile 引用的背景文件不在游戏中：「$($profile.theme.path)」" "The Theme file the Profile refers to is not in the game: `"$($profile.theme.path)`"." }
    $schemeSource=Get-KvkSchemeSource $Context $entry.File

    # Every one of the six events is written. kill and spawn get exactly the recorded list (an
    # empty list clears the binding); an MBS event gets its one sound (Get-KvkAudioEdit refuses
    # anything else).
    $audioEdits=@()
    $audioSources=@()
    $installedSounds=Get-KvkInstalledSounds $Context
    foreach ($audioEventName in $script:KvkAudioEvents.Keys) {
        $records=@($profile.audio[$audioEventName])
        $names=@()
        foreach ($record in $records) {
            $entry=Resolve-KvkProfileReference $record.path $installedSounds.Sounds
            if ($null -eq $entry) { Throw-KvkFailure 'ENGINE_ERROR' "Profile 引用的音效文件不在游戏中：「$($record.path)」" "The Sound file the Profile refers to is not in the game: `"$($record.path)`"." }
            $names+=$entry.Name
            $audioSources+=[pscustomobject]@{Path=$entry.Path;Hash=(Get-KvkHash $entry.Path)}
        }
        $audioEdits+=(Get-KvkAudioEdit $Context $audioEventName ([string[]]$names))
    }

    # Merge order: scheme -> audio (in the audio adapter's own event order). The two writers' key
    # sets do not overlap, so there is exactly one edit list and exactly one Item.
    $edits=@($schemeSource.Edits)+@($audioEdits)

    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    if (-not [IO.File]::Exists($target)) { Throw-KvkFailure 'ENGINE_ERROR' '找不到 PrimaryUserSettings.json；请先启动一次游戏并正常退出。' 'PrimaryUserSettings.json was not found. Run the game once and exit normally first.' }
    $settings=Get-KvkTextFile $target
    $settingsHash=Get-KvkHash $target
    $updated=$settings.Text
    $changes=@()
    foreach ($edit in $edits) {
        $span=Find-KvkJsonValue $updated $edit.Key
        if ($null -eq $span) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少所需的键 (missing key): $($edit.Key)" "The current settings are missing a required key: $($edit.Key)." }
        $beforeText=$updated.Substring($span.KeyStart,$span.ValueEnd-$span.KeyStart)
        $next=Set-KvkJsonSetting $updated $edit.Key $edit.Value $edit.Channels
        $afterSpan=Find-KvkJsonValue $next $edit.Key
        $afterText=$next.Substring($afterSpan.KeyStart,$afterSpan.ValueEnd-$afterSpan.KeyStart)
        if ($beforeText -ceq $afterText) { continue }
        $changes+=[pscustomobject]@{Section=$edit.Section;Key=$edit.Key;BeforeText=$beforeText;AfterText=$afterText}
        $updated=$next
    }
    $newBytes=$settings.Encoding.GetPreamble()+$settings.Encoding.GetBytes($updated)
    $staged=New-KvkSettingsPreviewPlan $Context $target $settingsHash $newBytes 'profile-apply-previews' 'Profile apply staging must be outside the game directory.'
    if ($null -eq $staged) { Throw-KvkFailure 'PLAN_STALE' '准备预览期间 Profile 应用的来源发生了变化。' 'A Profile apply source changed during preview preparation.' }
    $stage=$staged.Stage;$plan=$staged.Plan

    $sources=@([pscustomobject]@{Path=$schemeSource.ThemePath;Hash=$schemeSource.ThemeHash})+@($audioSources)

    return [pscustomobject]@{ProfileId=$ProfileId;ProfilePath=$profilePath;ProfileHash=$profileHash;Sources=@($sources);
        SettingsHash=$settingsHash;Changes=@($changes);InstallerPlan=$plan}
}

function Invoke-KvkProfileApply($Context,$ApplyPlan,[scriptblock]$Observer=$null) {
    if ((Get-KvkHash $ApplyPlan.ProfilePath) -cne $ApplyPlan.ProfileHash) { Throw-KvkFailure 'PLAN_STALE' '预览之后 Profile 发生了变化，请重新核对。' 'The Profile changed after preview; review it again.' }
    foreach ($source in $ApplyPlan.Sources) {
        if ((Get-KvkHash $source.Path) -cne $source.Hash) { Throw-KvkFailure 'PLAN_STALE' '预览之后来源文件发生了变化，请重新核对。' 'A source file changed after preview; review it again.' }
    }
    # The engine still locks, rechecks every plan field, snapshots original bytes, publishes a
    # durable backup and provides rollback/restore.
    # The game must be closed: it keeps these settings in memory and rewrites the whole
    # PrimaryUserSettings.json when it exits, so a write made while it runs is lost
    # (seen on the tester's PC, 2026-09-21, with an enemy skin).
    return Invoke-KvkInstall $Context $ApplyPlan.InstallerPlan -Observer $Observer
}
