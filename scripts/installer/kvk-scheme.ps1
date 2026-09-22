#Requires -Version 7.0
# Scheme (background) replacement adapter. Dot-source; importing performs no writes.
# UI-independent. Reuses the engine's plan/backup/rollback path for every write.
. (Join-Path $PSScriptRoot 'kvk-engine.ps1')

function Get-KvkThemeDirectory($Context) {
    Assert-KvkContext $Context
    return (Join-Path $Context.GameRoot 'FPSAimTrainer/Saved/SaveGames/Themes')
}

function Read-KvkThemeFile([string]$Path) {
    $file=Get-KvkTextFile $Path
    try { $theme=$file.Text | ConvertFrom-Json -AsHashtable -Depth 32 -ErrorAction Stop } catch { Throw-KvkFailure 'ENGINE_ERROR' "主题文件不是有效的 JSON: $([IO.Path]::GetFileName($Path))" "The theme file is not valid JSON: `"$([IO.Path]::GetFileName($Path))`"." }
    if ($theme -isnot [Collections.IDictionary]) { Throw-KvkFailure 'ENGINE_ERROR' "主题文件必须是一个 JSON 对象: $([IO.Path]::GetFileName($Path))" "The theme file must be a JSON object: `"$([IO.Path]::GetFileName($Path))`"." }
    $name=$theme['themeName']
    if ($name -isnot [string] -or [string]::IsNullOrWhiteSpace($name)) { Throw-KvkFailure 'ENGINE_ERROR' "主题文件缺少 themeName: $([IO.Path]::GetFileName($Path))" "The theme file has no themeName: `"$([IO.Path]::GetFileName($Path))`"." }
    return $theme
}

function Get-KvkInstalledThemes($Context) {
    $directory=Get-KvkThemeDirectory $Context
    $themes=@()
    if ([IO.Directory]::Exists($directory)) {
        $paths=@([IO.Directory]::EnumerateFiles($directory,'*.json',[IO.SearchOption]::TopDirectoryOnly)) | Sort-Object
        foreach ($path in $paths) {
            $name=$null;$readable=$false
            try { $name=(Read-KvkThemeFile $path)['themeName']; $readable=$true } catch { }
            $themes += [pscustomobject]@{Name=$name;File=[IO.Path]::GetFileName($path);Path=$path;Readable=$readable;DuplicateName=$false}
        }
    }
    $counts=@{}
    foreach ($theme in $themes) { if ($theme.Readable) { $counts[$theme.Name]=1+($counts[$theme.Name] ?? 0) } }
    foreach ($theme in $themes) { if ($theme.Readable -and $counts[$theme.Name] -gt 1) { $theme.DuplicateName=$true } }
    $current=$null
    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    if ([IO.File]::Exists($target)) {
        try {
            $text=(Get-KvkTextFile $target).Text
            $span=Find-KvkJsonValue $text 'EStringSettingId::CurrentThemeName'
            if ($null -ne $span -and $text[$span.ValueStart] -eq '"') {
                $current=$text.Substring($span.ValueStart+1,($span.ValueEnd-1)-($span.ValueStart+1))
            }
        } catch { $current=$null }
    }
    return [pscustomobject]@{Directory=$directory;Themes=@($themes);Current=$current}
}

function Assert-KvkSchemeNumber($Value,[string]$Label,[double]$Min,[double]$Max,[switch]$Integer) {
    if ($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 $Label 必须是数值" "Theme field $Label must be a number." }
    $number=[double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt $Min -or $number -gt $Max) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 $Label 超出范围 $Min..$Max" "Theme field $Label is outside the range $Min..$Max." }
    if ($Integer -and $number -ne [Math]::Floor($number)) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 $Label 必须是整数" "Theme field $Label must be a whole number." }
}

function Get-KvkSchemeEdits($Theme) {
    # A field the theme does not carry keeps the player's current value, as the Enemy page does:
    # older theme files (14 of 31 on the tester's PC) omit wallTextureScale, ceilingMaterial and
    # others, and refusing the whole file left half of a player's themes unusable. A field that IS
    # present must still be valid -- a malformed value is a damaged file, not an older format.
    $edits=@()
    $channels=@('x','y','z')
    foreach ($slot in @(@('Wall','wall'),@('Floor','floor'),@('Ceiling','ceiling'),@('Ramp','ramp'))) {
        $native=$slot[0];$lower=$slot[1]
        if ($Theme.Contains("${lower}Material")) {
            $material=$Theme["${lower}Material"]
            if ($material -isnot [string] -or [string]::IsNullOrWhiteSpace($material)) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 ${lower}Material 为空或不是文本" "Theme field ${lower}Material is empty or not text." }
            $edits += [pscustomobject]@{Section='stringSettings';Key="EStringSettingId::${native}Material";Channels=$null;Value=$material}
        }
        if ($Theme.Contains("${lower}Tint")) {
            $tint=$Theme["${lower}Tint"]
            if ($tint -isnot [Collections.IDictionary]) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 ${lower}Tint 格式不正确" "Theme field ${lower}Tint is not in the expected format." }
            foreach ($channel in $channels) { Assert-KvkSchemeNumber $tint[$channel] "${lower}Tint.$channel" 0 1 }
            $edits += [pscustomobject]@{Section='vectorSettings';Key="EVectorSettingId::${native}Color";Channels=$channels;Value=$tint}
        }
        foreach ($field in @('Roughness','Metallic','FullBright')) {
            if (-not $Theme.Contains("${lower}$field")) { continue }
            $value=$Theme["${lower}$field"]
            Assert-KvkSchemeNumber $value "${lower}$field" 0 1
            $edits += [pscustomobject]@{Section='floatSettings';Key="EFloatSettingId::${native}$field";Channels=$null;Value=[double]$value}
        }
        if ($Theme.Contains("${lower}TextureScale")) {
            Assert-KvkSchemeNumber $Theme["${lower}TextureScale"] "${lower}TextureScale" 0 ([double]::MaxValue)
            if ([double]$Theme["${lower}TextureScale"] -le 0) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 ${lower}TextureScale 必须为正数" "Theme field ${lower}TextureScale must be positive." }
            $edits += [pscustomobject]@{Section='floatSettings';Key="EFloatSettingId::${native}TextureScale";Channels=$null;Value=[double]$Theme["${lower}TextureScale"]}
        }
    }
    foreach ($integer in @(@('skyPresetId','SkyPreset',13),@('cloudCoverId','CloudCover',5))) {
        if (-not $Theme.Contains($integer[0])) { continue }
        Assert-KvkSchemeNumber $Theme[$integer[0]] $integer[0] 0 $integer[2] -Integer
        $edits += [pscustomobject]@{Section='integerSettings';Key="EIntegerSettingId::$($integer[1])";Channels=$null;Value=[long]$Theme[$integer[0]]}
    }
    foreach ($flag in @(@('solidSkyColor','SolidSkyColor'),@('sunVisible','ShowSunInSkybox'))) {
        if (-not $Theme.Contains($flag[0])) { continue }
        if ($Theme[$flag[0]] -isnot [bool]) { Throw-KvkFailure 'ENGINE_ERROR' "主题字段 $($flag[0]) 必须是布尔值" "Theme field $($flag[0]) must be a boolean." }
        $edits += [pscustomobject]@{Section='booleanSettings';Key="EBooleanSettingId::$($flag[1])";Channels=$null;Value=$Theme[$flag[0]]}
    }
    if ($Theme.Contains('skyColor')) {
        $sky=$Theme['skyColor']
        if ($sky -isnot [Collections.IDictionary]) { Throw-KvkFailure 'ENGINE_ERROR' '主题字段 skyColor 格式不正确' 'Theme field skyColor is not in the expected format.' }
        foreach ($channel in @('r','g','b','a')) { Assert-KvkSchemeNumber $sky[$channel] "skyColor.$channel" 0 255 -Integer }
        $edits += [pscustomobject]@{Section='colorSettings';Key='EColorSettingId::SkyColor';Channels=@('r','g','b','a');Value=$sky}
    }
    # The game writes these three when it applies a theme itself. The material indices
    # behind them are not derivable from theme files, so they are copied verbatim.
    $edits += [pscustomobject]@{Section='integerSettings';Key='EIntegerSettingId::WallMat';Channels=$null;Value=-1}
    $edits += [pscustomobject]@{Section='integerSettings';Key='EIntegerSettingId::FloorMat';Channels=$null;Value=-1}
    $edits += [pscustomobject]@{Section='booleanSettings';Key='EBooleanSettingId::OverrideAllNewMapMaterials';Channels=$null;Value=$true}
    return $edits
}

function Get-KvkSchemeSource($Context,[string]$FileName) {
    Assert-KvkContext $Context
    Assert-KvkFileName $FileName
    if (-not $FileName.EndsWith('.json',[StringComparison]::OrdinalIgnoreCase)) { Throw-KvkFailure 'ENGINE_ERROR' "主题文件名必须使用 .json 扩展名: $FileName" "A theme file name must use the .json extension: `"$FileName`"." }
    $installed=Get-KvkInstalledThemes $Context
    $match=@($installed.Themes | Where-Object {$_.File -ceq $FileName})
    if ($match.Count -ne 1) { Throw-KvkFailure 'ENGINE_ERROR' "找不到主题文件 (theme not found): $FileName" "Theme file not found: `"$FileName`"." }
    if (-not $match[0].Readable) { Throw-KvkFailure 'ENGINE_ERROR' "无法读取主题文件 (unreadable theme): $FileName" "The theme file could not be read: `"$FileName`"." }
    if ($match[0].DuplicateName) { Throw-KvkFailure 'ENGINE_ERROR' "多个主题文件使用同一名称「$($match[0].Name)」，无法确定要应用哪一个 (duplicate theme name)" "Several theme files use the name `"$($match[0].Name)`", so it is unclear which one to apply." }
    $themePath=$match[0].Path
    $themeHash=Get-KvkHash $themePath
    $theme=Read-KvkThemeFile $themePath
    $edits=@([pscustomobject]@{Section='stringSettings';Key='EStringSettingId::CurrentThemeName';Channels=$null;Value=[string]$theme['themeName']})+@(Get-KvkSchemeEdits $theme)
    return [pscustomobject]@{FileName=$FileName;ThemeName=[string]$theme['themeName'];ThemePath=$themePath;ThemeHash=$themeHash;Edits=@($edits)}
}

function New-KvkSchemePlan($Context,[string]$FileName) {
    $source=Get-KvkSchemeSource $Context $FileName
    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    if (-not [IO.File]::Exists($target)) { Throw-KvkFailure 'ENGINE_ERROR' '找不到 PrimaryUserSettings.json；请先启动一次游戏并正常退出。' 'PrimaryUserSettings.json was not found. Run the game once and exit normally first.' }
    $settings=Get-KvkTextFile $target
    $settingsHash=Get-KvkHash $target
    $updated=$settings.Text
    $changes=@()
    foreach ($edit in $source.Edits) {
        $span=Find-KvkJsonValue $updated $edit.Key
        if ($null -eq $span) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少所需的键 (missing key): $($edit.Key)" "The current settings are missing a required key: $($edit.Key)." }
        $beforeText=$updated.Substring($span.KeyStart,$span.ValueEnd-$span.KeyStart)
        $next=Set-KvkJsonSetting $updated $edit.Key $edit.Value $edit.Channels
        $afterSpan=Find-KvkJsonValue $next $edit.Key
        $afterText=$next.Substring($afterSpan.KeyStart,$afterSpan.ValueEnd-$afterSpan.KeyStart)
        if ($beforeText -ceq $afterText) { continue }
        $changes += [pscustomobject]@{Section=$edit.Section;Key=$edit.Key;Before=Get-KvkJsonSettingValue $settings.Text $edit.Key $edit.Channels;After=$edit.Value;BeforeText=$beforeText;AfterText=$afterText}
        $updated=$next
    }
    $newBytes=$settings.Encoding.GetPreamble()+$settings.Encoding.GetBytes($updated)
    $stage=Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) ('scheme-previews/'+[guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Scheme staging must be outside the game directory.' }
    New-KvkDirectory $stage
    Write-KvkDurableFile (Join-Path $stage 'PrimaryUserSettings.json') $newBytes
    $plan=New-KvkPlan $Context $stage @('primary')
    if ($plan.Items.Count -ne 1 -or $plan.Items[0].Key -cne 'primary/PrimaryUserSettings.json' -or
        $plan.Items[0].AfterHash -cne (Get-KvkHash (Join-Path $stage 'PrimaryUserSettings.json')) -or
        $plan.Items[0].BeforeHash -cne $settingsHash -or $settingsHash -cne (Get-KvkHash $target)) {
        Throw-KvkFailure 'PLAN_STALE' '准备预览期间背景来源发生了变化。' 'Scheme source changed during preview preparation.'
    }
    return [pscustomobject]@{FileName=$FileName;ThemeName=$source.ThemeName;ThemePath=$source.ThemePath;ThemeHash=$source.ThemeHash;
        SettingsHash=$settingsHash;StagedDir=$stage;Changes=@($changes);InstallerPlan=$plan}
}

function Invoke-KvkSchemeReplacement($Context,$SchemePlan,[scriptblock]$Observer=$null) {
    if ((Get-KvkHash $SchemePlan.ThemePath) -cne $SchemePlan.ThemeHash) { Throw-KvkFailure 'PLAN_STALE' '预览之后主题文件发生了变化，请重新核对。' 'The theme file changed after preview; review it again.' }
    # The engine still locks, rechecks every plan field, snapshots original bytes,
    # publishes a durable backup and provides rollback/restore.
    # The game must be closed: it keeps these settings in memory and rewrites the whole
    # PrimaryUserSettings.json when it exits, so a write made while it runs is lost
    # (seen on the tester's PC, 2026-09-21, with an enemy skin).
    return Invoke-KvkInstall $Context $SchemePlan.InstallerPlan -Observer $Observer
}
