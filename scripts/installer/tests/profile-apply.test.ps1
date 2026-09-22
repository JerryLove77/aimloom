#Requires -Version 7.0
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$installerRoot=Split-Path $PSScriptRoot -Parent
$feature=Join-Path $installerRoot 'kvk-profile-apply.ps1'
if (-not [IO.File]::Exists($feature)) { throw 'MISSING FEATURE: profile apply adapter' }
. $feature
. (Join-Path $installerRoot 'gui/kvk-gui-service.ps1')
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
# $Code is the strong form: the engine's own error code, which no wording change can move.
# $Match still exists for the refusals identified by the value they name, not by a code.
# Every Throw-KvkFailure rejection also has its English checked here, so case 9 (every thrown
# message's English is English-safe) is proven by every other case's own Expect-Throw call.
function Expect-Throw([scriptblock]$Body,[string]$Match='',[string]$Code='') {
    $message=$null;$actual=$null;$messageEn=$null;$hasEn=$false
    try { & $Body | Out-Null } catch { $message=$_.Exception.Message;$actual=$_.Exception.Data['KvkCode'];$hasEn=$_.Exception.Data.Contains('KvkMessageEn');if ($hasEn) { $messageEn=$_.Exception.Data['KvkMessageEn'] } }
    Assert ($null -ne $message) 'Expected rejection'
    if ($Match) { Assert ($message -match $Match) "Wrong error: $message" }
    if ($Code) { Assert ($actual -ceq $Code) "Wrong code: $actual ($message)" }
    if ($hasEn) { Assert (Test-KvkEnglishSafe $messageEn) "English message is not English-safe: $messageEn" }
}
function Write-Text([string]$Path,[string]$Text) {
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))
}
function Info([string]$Name,[string]$Path) { return @{name=$Name;path=$Path} }

