#Requires -Version 7.0
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$feature=Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-enemy.ps1'
if (-not [IO.File]::Exists($feature)) { throw 'MISSING FEATURE: enemy skin adapter' }
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
function Write-Bytes([string]$Path,[byte[]]$Bytes) {
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllBytes($Path,$Bytes)
}
# The block layout real KovaaK writes: CRLF line endings and tab indentation (see
# `KVK Settings 2025/PrimaryUserSettings.json`). Only the two strings named by a plan ever
# change; every other byte -- the other shapes, the tab section, the trailing settings and
# `currentlySelectedBoundingBoxType` -- must come back identical.
function New-KvkEnemyFixtureText([string]$Cylindrical='Stylized Ecto/Default',[string]$Cuboid='Ghost/Default',[string]$Spheroid='Mummy/Default') {
    $split={param($pair) $pair.Split('/',2)}
    $cyl=& $split $Cylindrical; $cub=& $split $Cuboid; $sph=& $split $Spheroid
    return "{`r`n`t`"floatSettings`":`r`n`t{`r`n`t`t`"EFloatSettingId::XSens`": 0.91`r`n`t},`r`n`t`"characterModelOverride`":`r`n`t{`r`n`t`t`"Cylindrical`":`r`n`t`t{`r`n`t`t`t`"characterModel`": `"$($cyl[0])`",`r`n`t`t`t`"characterSkin`": `"$($cyl[1])`"`r`n`t`t},`r`n`t`t`"Cuboid`":`r`n`t`t{`r`n`t`t`t`"characterModel`": `"$($cub[0])`",`r`n`t`t`t`"characterSkin`": `"$($cub[1])`"`r`n`t`t},`r`n`t`t`"Spheroid`":`r`n`t`t{`r`n`t`t`t`"characterModel`": `"$($sph[0])`",`r`n`t`t`t`"characterSkin`": `"$($sph[1])`"`r`n`t`t}`r`n`t},`r`n`t`"currentlySelectedBoundingBoxType`": `"Cuboid`",`r`n`t`"large`": 9007199254740993,`r`n`t`"stringSettings`":`r`n`t{`r`n`t`t`"unchangedDate`": `"2026-09-15T00:00:00Z`"`r`n`t}`r`n}"
}
$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-enemy-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $script:Root=$root
    $game=Join-Path $root 'Game'; $local=Join-Path $root 'local'
    $script:Target=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $script:OriginalText=New-KvkEnemyFixtureText
    $script:Original=[Text.UTF8Encoding]::new($false).GetBytes($OriginalText)
    Write-Bytes $Target $Original
    $null=[IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/sounds'))
    $script:Ctx=New-KvkContext $game $local
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'catalog has 15 rows, all humanoid, three all-shape rows' {
    $catalog=Get-KvkEnemySkinCatalog
    Assert ($catalog.Count -eq 15) "Expected 15 rows, got $($catalog.Count)"
    Assert ((@($catalog | Where-Object { $_.shapes.Count -eq 3 })).Count -eq 3) 'Expected exactly three all-shape rows'
    Assert ((@($catalog | Where-Object { $_.shapes -contains 'cylindrical' })).Count -eq 15) 'Every row supports cylindrical'
}

Test-Case 'listing reads the current pair per shape and the fixed catalog' {
    $listed=Get-KvkEnemySkins $Ctx
    Assert ($listed.Current.cylindrical.model -ceq 'Stylized Ecto' -and $listed.Current.cylindrical.skin -ceq 'Default') 'Cylindrical not read'
    Assert ($listed.Current.cuboid.model -ceq 'Ghost') 'Cuboid not read'
    Assert ($listed.Current.spheroid.model -ceq 'Mummy') 'Spheroid not read'
    Assert ($listed.Skins.Count -eq 15) 'Catalog not returned'
}

Test-Case 'a current pair outside the catalog is still listed as it is' {
    Write-Bytes $Target ([Text.UTF8Encoding]::new($false).GetBytes((New-KvkEnemyFixtureText -Cylindrical 'Pigeon/Default')))
    $listed=Get-KvkEnemySkins $Ctx
    Assert ($listed.Current.cylindrical.model -ceq 'Pigeon' -and $listed.Current.cylindrical.skin -ceq 'Default') 'Unknown pair must still be listed'
}

Test-Case 'prepare is read-only; apply changes only the two strings; undo restores exact bytes' {
    $plan=New-KvkEnemySkinPlan $Ctx 'cylindrical' 'Ghost' 'Default'
    Assert ([IO.File]::ReadAllBytes($Target) -join ',' -ceq ($Original -join ',')) 'Preparation wrote game settings'
    $report=Invoke-KvkEnemySkinReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') 'Apply failed'
    $afterBytes=[IO.File]::ReadAllBytes($Target)
    $after=[Text.Encoding]::UTF8.GetString($afterBytes)
    $doc=ConvertFrom-Json $after -AsHashtable
    Assert ($doc.characterModelOverride['Cylindrical']['characterModel'] -ceq 'Ghost') 'Model not replaced'
    Assert ($doc.characterModelOverride['Cylindrical']['characterSkin'] -ceq 'Default') 'Skin not replaced'
    Assert ($doc.characterModelOverride['Cuboid']['characterModel'] -ceq 'Ghost' -and $doc.characterModelOverride['Cuboid']['characterSkin'] -ceq 'Default') 'Cuboid changed'
    Assert ($doc.characterModelOverride['Spheroid']['characterModel'] -ceq 'Mummy') 'Spheroid changed'
    Assert ($doc.currentlySelectedBoundingBoxType -ceq 'Cuboid') 'currentlySelectedBoundingBoxType changed'
    Assert ($doc.floatSettings['EFloatSettingId::XSens'] -eq 0.91) 'Unrelated setting changed'
    Assert ($after.Contains('9007199254740993')) 'Large unrelated number lost precision'
    Assert ($after.Contains('2026-09-15T00:00:00Z')) 'Date-like string changed'
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored') 'Undo failed'
    Assert (([IO.File]::ReadAllBytes($Target) -join ',') -ceq ($Original -join ',')) 'Undo did not restore exact bytes'
}

Test-Case 'settings changing after preview stops before writes' {
    $plan=New-KvkEnemySkinPlan $Ctx 'cylindrical' 'Ghost' 'Default'
    Write-Bytes $Target ($Original+[byte[]](32))
    Expect-Throw { Invoke-KvkEnemySkinReplacement $Ctx $plan } '' 'PLAN_STALE'
    Write-Bytes $Target $Original
}

Test-Case 'a pair that is not in the catalog for this shape is refused' {
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'cylindrical' 'Does Not Exist' 'Default' } '' 'ENGINE_ERROR'
}

Test-Case 'a humanoid-only skin is refused for cuboid and spheroid' {
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'cuboid' 'Stylized Ecto' 'Default' } '' 'ENGINE_ERROR'
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'spheroid' 'Meso' 'Genji' } '' 'ENGINE_ERROR'
}

