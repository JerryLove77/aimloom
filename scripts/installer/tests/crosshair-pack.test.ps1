#Requires -Version 7.0
param([Parameter(Mandatory = $true)][string]$PackRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

# Supply an actual output directory from npm run crosshair:pack. This test never
# discovers a game install or uses the user's LocalApplicationData directory.
# The real game-closed guard stays active: a running game blocks this test.
if (-not $IsWindows) { throw 'Run this native integration test on Windows with PowerShell 7.' }
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-engine.ps1')
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-FixtureBytes([string]$Path, [byte[]]$Bytes) {
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllBytes($Path, $Bytes)
}
function Get-FixtureSnapshot([string]$Path) {
    $snapshot = @{}
    foreach ($file in @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force)) {
        $snapshot[[IO.Path]::GetRelativePath($Path, $file.FullName)] = Get-KvkHash $file.FullName
    }
    return $snapshot
}
function Assert-FixtureSnapshot([string]$Path, $Expected, [string]$Stage) {
    $actual = Get-FixtureSnapshot $Path
    Assert ($actual.Count -eq $Expected.Count) "$Stage`: unexpected file count in $Path"
    foreach ($name in $Expected.Keys) {
        Assert ($actual.ContainsKey($name)) "$Stage`: missing file $name"
        Assert ($actual[$name] -ceq $Expected[$name]) "$Stage`: changed bytes in $name"
    }
}

$pack = Get-KvkPackFiles $PackRoot
Assert ($pack.Items.Count -eq 1) 'Generated pack must contain exactly one native-installable file.'
$source = $pack.Items[0]
Assert ($source.Category -ceq 'crosshairs') 'The sole installable file must be a crosshair.'
Assert ([IO.Path]::GetExtension($source.Source) -ceq '.png') 'The crosshair must be a PNG.'
foreach ($name in @('manifest.json', 'preview.svg', 'SHA256SUMS.txt', 'START_HERE.txt', 'THIRD_PARTY_NOTICES.md')) {
    $path = Join-Path $pack.Root $name
    Assert ([IO.File]::Exists($path)) "Missing generated-pack artifact: $name"
    Assert ($path -in $pack.Skipped) "Pack metadata was not ignored by the catalog: $name"
}
$sourceHash = Get-KvkHash $source.Source
$packBefore = Get-FixtureSnapshot $pack.Root

# The only recursively removed directory is this uniquely allocated fixture.
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('kvk-crosshair-pack-' + [Guid]::NewGuid().ToString('N'))
Assert (-not (Test-Path -LiteralPath $fixture)) 'Unique fixture directory already exists.'
$null = [IO.Directory]::CreateDirectory($fixture)
try {
    $game = Join-Path $fixture 'Fake Game with spaces'
    $data = Join-Path $game 'FPSAimTrainer'
    $local = Join-Path $fixture 'LocalDataRoot'
    $localSettings = Join-Path $local 'FPSAimTrainer'
    Write-FixtureBytes (Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json') ([Text.Encoding]::UTF8.GetBytes('{"sensitivity":0.91}'))
    Write-FixtureBytes (Join-Path $data 'Saved/SaveGames/UI.json') ([byte[]](239,187,191,123,125,13,10))
    Write-FixtureBytes (Join-Path $data 'Saved/Config/WindowsNoEditor/GameUserSettings.ini') ([byte[]](255,254,91,0,93,0,13,0,10,0))
    Write-FixtureBytes (Join-Path $localSettings 'Saved/Config/WindowsNoEditor/Palette.ini') ([byte[]](255,254,91,0,93,0))
    Write-FixtureBytes (Join-Path $data 'sounds/original.wav') ([byte[]](82,73,70,70,0,255,13,10))
    $originalPng = Join-Path $data ('crosshairs/original_' + [Guid]::NewGuid().ToString('N') + '.png')
    Write-FixtureBytes $originalPng ([Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='))
    $gameBefore = Get-FixtureSnapshot $game
    $localBefore = Get-FixtureSnapshot $localSettings
    $context = New-KvkContext -GameRoot $game -LocalDataRoot $local
    Assert ($context.GameRoot -eq $game) 'Context escaped the fake game root.'
    Assert ($context.LocalDataRoot -eq $local) 'Context escaped the fixture LocalDataRoot.'
    $plan = New-KvkPlan $context $pack.Root @('crosshairs')
    Assert ($plan.Items.Count -eq 1) 'Install plan must contain exactly one item.'
    Assert ($plan.Items[0].Action -ceq 'create') 'Install plan must create exactly one file.'
    $target = $plan.Items[0].Target
    Assert ($target -eq (Join-Path $data $source.Key)) 'Unexpected crosshair target.'
    $installed = Invoke-KvkInstall $context $plan
    Assert ($installed.Status -ceq 'completed') ('Install failed: ' + ($installed.Errors -join ';'))
    Assert ((Get-KvkHash $target) -ceq $sourceHash) 'Installed PNG bytes differ from the generated source.'
    $gameInstalled = $gameBefore.Clone()
    $gameInstalled[[IO.Path]::GetRelativePath($game, $target)] = $sourceHash
    Assert-FixtureSnapshot $game $gameInstalled 'install'
    Assert-FixtureSnapshot $localSettings $localBefore 'install local settings'

    $repeatPlan = New-KvkPlan $context $pack.Root @('crosshairs')
    Assert ($repeatPlan.Items.Count -eq 1 -and $repeatPlan.Items[0].Action -ceq 'skip') 'Repeat plan must skip the identical PNG.'
    $repeat = Invoke-KvkInstall $context $repeatPlan
    Assert ($repeat.Status -ceq 'no-change') 'Identical reinstall must return no-change.'
    Assert-FixtureSnapshot $game $gameInstalled 'reinstall'
    Assert-FixtureSnapshot $localSettings $localBefore 'reinstall local settings'

    $restorePlan = New-KvkRestorePlan $context $installed.Id
    Assert ($restorePlan.Items.Count -eq 1 -and $restorePlan.Items[0].Action -ceq 'delete') 'Restore must remove exactly the sole addition.'
    Assert ($restorePlan.Conflicts.Count -eq 0) 'Unexpected restore conflict.'
    $restored = Invoke-KvkRestore $context $restorePlan
    Assert ($restored.Status -ceq 'restored') ('Restore failed: ' + ($restored.Errors -join ';'))
    Assert (-not [IO.File]::Exists($target)) 'Installed addition remains after restore.'
    Assert-FixtureSnapshot $game $gameBefore 'restore'
    Assert-FixtureSnapshot $localSettings $localBefore 'restore local settings'
    Assert-FixtureSnapshot $pack.Root $packBefore 'source pack'
    Write-Host ('PASS generated crosshair pack: catalog=1 create=1 exact-sha256=' + $sourceHash + ' reinstall=no-change restore=restored original-files=unchanged')
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