# Tab-indented like the game writes it. Carries every key the three writers own -- scheme's
# materials/sky, all six audio Sound keys, all twenty Enemy keys -- plus XSens (sensitivity)
# and a high-precision number as markers that must survive byte-identical.
$script:Settings=@'
{
	"booleanSettings":
	{
		"EBooleanSettingId::OverrideAllNewMapMaterials": false,
		"EBooleanSettingId::SolidSkyColor": false,
		"EBooleanSettingId::ShowSunInSkybox": true,
		"EBooleanSettingId::OverrideEnemyHeadColor": false,
		"EBooleanSettingId::OverrideEnemyBodyColor": false,
		"EBooleanSettingId::ChangeEnemyColorOnHit": false,
		"EBooleanSettingId::ChangeEnemyColorOnLookAt": false,
		"EBooleanSettingId::EnemyAttacksColoredByBody": false
	},
	"integerSettings":
	{
		"EIntegerSettingId::FloorMat": 0,
		"EIntegerSettingId::WallMat": 50,
		"EIntegerSettingId::SkyPreset": 6,
		"EIntegerSettingId::CloudCover": 0
	},
	"floatSettings":
	{
		"EFloatSettingId::XSens": 0.9100000262260437,
		"EFloatSettingId::WallRoughness": 1,
		"EFloatSettingId::WallMetallic": 1,
		"EFloatSettingId::WallFullBright": 0.55,
		"EFloatSettingId::WallTextureScale": 1,
		"EFloatSettingId::FloorRoughness": 0.9,
		"EFloatSettingId::FloorMetallic": 0.1,
		"EFloatSettingId::FloorFullBright": 0.4,
		"EFloatSettingId::FloorTextureScale": 1.5,
		"EFloatSettingId::CeilingRoughness": 0.8,
		"EFloatSettingId::CeilingMetallic": 0.2,
		"EFloatSettingId::CeilingFullBright": 0.3,
		"EFloatSettingId::CeilingTextureScale": 2,
		"EFloatSettingId::RampRoughness": 0.7,
		"EFloatSettingId::RampMetallic": 0.3,
		"EFloatSettingId::RampFullBright": 0.2,
		"EFloatSettingId::RampTextureScale": 0.5,
		"EFloatSettingId::EnemyRoughness": 0.5,
		"EFloatSettingId::EnemyMetalic": 0.5,
		"EFloatSettingId::EnemyFullBright": 0.25,
		"EFloatSettingId::EnemyGlowUpHead": 2,
		"EFloatSettingId::EnemyGlowUpBody": 2,
		"EFloatSettingId::EnemyGlowUpHeadOnHit": 2,
		"EFloatSettingId::EnemyGlowUpBodyOnHit": 2,
		"EFloatSettingId::EnemyGlowUpHeadOnLookAt": 2,
		"EFloatSettingId::EnemyGlowUpBodyOnLookAt": 2
	},
	"stringSettings":
	{
		"EStringSettingId::CurrentThemeName": "Old Theme",
		"EStringSettingId::WallMaterial": "DRYWALL",
		"EStringSettingId::FloorMaterial": "GRID 8",
		"EStringSettingId::CeilingMaterial": "DRYWALL",
		"EStringSettingId::RampMaterial": "DRYWALL",
		"EStringSettingId::KillConfirmedSound": "OldKill",
		"EStringSettingId::SpawnSound": "",
		"EStringSettingId::MBSGoodSound": "OldGood",
		"EStringSettingId::MBSOkaySound": "OldOkay",
		"EStringSettingId::MBSBadSound": "OldBad",
		"EStringSettingId::MBSChangeNowSound": "OldChange"
	},
	"vectorSettings":
	{
		"EVectorSettingId::WallColor": { "x": 1, "y": 1, "z": 1 },
		"EVectorSettingId::FloorColor": { "x": 0.5, "y": 0.5, "z": 0.5 },
		"EVectorSettingId::CeilingColor": { "x": 0.25, "y": 0.25, "z": 0.25 },
		"EVectorSettingId::RampColor": { "x": 0.75, "y": 0.75, "z": 0.75 },
		"EVectorSettingId::EnemyHeadColor": { "x": 0.5, "y": 0.5, "z": 0.5 },
		"EVectorSettingId::EnemyBodyColor": { "x": 0.5, "y": 0.5, "z": 0.5 },
		"EVectorSettingId::EnemyHeadColorOnHit": { "x": 0.5, "y": 0.5, "z": 0.5 },
		"EVectorSettingId::EnemyBodyColorOnHit": { "x": 0.5, "y": 0.5, "z": 0.5 },
		"EVectorSettingId::EnemyHeadColorOnLookAt": { "x": 0.5, "y": 0.5, "z": 0.5 },
		"EVectorSettingId::EnemyBodyColorOnLookAt": { "x": 0.5, "y": 0.5, "z": 0.5 }
	},
	"colorSettings":
	{
		"EColorSettingId::SkyColor": { "b": 175, "g": 155, "r": 155, "a": 255 }
	},
	"version": 1,
	"characterModelOverride": { "name": "scenario-owned" },
	"large": 9007199254740993
}
'@

# A scheme theme: every field New-KvkSchemePlan reads.
$script:ComboTheme=@'
{
	"themeName": "Combo Theme",
	"wallMaterial": "CONCRETE TILES", "wallRoughness": 0.25, "wallMetallic": 0, "wallFullBright": 0.5,
	"wallTint": { "x": 0.1, "y": 0.2, "z": 0.9 }, "wallTextureScale": 2.5,
	"floorMaterial": "WOOD PARQUET", "floorRoughness": 0.75, "floorMetallic": 0.1, "floorFullBright": 0,
	"floorTint": { "x": 0.3, "y": 0.4, "z": 0.5 }, "floorTextureScale": 3,
	"ceilingMaterial": "METAL SHEET", "ceilingRoughness": 1, "ceilingMetallic": 1, "ceilingFullBright": 0.9,
	"ceilingTint": { "x": 0.6, "y": 0.7, "z": 0.8 }, "ceilingTextureScale": 0.5,
	"rampMaterial": "PURE COLOR", "rampRoughness": 0.5, "rampMetallic": 0.5, "rampFullBright": 0.25,
	"rampTint": { "x": 0.9, "y": 0.1, "z": 0.2 }, "rampTextureScale": 1.5,
	"skyPresetId": 2, "cloudCoverId": 4, "solidSkyColor": true, "sunVisible": false,
	"skyColor": { "b": 20, "g": 30, "r": 40, "a": 255 }
}
'@