Test-Case 'a pair already equipped is refused' {
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'cylindrical' 'Stylized Ecto' 'Default' } '' 'ENGINE_ERROR'
}

Test-Case 'a missing characterModelOverride block is refused and never created' {
    Write-Bytes $Target ([Text.UTF8Encoding]::new($false).GetBytes('{"floatSettings":{"EFloatSettingId::XSens":0.91}}'))
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'cylindrical' 'Ghost' 'Default' } '' 'ENGINE_ERROR'
    Assert (([IO.File]::ReadAllText($Target)) -ceq '{"floatSettings":{"EFloatSettingId::XSens":0.91}}') 'Missing block must never be created'
}

Test-Case 'a missing shape block within an existing characterModelOverride is refused' {
    Write-Bytes $Target ([Text.UTF8Encoding]::new($false).GetBytes('{"characterModelOverride":{"Cuboid":{"characterModel":"Ghost","characterSkin":"Default"}}}'))
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'cylindrical' 'Ghost' 'Default' } '' 'ENGINE_ERROR'
}

Test-Case 'an unknown shape is refused' {
    Expect-Throw { New-KvkEnemySkinPlan $Ctx 'humanoid' 'Ghost' 'Default' } '' 'ENGINE_ERROR'
}

Test-Case 'a UTF-8 BOM settings file is read and written correctly' {
    $bomBytes=[byte[]](@(0xEF,0xBB,0xBF)+[Text.UTF8Encoding]::new($false).GetBytes($OriginalText))
    Write-Bytes $Target $bomBytes
    $listed=Get-KvkEnemySkins $Ctx
    Assert ($listed.Current.cylindrical.model -ceq 'Stylized Ecto') 'BOM file not read'
    $plan=New-KvkEnemySkinPlan $Ctx 'cuboid' 'Mummy' 'Default'
    $report=Invoke-KvkEnemySkinReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') 'Apply on BOM file failed'
    $afterBytes=[IO.File]::ReadAllBytes($Target)
    Assert ($afterBytes.Length -ge 3 -and $afterBytes[0] -eq 0xEF -and $afterBytes[1] -eq 0xBB -and $afterBytes[2] -eq 0xBF) 'BOM must be preserved'
    $doc=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($afterBytes,3,$afterBytes.Length-3)) -AsHashtable
    Assert ($doc.characterModelOverride['Cuboid']['characterModel'] -ceq 'Mummy') 'Model not replaced on BOM file'
}

Test-Case 'a running game blocks the write and leaves the settings untouched' {
    $plan=New-KvkEnemySkinPlan $Ctx 'cuboid' 'Mummy' 'Default'
    $beforeRun=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Target))
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { Throw-KvkFailure 'GAME_RUNNING' 'running' 'The game is running.' }
        Expect-Throw { Invoke-KvkEnemySkinReplacement $Ctx $plan } '' 'GAME_RUNNING'
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Target)) -ceq $beforeRun) 'A running game must leave the settings untouched'
}

Write-Host "enemy.test.ps1: $Count passed"
