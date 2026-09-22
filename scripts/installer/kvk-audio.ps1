#Requires -Version 7.0
# Audio (current sound bindings) replacement adapter. Dot-source; importing performs no writes.
# UI-independent. Reuses the engine's plan/backup/rollback path for every write.
. (Join-Path $PSScriptRoot 'kvk-engine.ps1')

# Event -> stored key. Kill and Spawn hold a ';'-separated list; the MBS events hold one value.
$script:KvkAudioEvents = [ordered]@{
    kill          = @{Key='EStringSettingId::KillConfirmedSound';  List=$true }
    spawn         = @{Key='EStringSettingId::SpawnSound';          List=$true }
    mbsGood       = @{Key='EStringSettingId::MBSGoodSound';        List=$false}
    mbsOkay       = @{Key='EStringSettingId::MBSOkaySound';        List=$false}
    mbsBad        = @{Key='EStringSettingId::MBSBadSound';         List=$false}
    mbsChangeNow  = @{Key='EStringSettingId::MBSChangeNowSound';   List=$false}
}

function Get-KvkAudioEvent([string]$Event) {
    if ($Event -isnot [string] -or -not $script:KvkAudioEvents.Contains($Event)) { Throw-KvkFailure 'ENGINE_ERROR' "不支持的音效事件 (unknown audio event): $Event" "Unknown audio event: $Event." }
    return $script:KvkAudioEvents[$Event]
}

function Get-KvkSoundsDirectory($Context) {
    Assert-KvkContext $Context
    return (Join-Path $Context.GameRoot 'FPSAimTrainer/sounds')
}

function Get-KvkInstalledSounds($Context) {
    $directory=Get-KvkSoundsDirectory $Context
    $byName=[ordered]@{}
    if ([IO.Directory]::Exists($directory)) {
        $paths=@([IO.Directory]::EnumerateFiles($directory,'*',[IO.SearchOption]::TopDirectoryOnly)) | Sort-Object
        foreach ($path in $paths) {
            $extension=[IO.Path]::GetExtension($path)
            if ($extension -inotin @('.ogg','.wav')) { continue }
            $name=[IO.Path]::GetFileNameWithoutExtension($path)
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            if (-not $byName.Contains($name)) { $byName[$name]=[pscustomobject]@{Name=$name;File=[IO.Path]::GetFileName($path);Path=$path;Ambiguous=$false} }
            else { $byName[$name].Ambiguous=$true }
        }
    }
    $sounds=@($byName.Values | Sort-Object Name)
    return [pscustomobject]@{Directory=$directory;Sounds=@($sounds)}
}

function Get-KvkAudioBindings($Context) {
    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    $bindings=[ordered]@{}
    $text=$null
    if ([IO.File]::Exists($target)) { $text=(Get-KvkTextFile $target).Text }
    foreach ($event in $script:KvkAudioEvents.Keys) {
        $names=@()
        if ($null -ne $text) {
            $span=Find-KvkJsonValue $text $script:KvkAudioEvents[$event].Key
            if ($null -ne $span -and $text[$span.ValueStart] -eq '"') {
                $stored=$text.Substring($span.ValueStart+1,($span.ValueEnd-1)-($span.ValueStart+1))
                # An empty list is stored as an empty string, so it splits to no names.
                if ($stored.Length -gt 0) { $names=@($stored.Split(';')) }
            }
        }
        $bindings[$event]=@($names)
    }
    return $bindings
}