# An enemy-only theme, installed so a legacy `enemy` reference in a Profile (2026-09-21 removed
# Profile's enemy management) names a real file. New-KvkProfileApplyPlan must resolve it -- a
# legacy reference to a missing file must not refuse the apply either -- but never read its
# fields or stage anything from it: applying a Profile changes only scheme and audio keys.
$script:EnemyLookTheme=@'
{
	"themeName": "Enemy Look",
	"overrideEnemyHeadColor": true, "overrideEnemyBodyColor": true, "setEnemyBodyColorAsAttackColor": true,
	"enemyColorRoughness": 0.125, "enemyColorMetallic": 0.75, "enemyColorFullBright": 1,
	"enemyHeadColor": { "x": 1, "y": 0, "z": 0 }, "enemyHeadColorOnHit": { "x": 1, "y": 1, "z": 1 },
	"enemyHeadColorOnLookAt": { "x": 1, "y": 1, "z": 0 },
	"enemyBodyColor": { "x": 0.75, "y": 0, "z": 0 }, "enemyBodyColorOnHit": { "x": 0, "y": 1, "z": 1 },
	"enemyBodyColorOnLookAt": { "x": 0, "y": 0, "z": 1 },
	"changeEnemyColorOnHit": true, "changeEnemyColorOnLookAt": true,
	"enemyGlowUpHead": 4, "enemyGlowUpBody": 5, "enemyGlowUpHeadOnHit": 6, "enemyGlowUpBodyOnHit": 7,
	"enemyGlowUpHeadOnLookAt": 8, "enemyGlowUpBodyOnLookAt": 1.5
}
'@

