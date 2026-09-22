#Requires -Version 7.0
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$feature=Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-audio.ps1'
if (-not [IO.File]::Exists($feature)) { throw 'MISSING FEATURE: audio replacement adapter' }
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
function Write-Text([string]$Path,[string]$Text) {
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))
}
$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-audio-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $script:Root=$root
    $game=Join-Path $root 'Game'; $local=Join-Path $root 'local'
    $script:Sounds=Join-Path $game 'FPSAimTrainer/sounds'
    $script:Target=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $null=[IO.Directory]::CreateDirectory($script:Sounds)
    foreach ($file in @('Bell5.ogg','spawn05.ogg','saya_kick_deeper.ogg','hit.wav','Twice.ogg','Twice.wav','notes.txt')) {
        [IO.File]::WriteAllBytes((Join-Path $script:Sounds $file), [byte[]](1,2,3,4))
    }
    # Tabs and a trailing newline are deliberate: the edit must keep the file's own layout.
    $script:Original=@'
{
	"booleanSettings":
	{
		"EBooleanSettingId::DisableSpawnSoundInPlayerFOV": false,
		"EBooleanSettingId::OverrideMBSChangeNowSound": false
	},
	"floatSettings":
	{
		"EFloatSettingId::XSens": 0.9100000262260437
	},
	"stringSettings":
	{
		"EStringSettingId::CurrentThemeName": "Old Theme",
		"EStringSettingId::KillConfirmedSound": "saya_kick_deeper;Bell5",
		"EStringSettingId::MBSBadSound": "None",
		"EStringSettingId::MBSChangeNowSound": "spawn05",
		"EStringSettingId::MBSGoodSound": "None",
		"EStringSettingId::MBSOkaySound": "None",
		"EStringSettingId::SpawnSound": ""
	},
	"version": 1,
	"large": 9007199254740993
}
'@
    Write-Text $script:Target $script:Original
    $script:Ctx=New-KvkContext $game $local
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'installed sounds are listed by name, ignoring sidecars and flagging an ambiguous name' {
    $result=Get-KvkInstalledSounds $Ctx
    $names=@($result.Sounds | ForEach-Object {$_.Name} | Sort-Object)
    Assert ($names -contains 'Bell5' -and $names -contains 'hit' -and $names -contains 'Twice') 'Playable sounds must be listed by base name'
    Assert ($names -notcontains 'notes') 'A non-audio file must not be listed'
    $twice=@($result.Sounds | Where-Object {$_.Name -ceq 'Twice'})[0]
    Assert ($twice.Ambiguous) 'Two files with one base name must be flagged'
    $bell=@($result.Sounds | Where-Object {$_.Name -ceq 'Bell5'})[0]
    Assert (-not $bell.Ambiguous -and $bell.Path.EndsWith('Bell5.ogg')) 'A unique name exposes its file'
}

Test-Case 'current bindings are read for every event, keeping list order and duplicates' {
    $bindings=Get-KvkAudioBindings $Ctx
    Assert (($bindings.kill -join ',') -ceq 'saya_kick_deeper,Bell5') 'Kill must keep its ordered list'
    Assert (@($bindings.spawn).Count -eq 0) 'An empty stored list must read as no names'
    Assert (($bindings.mbsChangeNow -join ',') -ceq 'spawn05') 'A single MBS value must read as one name'
    Assert (($bindings.mbsGood -join ',') -ceq 'None') 'The literal None value must be preserved, not normalized'
}

Test-Case 'a running game blocks the write and leaves the settings untouched' {
    $plan=New-KvkAudioPlan $Ctx 'kill' @('Bell5')
    $beforeRun=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Target))
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { Throw-KvkFailure 'GAME_RUNNING' 'running' 'The game is running.' }
        Expect-Throw { Invoke-KvkAudioReplacement $Ctx $plan } '' 'GAME_RUNNING'
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Target)) -ceq $beforeRun) 'A running game must leave the settings untouched'
}

Test-Case 'preparing writes nothing, and applying replaces only the chosen event' {
    $before=[IO.File]::ReadAllText($Target)
    $plan=New-KvkAudioPlan $Ctx 'kill' @('Bell5','Bell5','hit')
    Assert ([IO.File]::ReadAllText($Target) -ceq $before) 'Preparation wrote game settings'
    # The plan names what the event held before. This read once indexed an array by the event
    # name: silently null under StrictMode 2, a thrown Int32 conversion under the worker's 3.
    $was=@((Get-KvkAudioBindings $Ctx)['kill'])
    Assert ($was.Count -gt 0) 'The fixture must start with a kill binding'
    Assert (@($plan.Changes).Count -eq 1) 'A changed binding reports one change'
    Assert ((@($plan.Changes[0].Before) -join ';') -ceq ($was -join ';')) "The plan lost the previous binding: '$(@($plan.Changes[0].Before) -join ';')'"
    Assert ((@($plan.Changes[0].After) -join ';') -ceq 'Bell5;Bell5;hit') 'The plan lost the new binding'
    $report=Invoke-KvkAudioReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') "Apply failed: $($report.Errors -join '; ')"
    $after=[IO.File]::ReadAllText($Target)
    Assert ($after -cne $before) 'Apply changed nothing'
    $doc=ConvertFrom-Json $after -AsHashtable
    Assert ($doc.stringSettings['EStringSettingId::KillConfirmedSound'] -ceq 'Bell5;Bell5;hit') 'Duplicates and order must survive'
    Assert ($doc.stringSettings['EStringSettingId::SpawnSound'] -ceq '') 'An unrelated event changed'
    Assert ($doc.stringSettings['EStringSettingId::MBSChangeNowSound'] -ceq 'spawn05') 'An unrelated MBS event changed'
    Assert ($doc.stringSettings['EStringSettingId::CurrentThemeName'] -ceq 'Old Theme') 'The theme changed'
    Assert ($doc.floatSettings['EFloatSettingId::XSens'] -eq 0.9100000262260437) 'Sensitivity changed'
    Assert ($doc.booleanSettings['EBooleanSettingId::OverrideMBSChangeNowSound'] -eq $false) 'An override flag was written'
    Assert ($after.Contains('9007199254740993')) 'Large unrelated number lost precision'
    $reverted=$after
    foreach ($change in $plan.Changes) { $reverted=$reverted.Replace($change.AfterText,$change.BeforeText) }
    Assert ($reverted -ceq $before) 'Editing changed bytes outside the audio value'
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored') 'Undo failed'
    Assert ([IO.File]::ReadAllText($Target) -ceq $before) 'Undo did not restore exact bytes'
}

