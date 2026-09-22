#Requires -Version 7.0
# Applies a saved Profile to the game as one recoverable write. Scheme and audio both write
# primary/PrimaryUserSettings.json as keyed text edits, and their key sets never overlap, so
# applying a Profile is: resolve every component's saved file reference against what is
# actually installed, merge the edit lists in order (scheme -> audio), apply them to one text,
# stage one file, and build one plan with one Item -- one batch, one backup, one rollback.
# Dot-source; importing performs no writes.
#
# A Profile no longer manages the enemy (2026-09-21): `enemy` is ACCEPTED when a Profile is read
# (a v0.1.2/early v0.1.3 file may still carry it) but is never looked at here, so a legacy
# reference -- even one pointing at a file the game no longer has -- can never refuse an apply or
# change anything. `kvk-enemy.ps1` is deliberately not dot-sourced by this file any more.
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
    $schemeSource=$null
    if ($null -ne $profile.scheme) {
        $installedThemes=Get-KvkInstalledThemes $Context
        $entry=Resolve-KvkProfileReference $profile.scheme.path $installedThemes.Themes
        if ($null -eq $entry) { Throw-KvkFailure 'ENGINE_ERROR' "Profile 引用的背景文件不在游戏中：「$($profile.scheme.path)」" "The Theme file the Profile refers to is not in the game: `"$($profile.scheme.path)`"." }
        $schemeSource=Get-KvkSchemeSource $Context $entry.File
    }

    # An empty list, and an event the Profile never recorded, both mean "keep the current
    # binding": the Profile sheet writes [] for every event the player did not touch, and native
    # empty-list behaviour has not been verified, so neither can safely clear a binding here.
    $audioEdits=@()
    $audioSources=@()
    if ($null -ne $profile.audio) {
        $installedSounds=Get-KvkInstalledSounds $Context
        foreach ($audioEventName in $script:KvkAudioEvents.Keys) {
            # `@($null)` is a one-element array, and an `if` expression that yields `@()` hands
            # back $null, not an empty array (the pipeline unrolls it). So the whole expression is
            # wrapped: an absent event (no output) and a saved `[]` both give zero records.
            # A Profile omits events it never recorded, and under StrictMode 3.0 dot access on a
            # missing key or property throws, so the event is looked up without assuming a type.
            $audioMap=$profile.audio
            $raw=$null
            if ($audioMap -is [Collections.IDictionary]) { if ($audioMap.Keys -contains $audioEventName) { $raw=$audioMap[$audioEventName] } }
            elseif ($null -ne $audioMap.PSObject.Properties[$audioEventName]) { $raw=$audioMap.PSObject.Properties[$audioEventName].Value }
            $records=@(if ($null -ne $raw) { $raw })
            if ($records.Count -eq 0) { continue }
            $names=@()
            foreach ($record in $records) {
                $entry=Resolve-KvkProfileReference $record.path $installedSounds.Sounds
                if ($null -eq $entry) { Throw-KvkFailure 'ENGINE_ERROR' "Profile 引用的音效文件不在游戏中：「$($record.path)」" "The Sound file the Profile refers to is not in the game: `"$($record.path)`"." }
                $names+=$entry.Name
                $audioSources+=[pscustomobject]@{Path=$entry.Path;Hash=(Get-KvkHash $entry.Path)}
            }
            # A single-value event with more than one resolved name is refused here, by the
            # same check New-KvkAudioPlan uses for a direct edit.
            $audioEdits+=(Get-KvkAudioEdit $Context $audioEventName ([string[]]$names))
        }
    }

    # `profile.enemy` is read past on purpose: a Profile no longer manages the enemy (2026-09-21),
    # so even a legacy reference -- one a v0.1.2/early v0.1.3 file may still carry, possibly to a
    # file the game no longer has -- contributes nothing here and can never refuse this apply.

    if ($null -eq $schemeSource -and $audioEdits.Count -eq 0) {
        Throw-KvkFailure 'ENGINE_ERROR' '这个 Profile 没有可应用的内容。' 'This Profile has nothing to apply.'
    }

    # Merge order: scheme -> audio (in the audio adapter's own event order). The two writers' key
    # sets do not overlap, so there is exactly one edit list and exactly one Item.
    $edits=@()
    if ($null -ne $schemeSource) { $edits+=@($schemeSource.Edits) }
    $edits+=@($audioEdits)

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
    $stage=Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) ('profile-apply-previews/'+[guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Profile apply staging must be outside the game directory.' }
    New-KvkDirectory $stage
    Write-KvkDurableFile (Join-Path $stage 'PrimaryUserSettings.json') $newBytes
    $plan=New-KvkPlan $Context $stage @('primary')
    if ($plan.Items.Count -ne 1 -or $plan.Items[0].Key -cne 'primary/PrimaryUserSettings.json' -or
        $plan.Items[0].AfterHash -cne (Get-KvkHash (Join-Path $stage 'PrimaryUserSettings.json')) -or
        $plan.Items[0].BeforeHash -cne $settingsHash -or $settingsHash -cne (Get-KvkHash $target)) {
        Throw-KvkFailure 'PLAN_STALE' '准备预览期间 Profile 应用的来源发生了变化。' 'A Profile apply source changed during preview preparation.'
    }

    $sources=@()
    if ($null -ne $schemeSource) { $sources+=[pscustomobject]@{Path=$schemeSource.ThemePath;Hash=$schemeSource.ThemeHash} }
    $sources+=@($audioSources)

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