$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-profile-apply-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $script:Root=$root
    $script:Game=Join-Path $root 'Game'; $script:Local=Join-Path $root 'local'
    $script:Themes=Join-Path $Game 'FPSAimTrainer/Saved/SaveGames/Themes'
    $script:Sounds=Join-Path $Game 'FPSAimTrainer/sounds'
    $script:Target=Join-Path $Game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $null=[IO.Directory]::CreateDirectory($Themes); $null=[IO.Directory]::CreateDirectory($Sounds)
    Write-Text $script:Target $script:Settings
    Write-Text (Join-Path $Themes 'Combo Theme.json') $script:ComboTheme
    Write-Text (Join-Path $Themes 'Enemy Look.json') $script:EnemyLookTheme
    Write-Text (Join-Path $Sounds 'KillA.wav') 'kill-a'
    Write-Text (Join-Path $Sounds 'KillB.ogg') 'kill-b'
    Write-Text (Join-Path $Sounds 'GoodPing.wav') 'good-ping'
    $script:Ctx=New-KvkContext $Game $Local
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'a scheme and two kill sounds by a wrong record name and one mbsGood sound merge into one plan and one write; a legacy enemy reference is accepted and ignored' {
    $before=[IO.File]::ReadAllText($Target)
    # The first kill record's own name is deliberately wrong: binding must use the installed
    # sound's real name (the file it resolves to), never the Profile's stored label.
    # `enemy` is a legacy field (a Profile no longer manages the enemy, 2026-09-21): it still
    # names a real installed theme here, and applying this Profile must neither touch any
    # Enemy* key nor be refused because of it.
    $profile=@{schemaVersion=1;id='combo';name='Combo';
        scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));
        audio=@{kill=@((Info 'not-the-real-name' (Join-Path $Sounds 'KillA.wav')),(Info 'KillB' (Join-Path $Sounds 'KillB.ogg')));spawn=@();mbsGood=@((Info 'GoodPing' (Join-Path $Sounds 'GoodPing.wav')));mbsOkay=@();mbsBad=@();mbsChangeNow=@()};
        enemy=(Info 'Enemy Look' (Join-Path $Themes 'Enemy Look.json'))}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    $apply=New-KvkProfileApplyPlan $Ctx 'combo'
    Assert ($apply.InstallerPlan.Items.Count -eq 1) 'A Profile apply must build exactly one Item'
    Assert ($apply.InstallerPlan.Items[0].Key -ceq 'primary/PrimaryUserSettings.json') 'Wrong Item key'
    Assert ([IO.File]::ReadAllText($Target) -ceq $before) 'Building the plan wrote the settings file'
    Assert (@($apply.Changes | Where-Object {$_.Key -clike '*Enemy*'}).Count -eq 0) 'The legacy enemy reference produced an Enemy* change'
    $report=Invoke-KvkProfileApply $Ctx $apply
    Assert ($report.Status -eq 'completed') "Apply failed: $($report.Errors -join '; ')"
    $after=[IO.File]::ReadAllText($Target)
    $doc=ConvertFrom-Json $after -AsHashtable
    Assert ($doc.stringSettings['EStringSettingId::CurrentThemeName'] -ceq 'Combo Theme') 'Theme name not applied'
    Assert ($doc.stringSettings['EStringSettingId::WallMaterial'] -ceq 'CONCRETE TILES') 'Scheme material not applied'
    Assert ($doc.stringSettings['EStringSettingId::KillConfirmedSound'] -ceq 'KillA;KillB') 'Kill sounds not bound in order by the installed name'
    Assert ($doc.stringSettings['EStringSettingId::MBSGoodSound'] -ceq 'GoodPing') 'mbsGood not applied'
    Assert ($doc.stringSettings['EStringSettingId::MBSOkaySound'] -ceq 'OldOkay') 'An event the Profile left empty must keep its current binding'
    # Enemy Look.json's colours and glow differ from what the settings file already has; if the
    # legacy reference were still applied, these would have changed. They must not.
    Assert ($doc.vectorSettings['EVectorSettingId::EnemyHeadColor'].x -eq 0.5 -and $doc.vectorSettings['EVectorSettingId::EnemyHeadColor'].y -eq 0.5) 'A legacy enemy reference changed the enemy head colour'
    Assert ($doc.floatSettings['EFloatSettingId::EnemyGlowUpBodyOnLookAt'] -eq 2) 'A legacy enemy reference changed enemy glow'
    # A key none of the merged components own must survive byte-identical.
    Assert ($doc.floatSettings['EFloatSettingId::XSens'] -eq 0.9100000262260437) 'Unrelated sensitivity key changed'
    Assert ($after.Contains('9007199254740993')) 'Unrelated large number lost precision'
    Assert ($after.Contains('scenario-owned')) 'Unrelated scenario-owned value changed'
    $reverted=$after
    foreach ($change in $apply.Changes) { $reverted=$reverted.Replace($change.AfterText,$change.BeforeText) }
    Assert ($reverted -ceq $before) 'Bytes outside the merged components changed'
    $batches=@(Get-KvkManifests $Ctx | Where-Object {$_.Kind -eq 'install'})
    Assert ($batches.Count -eq 1) "Exactly one backup batch must exist, found $($batches.Count)"
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored' -and [IO.File]::ReadAllText($Target) -ceq $before) 'Undo did not restore the exact original bytes'
}