Test-Case 'clearing a list writes an empty string and an MBS event replaces its single value' {
    $stored=[IO.File]::ReadAllText($Target)
    $set=Invoke-KvkAudioReplacement $Ctx (New-KvkAudioPlan $Ctx 'spawn' @('Bell5'))
    Assert ($set.Status -eq 'completed') 'Setting spawn failed'
    Assert ((ConvertFrom-Json ([IO.File]::ReadAllText($Target)) -AsHashtable).stringSettings['EStringSettingId::SpawnSound'] -ceq 'Bell5') 'Spawn was not written'
    $clear=Invoke-KvkAudioReplacement $Ctx (New-KvkAudioPlan $Ctx 'spawn' @())
    Assert ($clear.Status -eq 'completed') 'Clearing spawn failed'
    Assert ((ConvertFrom-Json ([IO.File]::ReadAllText($Target)) -AsHashtable).stringSettings['EStringSettingId::SpawnSound'] -ceq '') 'Clearing must write an empty string'
    # The fixture already stores "" for spawn: re-writing it must be reported, not claimed as a change.
    $again=New-KvkAudioPlan $Ctx 'spawn' @()
    Assert (@($again.Changes).Count -eq 0) 'An unchanged binding must report no changes'
    Assert ((Invoke-KvkAudioReplacement $Ctx $again).Status -eq 'no-change') 'An identical binding must report no-change'
    $single=Invoke-KvkAudioReplacement $Ctx (New-KvkAudioPlan $Ctx 'mbsGood' @('hit'))
    Assert ($single.Status -eq 'completed') 'Replacing an MBS value failed'
    Assert ((ConvertFrom-Json ([IO.File]::ReadAllText($Target)) -AsHashtable).stringSettings['EStringSettingId::MBSGoodSound'] -ceq 'hit') 'The single MBS value was not written'
    Assert ($stored -cne [IO.File]::ReadAllText($Target)) 'The sequence of edits changed nothing'
}

Test-Case 'only existing, unambiguous sound names are accepted for the right event shape' {
    foreach ($bad in @(
        @{event='mbsGood';names=@('hit','Bell5')},
        @{event='mbsGood';names=@()},
        @{event='kill';names=@('missing')},
        @{event='kill';names=@('Twice')},
        @{event='kill';names=@('notes.txt')},
        @{event='shoot';names=@('hit')},
        @{event='kill';names=@('..\..\evil')},
        @{event='kill';names=@('Bell5.ogg')}
    )) {
        Expect-Throw { New-KvkAudioPlan $Ctx $bad.event $bad.names }
        Assert ([IO.File]::ReadAllText($Target) -ceq $Original) 'A rejected plan changed settings'
    }
}

Test-Case 'a missing sound key or settings file blocks the write entirely' {
    $stripped=$Original.Replace("`t`t`"EStringSettingId::MBSOkaySound`": `"None`",`n",'')
    Assert ($stripped -cne $Original) 'Fixture must drop a key for this case'
    Write-Text $Target $stripped
    $strippedHash=Get-KvkHash $Target
    Expect-Throw { New-KvkAudioPlan $Ctx 'mbsOkay' @('hit') } 'missing key|缺少'
    Assert ((Get-KvkHash $Target) -ceq $strippedHash) 'A missing key must leave the file untouched'
    Write-Text $Target $Original
    $plan=New-KvkAudioPlan $Ctx 'kill' @('hit')
    [IO.File]::Delete($Target)
    Expect-Throw { Invoke-KvkAudioReplacement $Ctx $plan }
    Assert (-not [IO.File]::Exists($Target)) 'A failed apply created a settings file'
}

Test-Case 'a settings change after review stops before writing' {
    $plan=New-KvkAudioPlan $Ctx 'kill' @('hit')
    Write-Text $Target ($Original+' ')
    Expect-Throw { Invoke-KvkAudioReplacement $Ctx $plan } '' 'PLAN_STALE'
    Assert ([IO.File]::ReadAllText($Target) -ceq ($Original+' ')) 'Stale settings were overwritten'
}

Write-Output "PASS audio replacement: $script:Count case(s)"
