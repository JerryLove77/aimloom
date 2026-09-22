#Requires -Version 7.0
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$feature=Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-scheme.ps1'
if (-not [IO.File]::Exists($feature)) { throw 'MISSING FEATURE: scheme replacement adapter' }
. $feature
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
# $Code is the strong form: the engine's own error code, which no wording change can move.
# $Match still exists for the refusals identified by the value they name, not by a code.
function Expect-Throw([scriptblock]$Body,[string]$Match='',[string]$Code='') {
    $message=$null;$actual=$null
    try { & $Body | Out-Null } catch { $message=$_.Exception.Message;$actual=$_.Exception.Data['KvkCode'] }
    Assert ($null -ne $message) 'Expected rejection'
    if ($Match) { Assert ($message -match $Match) "Wrong error: $message" }
    if ($Code) { Assert ($actual -ceq $Code) "Wrong code: $actual ($message)" }
}
function Write-Text([string]$Path,[string]$Text,[Text.Encoding]$Encoding=$null) {
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path,$Text,($Encoding ?? [Text.UTF8Encoding]::new($false)))
}
$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-scheme-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $script:Root=$root
    $game=Join-Path $root 'Game'; $local=Join-Path $root 'local'
    $script:Themes=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/Themes'
    $script:Target=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $null=[IO.Directory]::CreateDirectory($script:Themes)
    $null=[IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/sounds'))
    # Tabs and trailing newline are deliberate: the edit must preserve the file's own layout.
    $script:Original=@'
{
	"booleanSettings":
	{
		"EBooleanSettingId::OverrideAllNewMapMaterials": false,
		"EBooleanSettingId::OverrideEnemyHeadColor": true,
		"EBooleanSettingId::SolidSkyColor": false,
		"EBooleanSettingId::ShowSunInSkybox": true
	},
	"integerSettings":
	{
		"EIntegerSettingId::FloorMat": 0,
		"EIntegerSettingId::SkyPreset": 6,
		"EIntegerSettingId::CloudCover": 0,
		"EIntegerSettingId::WallMat": 50
	},
	"floatSettings":
	{
		"EFloatSettingId::XSens": 0.9100000262260437,
		"EFloatSettingId::WallRoughness": 1,
		"EFloatSettingId::WallMetallic": 1,
		"EFloatSettingId::WallFullBright": 0.55000001192092896,
		"EFloatSettingId::WallTextureScale": 1,
		"EFloatSettingId::FloorRoughness": 0.89999997615814209,
		"EFloatSettingId::FloorMetallic": 0.10000000149011612,
		"EFloatSettingId::FloorFullBright": 0.40000000596046448,
		"EFloatSettingId::FloorTextureScale": 1.5,
		"EFloatSettingId::CeilingRoughness": 0.80000001192092896,
		"EFloatSettingId::CeilingMetallic": 0.20000000298023224,
		"EFloatSettingId::CeilingFullBright": 0.30000001192092896,
		"EFloatSettingId::CeilingTextureScale": 2,
		"EFloatSettingId::RampRoughness": 0.69999998807907104,
		"EFloatSettingId::RampMetallic": 0.30000001192092896,
		"EFloatSettingId::RampFullBright": 0.20000000298023224,
		"EFloatSettingId::RampTextureScale": 0.5
	},
	"stringSettings":
	{
		"EStringSettingId::CurrentThemeName": "Old Theme",
		"EStringSettingId::WallMaterial": "DRYWALL",
		"EStringSettingId::FloorMaterial": "GRID 8",
		"EStringSettingId::CeilingMaterial": "DRYWALL",
		"EStringSettingId::RampMaterial": "DRYWALL"
	},
	"vectorSettings":
	{
		"EVectorSettingId::WallColor":
		{
			"x": 1,
			"y": 1,
			"z": 1
		},
		"EVectorSettingId::FloorColor":
		{
			"x": 0.5,
			"y": 0.5,
			"z": 0.5
		},
		"EVectorSettingId::CeilingColor":
		{
			"x": 0.25,
			"y": 0.25,
			"z": 0.25
		},
		"EVectorSettingId::RampColor":
		{
			"x": 0.75,
			"y": 0.75,
			"z": 0.75
		},
		"EVectorSettingId::EnemyBodyColor":
		{
			"x": 0,
			"y": 0,
			"z": 0
		}
	},
	"colorSettings":
	{
		"EColorSettingId::SkyColor":
		{
			"b": 175,
			"g": 155,
			"r": 155,
			"a": 255
		}
	},
	"version": 1,
	"characterModelOverride":
	{
		"name": "scenario-owned"
	},
	"large": 9007199254740993
}
'@
    Write-Text $script:Target $script:Original
    Write-Text (Join-Path $script:Themes 'Blue Room.json') (@'
{
	"themeName": "Blue Room",
	"wallMaterial": "CONCRETE TILES",
	"wallRoughness": 0.25,
	"wallMetallic": 0,
	"wallFullBright": 0.5,
	"wallTint":
	{
		"x": 0.1,
		"y": 0.2,
		"z": 0.9
	},
	"wallTextureScale": 2.5,
	"floorMaterial": "WOOD PARQUET",
	"floorRoughness": 0.75,
	"floorMetallic": 0.10000000149011612,
	"floorFullBright": 0,
	"floorTint":
	{
		"x": 0.30000001192092896,
		"y": 0.40000000596046448,
		"z": 0.5
	},
	"floorTextureScale": 3,
	"ceilingMaterial": "METAL SHEET",
	"ceilingRoughness": 1,
	"ceilingMetallic": 1,
	"ceilingFullBright": 0.89999997615814209,
	"ceilingTint":
	{
		"x": 0.6,
		"y": 0.7,
		"z": 0.8
	},
	"ceilingTextureScale": 0.5,
	"rampMaterial": "PURE COLOR",
	"rampRoughness": 0.5,
	"rampMetallic": 0.5,
	"rampFullBright": 0.25,
	"rampTint":
	{
		"x": 0.9,
		"y": 0.1,
		"z": 0.2
	},
	"rampTextureScale": 1.5,
	"overrideEnemyHeadColor": true,
	"overrideEnemyBodyColor": true,
	"enemyColorFullBright": 1,
	"enemyHeadColor":
	{
		"x": 1,
		"y": 0,
		"z": 0
	},
	"enemyBodyColor":
	{
		"x": 0,
		"y": 1,
		"z": 0
	},
	"teamGlowUpHead": 0.5,
	"enemyGlowUpHead": 0.25,
	"skyPresetId": 2,
	"cloudCoverId": 4,
	"solidSkyColor": true,
	"sunVisible": false,
	"skyColor":
	{
		"b": 20,
		"g": 30,
		"r": 40,
		"a": 255
	}
}
'@)
    $script:Ctx=New-KvkContext $game $local
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'installed themes are listed with their names, files and the current selection' {
    Write-Text (Join-Path $Themes 'Broken.json') '{ not json'
    $result=Get-KvkInstalledThemes $Ctx
    Assert ($result.Themes.Count -eq 2) 'Both theme files must be listed'
    $blue=@($result.Themes | Where-Object {$_.File -ceq 'Blue Room.json'})[0]
    Assert ($blue.Name -ceq 'Blue Room' -and $blue.Readable) 'Readable theme must expose its internal name'
    Assert ($blue.DuplicateName -eq $false) 'A unique name is not a duplicate'
    $broken=@($result.Themes | Where-Object {$_.File -ceq 'Broken.json'})[0]
    Assert (-not $broken.Readable -and $null -eq $broken.Name) 'An unreadable theme is listed but has no name'
    Assert ($result.Current -ceq 'Old Theme') 'Current theme must come from the settings file'
}

Test-Case 'a theme whose name another file also uses is refused' {
    Write-Text (Join-Path $Themes 'Copy of Blue Room.json') ([IO.File]::ReadAllText((Join-Path $Themes 'Blue Room.json')))
    Write-Text (Join-Path $Themes 'Broken.json') '{ not json'
    $result=Get-KvkInstalledThemes $Ctx
    Assert (@($result.Themes | Where-Object {$_.DuplicateName}).Count -eq 2) 'Both files share the name'
    Expect-Throw { New-KvkSchemePlan $Ctx 'Copy of Blue Room.json' } 'duplicate|Duplicate|同名|uniqu'
    Expect-Throw { New-KvkSchemePlan $Ctx 'Broken.json' } 'read|Read'
    Expect-Throw { New-KvkSchemePlan $Ctx 'Missing.json' } 'theme|Theme|file'
    Assert ([IO.File]::ReadAllText($Target) -ceq $Original) 'Rejected previews changed settings'
}

Test-Case 'preparing writes nothing, and applying changes only the scheme values' {
    $before=[IO.File]::ReadAllText($Target)
    $plan=New-KvkSchemePlan $Ctx 'Blue Room.json'
    Assert ($plan.Changes.Count -gt 0) 'A theme change must report its field changes'
    Assert ([IO.File]::ReadAllText($Target) -ceq $before) 'Preparation wrote game settings'
    Assert (@($plan.Changes | Where-Object {$_.Key -clike '*Enemy*'}).Count -eq 0) 'Enemy fields must stay outside scheme ownership'
    $report=Invoke-KvkSchemeReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') "Apply failed: $($report.Errors -join '; ')"
    $after=[IO.File]::ReadAllText($Target)
    Assert ($after -cne $before) 'Apply changed nothing'
    $doc=ConvertFrom-Json $after -AsHashtable
    Assert ($doc.stringSettings['EStringSettingId::CurrentThemeName'] -ceq 'Blue Room') 'Theme name not applied'
    Assert ($doc.stringSettings['EStringSettingId::WallMaterial'] -ceq 'CONCRETE TILES') 'Wall material not applied'
    Assert ($doc.stringSettings['EStringSettingId::FloorMaterial'] -ceq 'WOOD PARQUET') 'Floor material not applied'
    Assert ($doc.floatSettings['EFloatSettingId::WallRoughness'] -eq 0.25) 'Wall roughness not applied'
    Assert ($doc.floatSettings['EFloatSettingId::WallTextureScale'] -eq 2.5) 'Wall texture scale not applied'
    Assert ($doc.vectorSettings['EVectorSettingId::WallColor'].z -eq 0.9) 'Wall color not applied'
    Assert ($doc.integerSettings['EIntegerSettingId::SkyPreset'] -eq 2) 'Sky preset not applied'
    Assert ($doc.integerSettings['EIntegerSettingId::CloudCover'] -eq 4) 'Cloud cover not applied'
    Assert ($doc.booleanSettings['EBooleanSettingId::SolidSkyColor'] -eq $true) 'Solid sky not applied'
    Assert ($doc.booleanSettings['EBooleanSettingId::ShowSunInSkybox'] -eq $false) 'Sun visibility not applied'
    Assert ($doc.colorSettings['EColorSettingId::SkyColor'].r -eq 40) 'Sky color not applied'
    # Untouched native values, including enemy appearance and unrelated settings.
    Assert ($doc.vectorSettings['EVectorSettingId::EnemyBodyColor'].y -eq 0) 'Enemy body color changed'
    Assert ($doc.booleanSettings['EBooleanSettingId::OverrideEnemyHeadColor'] -eq $true) 'Enemy override flag changed'
    Assert ($doc.floatSettings['EFloatSettingId::XSens'] -eq 0.9100000262260437) 'Sensitivity changed'
    Assert ($after.Contains('9007199254740993')) 'Large unrelated number lost precision'
    Assert ($after.Contains('scenario-owned')) 'Scenario-owned value changed'
    # The file's own layout, key order and untouched lines must survive the edit.
    $reverted=$after
    foreach ($change in $plan.Changes) { $reverted=$reverted.Replace($change.AfterText,$change.BeforeText) }
    Assert ($reverted -ceq $before) 'Editing changed bytes outside the scheme values'
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored') 'Undo failed'
    Assert ([IO.File]::ReadAllText($Target) -ceq $before) 'Undo did not restore exact bytes'
}

Test-Case 'applying a second time reports no change, and a running game blocks the write' {
    $plan=New-KvkSchemePlan $Ctx 'Blue Room.json'
    $null=Invoke-KvkSchemeReplacement $Ctx $plan
    $again=New-KvkSchemePlan $Ctx 'Blue Room.json'
    Assert ($again.Changes.Count -eq 0) 'Reapplying the same theme must report no changes'
    Assert ((Invoke-KvkSchemeReplacement $Ctx $again).Status -eq 'no-change') 'Identical apply not skipped'
    Write-Text (Join-Path $Themes 'Green Room.json') ([IO.File]::ReadAllText((Join-Path $Themes 'Blue Room.json')).Replace('Blue Room','Green Room').Replace('WOOD PARQUET','DRYWALL'))
    $switch=New-KvkSchemePlan $Ctx 'Green Room.json'
    $beforeRun=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Target))
    # The game rewrites PrimaryUserSettings.json when it exits, so a write made while it runs is lost.
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { Throw-KvkFailure 'GAME_RUNNING' 'running' 'The game is running.' }
        Expect-Throw { Invoke-KvkSchemeReplacement $Ctx $switch } '' 'GAME_RUNNING'
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Target)) -ceq $beforeRun) 'A running game must leave the settings untouched'
}