function Get-KvkAudioEdit($Context,[string]$Event,[string[]]$Names) {
    Assert-KvkContext $Context
    $definition=Get-KvkAudioEvent $Event
    $selected=@($Names)
    $installed=Get-KvkInstalledSounds $Context
    $byName=@{}
    foreach ($sound in $installed.Sounds) { $byName[$sound.Name]=$sound }
    foreach ($name in $selected) {
        if ($name -isnot [string] -or [string]::IsNullOrWhiteSpace($name) -or $name.Contains(';') -or $name -match '[\\/:*?"<>|]' -or $name -match '[\x00-\x1f]') { Throw-KvkFailure 'ENGINE_ERROR' "音效名称无效 (invalid sound name): $name" "The sound name is not valid: `"$name`"." }
        if (-not $byName.ContainsKey($name)) { Throw-KvkFailure 'ENGINE_ERROR' "游戏 sounds 目录里没有这个音效 (sound not installed): $name" "This sound is not in the game sounds folder: `"$name`"." }
        if ($byName[$name].Ambiguous) { Throw-KvkFailure 'ENGINE_ERROR' "有多个文件同名「$name」，无法确定要绑定哪一个 (ambiguous sound name)" "Two files share the name `"$name`", so it cannot be bound." }
    }
    if (-not $definition.List -and $selected.Count -ne 1) { Throw-KvkFailure 'ENGINE_ERROR' "$Event 只能绑定一个音效 (this event takes exactly one sound)" "$Event takes exactly one sound." }
    $value=$selected -join ';'
    return [pscustomobject]@{Section='stringSettings';Key=$definition.Key;Channels=$null;Value=$value}
}

function New-KvkAudioPlan($Context,[string]$Event,[string[]]$Names) {
    $edit=Get-KvkAudioEdit $Context $Event $Names
    $selected=@($Names)
    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    if (-not [IO.File]::Exists($target)) { Throw-KvkFailure 'ENGINE_ERROR' '找不到 PrimaryUserSettings.json；请先启动一次游戏并正常退出。' 'PrimaryUserSettings.json was not found. Run the game once and exit normally first.' }
    $settings=Get-KvkTextFile $target
    $settingsHash=Get-KvkHash $target
    $span=Find-KvkJsonValue $settings.Text $edit.Key
    if ($null -eq $span) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少所需的键 (missing key): $($edit.Key)" "The current settings are missing a required key: $($edit.Key)." }
    $beforeText=$settings.Text.Substring($span.KeyStart,$span.ValueEnd-$span.KeyStart)
    $updated=Set-KvkJsonSetting $settings.Text $edit.Key $edit.Value $null
    $afterSpan=Find-KvkJsonValue $updated $edit.Key
    $afterText=$updated.Substring($afterSpan.KeyStart,$afterSpan.ValueEnd-$afterSpan.KeyStart)
    $changes=@()
    if ($beforeText -cne $afterText) {
        $changes=@([pscustomobject]@{Section='stringSettings';Key=$edit.Key;Event=$Event;Before=@((Get-KvkAudioBindings $Context)[$Event]);After=@($selected);BeforeText=$beforeText;AfterText=$afterText})
    }
    $newBytes=$settings.Encoding.GetPreamble()+$settings.Encoding.GetBytes($updated)
    $stage=Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) ('audio-previews/'+[guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Audio staging must be outside the game directory.' }
    New-KvkDirectory $stage
    Write-KvkDurableFile (Join-Path $stage 'PrimaryUserSettings.json') $newBytes
    $plan=New-KvkPlan $Context $stage @('primary')
    if ($plan.Items.Count -ne 1 -or $plan.Items[0].Key -cne 'primary/PrimaryUserSettings.json' -or
        $plan.Items[0].AfterHash -cne (Get-KvkHash (Join-Path $stage 'PrimaryUserSettings.json')) -or
        $plan.Items[0].BeforeHash -cne $settingsHash -or $settingsHash -cne (Get-KvkHash $target)) {
        Throw-KvkFailure 'PLAN_STALE' '准备预览期间音效来源发生了变化。' 'Audio source changed during preview preparation.'
    }
    return [pscustomobject]@{Event=$Event;Names=@($selected);SettingsHash=$settingsHash;Changes=@($changes);InstallerPlan=$plan}
}

function Invoke-KvkAudioReplacement($Context,$AudioPlan,[scriptblock]$Observer=$null) {
    # The engine still locks, rechecks every plan field, snapshots original bytes,
    # publishes a durable backup and provides rollback/restore.
    # The game must be closed: it keeps these settings in memory and rewrites the whole
    # PrimaryUserSettings.json when it exits, so a write made while it runs is lost
    # (seen on the tester's PC, 2026-09-21, with an enemy skin).
    return Invoke-KvkInstall $Context $AudioPlan.InstallerPlan -Observer $Observer
}