Test-Case 'a Profile with only a scheme reference changes only scheme keys' {
    $profile=@{schemaVersion=1;id='scheme-only';name='Scheme Only';scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));audio=$null;enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    $apply=New-KvkProfileApplyPlan $Ctx 'scheme-only'
    Assert (@($apply.Changes | Where-Object {$_.Key -clike '*Enemy*' -or $_.Key -clike '*Sound*'}).Count -eq 0) 'A scheme-only Profile must not touch audio or enemy keys'
    Assert (@($apply.Changes | Where-Object {$_.Key -ceq 'EStringSettingId::CurrentThemeName'}).Count -eq 1) 'The scheme change is missing'
    $report=Invoke-KvkProfileApply $Ctx $apply
    Assert ($report.Status -eq 'completed') "Apply failed: $($report.Errors -join '; ')"
}

Test-Case 'a running game blocks a Profile apply and leaves the settings untouched' {
    $profile=@{schemaVersion=1;id='while-running';name='While Running';scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));audio=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    $apply=New-KvkProfileApplyPlan $Ctx 'while-running'
    $beforeRun=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Target))
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { Throw-KvkFailure 'GAME_RUNNING' 'running' 'The game is running.' }
        Expect-Throw { Invoke-KvkProfileApply $Ctx $apply } '' 'GAME_RUNNING'
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Target)) -ceq $beforeRun) 'A running game must leave the settings untouched'
}

Test-Case 'a Profile whose components all keep current has nothing to apply' {
    $profile=@{schemaVersion=1;id='nothing';name='Nothing';scheme=$null;audio=@{kill=@();spawn=@();mbsGood=@();mbsOkay=@();mbsBad=@();mbsChangeNow=@()};enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'nothing' } 'nothing|没有可应用'
    Assert (@(Get-KvkManifests $Ctx | Where-Object {$_.Kind -eq 'install'}).Count -eq 0) 'A refused apply created a batch'
    $stageRoot=Join-Path (Get-KvkDataRoot $Ctx.LocalDataRoot) 'profile-apply-previews'
    Assert (-not [IO.Directory]::Exists($stageRoot) -or @(Get-ChildItem -LiteralPath $stageRoot -Force).Count -eq 0) 'A refused apply staged files'
}

Test-Case 'a reference to a file the game no longer has refuses the whole application, naming the component and the file' {
    $beforeHash=Get-KvkHash $Target
    $missingTheme=Join-Path $Themes 'Ghost Theme.json'

    $p1=@{schemaVersion=1;id='missing-scheme';name='X';scheme=(Info 'Ghost' $missingTheme);audio=$null;enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $p1
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'missing-scheme' } 'Theme|背景'
    Assert ((Get-KvkHash $Target) -ceq $beforeHash) 'A refused scheme reference touched the settings file'

    $p3=@{schemaVersion=1;id='missing-sound';name='X';scheme=$null;audio=@{kill=@((Info 'KillA' (Join-Path $Sounds 'KillA.wav')),(Info 'Ghost' (Join-Path $Sounds 'Ghost.wav')))};enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $p3
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'missing-sound' } 'Sound|音效'
    Assert ((Get-KvkHash $Target) -ceq $beforeHash) 'A refused sound reference among several touched the settings file'

    Assert (@(Get-KvkManifests $Ctx | Where-Object {$_.Kind -eq 'install'}).Count -eq 0) 'A refused apply created a batch'
}

Test-Case 'a legacy enemy reference to a file the game no longer has does not refuse; the Profile still applies its Theme' {
    $missingTheme=Join-Path $Themes 'Ghost Theme.json'
    $profile=@{schemaVersion=1;id='legacy-enemy';name='X';scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));audio=$null;enemy=(Info 'Ghost' $missingTheme)}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    $apply=New-KvkProfileApplyPlan $Ctx 'legacy-enemy'
    Assert (@($apply.Changes | Where-Object {$_.Key -ceq 'EStringSettingId::CurrentThemeName'}).Count -eq 1) 'The scheme change is missing'
    $report=Invoke-KvkProfileApply $Ctx $apply
    Assert ($report.Status -eq 'completed') "Apply failed: $($report.Errors -join '; ')"
}