Test-Case 'an older theme without some fields applies the fields it has and keeps the rest' {
    # Real case, 2026-09-21: 14 of 31 themes on the tester's PC have no wallTextureScale and
    # several have no ceilingMaterial; the page refused every one of them outright.
    Write-Text $Target $Original
    $before=[IO.File]::ReadAllText($Target)
    $old=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Themes 'Blue Room.json'))) -AsHashtable
    $old['themeName']='Old Format'
    foreach ($absent in @('wallTextureScale','floorTextureScale','ceilingMaterial','rampTint','skyColor')) { $null=$old.Remove($absent) }
    Write-Text (Join-Path $Themes 'Old Format.json') ($old | ConvertTo-Json -Depth 8)
    $plan=New-KvkSchemePlan $Ctx 'Old Format.json'
    $report=Invoke-KvkSchemeReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') "An older theme was refused: $($report.Errors -join '; ')"
    $was=ConvertFrom-Json $before -AsHashtable; $doc=ConvertFrom-Json ([IO.File]::ReadAllText($Target)) -AsHashtable
    Assert ($doc.stringSettings['EStringSettingId::CurrentThemeName'] -ceq 'Old Format') 'The fields it has were not applied'
    Assert ($doc.stringSettings['EStringSettingId::WallMaterial'] -ceq 'CONCRETE TILES') 'A present material was not applied'
    Assert ($doc.floatSettings['EFloatSettingId::WallTextureScale'] -eq $was.floatSettings['EFloatSettingId::WallTextureScale']) 'An absent texture scale was changed'
    Assert ($doc.stringSettings['EStringSettingId::CeilingMaterial'] -ceq $was.stringSettings['EStringSettingId::CeilingMaterial']) 'An absent material was changed'
    Assert (($doc.colorSettings['EColorSettingId::SkyColor'] | ConvertTo-Json -Compress) -ceq ($was.colorSettings['EColorSettingId::SkyColor'] | ConvertTo-Json -Compress)) 'An absent sky colour was changed'
    $null=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    # Present but malformed is still a damaged file, not an older format.
    $old['wallRoughness']='rough'
    Write-Text (Join-Path $Themes 'Old Format.json') ($old | ConvertTo-Json -Depth 8)
    Expect-Throw { New-KvkSchemePlan $Ctx 'Old Format.json' } 'wallRoughness'
    Assert ([IO.File]::ReadAllText($Target) -ceq $before) 'A refused theme wrote settings'
    [IO.File]::Delete((Join-Path $Themes 'Old Format.json'))
}

Test-Case 'a missing settings key or settings file blocks the write entirely' {
    $stripped=$Original.Replace("`t`t`"EStringSettingId::CeilingMaterial`": `"DRYWALL`",`n",'')
    Assert ($stripped -cne $Original) 'Fixture must drop a key for this case'
    Write-Text $Target $stripped
    $strippedHash=Get-KvkHash $Target
    Expect-Throw { New-KvkSchemePlan $Ctx 'Blue Room.json' } 'missing key|缺少'
    Assert ((Get-KvkHash $Target) -ceq $strippedHash) 'A missing key must leave the file untouched'
    # A file that disappears after review must stop the write rather than recreate it.
    Write-Text $Target $Original
    $plan=New-KvkSchemePlan $Ctx 'Blue Room.json'
    [IO.File]::Delete($Target)
    Expect-Throw { Invoke-KvkSchemeReplacement $Ctx $plan }
    Assert (-not [IO.File]::Exists($Target)) 'A failed apply created a settings file'
}

Test-Case 'a theme or settings change after review stops before writing' {
    $plan=New-KvkSchemePlan $Ctx 'Blue Room.json'
    Write-Text $Target ($Original+' ')
    Expect-Throw { Invoke-KvkSchemeReplacement $Ctx $plan } '' 'PLAN_STALE'
    Assert ([IO.File]::ReadAllText($Target) -ceq ($Original+' ')) 'Stale settings were overwritten'
    Write-Text $Target $Original
    $fresh=New-KvkSchemePlan $Ctx 'Blue Room.json'
    [IO.File]::AppendAllText((Join-Path $Themes 'Blue Room.json'),' ')
    Expect-Throw { Invoke-KvkSchemeReplacement $Ctx $fresh } '' 'PLAN_STALE'
    Assert ([IO.File]::ReadAllText($Target) -ceq $Original) 'Changed theme was applied'
}

Test-Case 'a UTF-16 settings file keeps its encoding and unrelated content' {
    $original16=$Original
    Write-Text $Target $original16 ([Text.UnicodeEncoding]::new($false,$true))
    $bytes=[IO.File]::ReadAllBytes($Target)
    Assert ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) 'Fixture must be UTF-16LE with BOM'
    $plan=New-KvkSchemePlan $Ctx 'Blue Room.json'
    $report=Invoke-KvkSchemeReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') 'UTF-16 apply failed'
    $after=[IO.File]::ReadAllBytes($Target)
    Assert ($after[0] -eq 0xFF -and $after[1] -eq 0xFE) 'Encoding changed to non UTF-16LE'
    $text=[Text.Encoding]::Unicode.GetString($after)
    Assert ($text.Contains('Blue Room')) 'Theme name not applied'
    $reverted=$text
    foreach ($change in $plan.Changes) { $reverted=$reverted.Replace($change.AfterText,$change.BeforeText) }
    Assert ($reverted -ceq $original16) 'UTF-16 editing changed bytes outside the scheme values'
}

Write-Output "PASS scheme replacement: $script:Count case(s)"