Test-Case 'a legacy enemy reference alone -- even to a missing file -- is still nothing to apply' {
    $missingTheme=Join-Path $Themes 'Ghost Theme.json'
    $profile=@{schemaVersion=1;id='enemy-only';name='X';scheme=$null;audio=$null;enemy=(Info 'Ghost' $missingTheme)}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'enemy-only' } 'nothing|没有可应用'
}

Test-Case 'a reference to a real file outside the game folder is refused the same way' {
    $outside=Join-Path $Root 'Outside Theme.json'
    Write-Text $outside $ComboTheme
    $p=@{schemaVersion=1;id='outside';name='X';scheme=(Info 'Outside' $outside);audio=$null;enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $p
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'outside' } 'Theme|背景'
}

Test-Case 'two records on a single-value audio event are refused' {
    $p=@{schemaVersion=1;id='dup-mbs';name='X';scheme=$null;audio=@{mbsGood=@((Info 'GoodPing' (Join-Path $Sounds 'GoodPing.wav')),(Info 'KillA' (Join-Path $Sounds 'KillA.wav')))};enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $p
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'dup-mbs' } 'one sound|一个音效'
}

Test-Case 'a change to the theme, the Profile or the settings file after preview is refused as stale' {
    $profile=@{schemaVersion=1;id='stale';name='X';scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));audio=$null;enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile

    $apply=New-KvkProfileApplyPlan $Ctx 'stale'
    [IO.File]::AppendAllText((Join-Path $Themes 'Combo Theme.json'),' ')
    Expect-Throw { Invoke-KvkProfileApply $Ctx $apply } '' 'PLAN_STALE'
    Write-Text (Join-Path $Themes 'Combo Theme.json') $ComboTheme

    $apply2=New-KvkProfileApplyPlan $Ctx 'stale'
    $changed=@{schemaVersion=1;id='stale';name='changed';scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));audio=$null;enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $changed
    Expect-Throw { Invoke-KvkProfileApply $Ctx $apply2 } '' 'PLAN_STALE'
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile

    $apply3=New-KvkProfileApplyPlan $Ctx 'stale'
    [IO.File]::AppendAllText($Target,' ')
    Expect-Throw { Invoke-KvkProfileApply $Ctx $apply3 } '' 'PLAN_STALE'
    Write-Text $Target $Settings
}

Test-Case 'an unfinished batch blocks a new Profile apply at the service op' {
    $profile=@{schemaVersion=1;id='guarded';name='X';scheme=(Info 'Combo Theme' (Join-Path $Themes 'Combo Theme.json'));audio=$null;enemy=$null}
    $null=Save-KvkProfile $Ctx.LocalDataRoot $profile
    $apply=New-KvkProfileApplyPlan $Ctx 'guarded'
    $report=Invoke-KvkProfileApply $Ctx $apply
    Assert ($report.Status -eq 'completed') 'Fixture apply failed'
    $pending=Read-KvkManifest $Ctx $report.Id
    # `recovery-required`, as gui-recovery.test.ps1 does: a `prepared` batch must also have every
    # item still `pending`, and the engine refuses a completed batch relabelled that way.
    $pending.Status='recovery-required';Save-KvkManifest $Ctx $pending
    $session=New-KvkGuiSession $Root $Local
    $reply=Invoke-KvkGuiRequest $session @{v=1;requestId='guard';op='planProfileApply';args=@{gameRoot=$Game;id='guarded';revision=1}}
    $got=if ($reply.ok) { 'ok' } else { [string]$reply.error.code+': '+[string]$reply.error.messageEn }
    Assert (-not $reply.ok -and $reply.error.code -ceq 'RECOVERY_REQUIRED') ('An unfinished batch did not block planProfileApply at the service op; got '+$got)
}

Test-Case 'a missing Profile is refused with an English-safe message' {
    Expect-Throw { New-KvkProfileApplyPlan $Ctx 'no-such-profile' } 'Profile|not found|找不到'
}

Write-Output "PASS profile apply: $script:Count case(s)"
