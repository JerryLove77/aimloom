#Requires -Version 7.0
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../windows/Crosshair-Test.Core.ps1')
$script:passed=0
$script:failed=0
function Assert-Test($Condition,[string]$Message) { if(-not $Condition){throw $Message} }
function Expect-Error([scriptblock]$Body,[string]$Code) {
    try { & $Body | Out-Null } catch {
        if($_.Exception.Message -notlike "*$Code*"){throw "Expected $Code; got $($_.Exception.Message)"}
        return
    }
    throw "Expected error $Code"
}
function Write-Fixture([string]$Path,[string]$Text) {
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))
}
function Hash-Fixture([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function With-Fixture([scriptblock]$Body) {
    $root=Join-Path ([IO.Path]::GetTempPath()) ('aim-helper-'+[Guid]::NewGuid().ToString('N'))
    $game=Join-Path $root 'game [literal]/FPSAimTrainer'
    $kit=Join-Path $root 'kit'
    $records=Join-Path $root 'records'
    $primary=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $original=Join-Path $game 'FPSAimTrainer/crosshairs/original.png'
    $asset='aimloom_test_abcdef123456_simple-cross.png'
    Write-Fixture $primary '{"crosshair":"original","sensitivity":42}'
    Write-Fixture (Join-Path $game 'FPSAimTrainer/Saved/SaveGames/literal [x].ini') 'keep=1'
    Write-Fixture $original 'original image fixture'
    Write-Fixture (Join-Path $kit "crosshairs/$asset") 'test image fixture'
    $manifest=@{schemaVersion=1;kitId='abcdef123456';cases=@(@{id='simple-cross';png=@{
        file="crosshairs/$asset";sha256=(Hash-Fixture (Join-Path $kit "crosshairs/$asset"));bytes=18
    }})}
    Write-Fixture (Join-Path $kit 'manifest.json') ($manifest|ConvertTo-Json -Depth 10)
    Write-Fixture (Join-Path $kit 'results.json') '{"manual":"not_run"}'
    try { & $Body ([pscustomobject]@{Root=$root;Game=$game;Kit=$kit;Records=$records;Primary=$primary;Original=$original;Asset=$asset;Manifest=$manifest}) }
    finally {if([IO.Directory]::Exists($root)){Remove-Item -LiteralPath $root -Recurse -Force}}
}
function Run-Test([string]$Name,[scriptblock]$Body) {
    try {With-Fixture $Body;$script:passed++;Write-Host "PASS $Name"}
    catch {$script:failed++;Write-Host "FAIL $Name : $($_.Exception.Message)"}
}

Run-Test 'check validates kit without changing game or manual results' {
    param($f)
    $before=Hash-Fixture $f.Primary
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records
    $check=Get-AimTestCheck $ctx
    Assert-Test ($check.kitFilesVerified -eq 1) 'kit count'
    Assert-Test ((Hash-Fixture $f.Primary) -eq $before) 'game changed'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $f.Kit 'results.json')) -eq '{"manual":"not_run"}') 'manual results changed'
}
Run-Test 'bad asset hash is rejected before records are written' {
    param($f)
    Write-Fixture (Join-Path $f.Kit "crosshairs/$($f.Asset)") 'tampered'
    Expect-Error {New-AimTestContext $f.Kit $f.Game $f.Records} 'KIT_INVALID'
    Assert-Test (-not [IO.Directory]::Exists($f.Records)) 'output created on bad kit'
}
Run-Test 'traversal in kit manifest is rejected' {
    param($f)
    $f.Manifest.cases[0].png.file='../outside.png'
    Write-Fixture (Join-Path $f.Kit 'manifest.json') ($f.Manifest|ConvertTo-Json -Depth 10)
    Expect-Error {New-AimTestContext $f.Kit $f.Game $f.Records} 'KIT_INVALID'
}
Run-Test 'output inside game and overlapping parent are rejected' {
    param($f)
    Expect-Error {New-AimTestContext $f.Kit $f.Game (Join-Path $f.Game 'records')} 'UNSAFE_PATH'
    Expect-Error {New-AimTestContext $f.Kit $f.Game $f.Root} 'UNSAFE_PATH'
}
Run-Test 'incomplete game directory is rejected' {
    param($f)
    Expect-Error {New-AimTestContext $f.Kit $f.Kit $f.Records} 'GAME_ROOT_INVALID'
}
Run-Test 'baseline preserves exact bytes including literal brackets' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records
    $result=New-AimTestBaseline $ctx
    $snap=Get-Content -LiteralPath (Join-Path $result.sessionRoot 'baseline/snapshot.json') -Raw | ConvertFrom-Json
    Assert-Test (@($snap.files).Count -eq 3) 'wrong snapshot count'
    foreach($file in $snap.files){Assert-Test ((Hash-Fixture (Join-Path $result.sessionRoot ('baseline/files/'+$file.path))) -eq $file.sha256) 'copy hash differs'}
    Assert-Test ([IO.File]::ReadAllText($f.Primary) -eq '{"crosshair":"original","sensitivity":42}') 'source changed'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $result.sessionRoot 'baseline/files/settings/literal [x].ini')) -eq 'keep=1') 'brackets treated as wildcard'
}
Run-Test 'new baseline never overwrites an existing session' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records
    $a=New-AimTestBaseline $ctx;$hash=Hash-Fixture (Join-Path $a.sessionRoot 'session.json')
    $b=New-AimTestBaseline $ctx
    Assert-Test ($a.sessionRoot -ne $b.sessionRoot) 'same session reused'
    Assert-Test ((Hash-Fixture (Join-Path $a.sessionRoot 'session.json')) -eq $hash) 'old session modified'
}
Run-Test 'baseline refuses already-installed test assets' {
    param($f)
    Write-Fixture (Join-Path $f.Game "FPSAimTrainer/crosshairs/$($f.Asset)") 'previous test'
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records
    Expect-Error {New-AimTestBaseline $ctx} 'TEST_ASSETS_PRESENT'
}
Run-Test 'running or unknown game state blocks snapshot' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records
    $original=(Get-Command Get-AimGameState).ScriptBlock
    try {
        Set-Item Function:Get-AimGameState { 'running' }
        Expect-Error {New-AimTestBaseline $ctx} 'GAME_NOT_CLOSED'
        Set-Item Function:Get-AimGameState { 'unknown' }
        Expect-Error {New-AimTestBaseline $ctx} 'GAME_NOT_CLOSED'
    } finally {Set-Item Function:Get-AimGameState $original}
}
Run-Test 'capture records changed settings and installed test asset without modifying either' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records;$base=New-AimTestBaseline $ctx
    Write-Fixture $f.Primary '{"crosshair":"test","sensitivity":42}'
    [IO.File]::Copy((Join-Path $f.Kit "crosshairs/$($f.Asset)"),(Join-Path $f.Game "FPSAimTrainer/crosshairs/$($f.Asset)"))
    $changedHash=Hash-Fixture $f.Primary
    $capture=New-AimTestCapture $ctx $base.sessionRoot 'simple-cross'
    Assert-Test (@($capture.diff.changed).Count -eq 1) 'changed settings absent'
    Assert-Test (@($capture.diff.added).Count -eq 1) 'added PNG absent'
    Assert-Test ($capture.testAssets[0].state -eq 'matches_kit') 'kit state wrong'
    Assert-Test ((Hash-Fixture $f.Primary) -eq $changedHash) 'capture changed source'
    Assert-Test ($capture.visualChecks -eq 'not_run') 'false visual pass'
}
Run-Test 'comparison detects missing and damaged originals without auto-restoring' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records;$base=New-AimTestBaseline $ctx
    [IO.File]::Delete($f.Original)
    Write-Fixture $f.Primary '{"different":true}'
    $r=Compare-AimTestRestoration $ctx $base.sessionRoot
    Assert-Test ($r.fileRestoration -eq 'needs_review') 'false restoration pass'
    Assert-Test (@($r.diff.removed).Count -eq 1) 'missing original not detected'
    Assert-Test (-not [IO.File]::Exists($f.Original)) 'script restored source'
}
Run-Test 'unchanged files match baseline but never mark visual checks passed' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records;$base=New-AimTestBaseline $ctx
    $r=Compare-AimTestRestoration $ctx $base.sessionRoot
    Assert-Test ($r.fileRestoration -eq 'matches_baseline') 'unchanged not matched'
    Assert-Test ($r.visualChecks -eq 'not_run') 'visual result was inferred'
}
Run-Test 'corrupt baseline bytes cannot produce a comparison' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records;$base=New-AimTestBaseline $ctx
    Write-Fixture (Join-Path $base.sessionRoot 'baseline/files/settings/PrimaryUserSettings.json') 'corrupt'
    Expect-Error {Compare-AimTestRestoration $ctx $base.sessionRoot} 'BASELINE_INVALID'
}
Run-Test 'wrong-kit session is rejected' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records;$base=New-AimTestBaseline $ctx
    $sessionPath=Join-Path $base.sessionRoot 'session.json'
    $s=Get-Content -LiteralPath $sessionPath -Raw|ConvertFrom-Json -AsHashtable
    $s.kitId='000000000000'
    Write-Fixture $sessionPath ($s|ConvertTo-Json -Depth 10)
    Expect-Error {New-AimTestCapture $ctx $base.sessionRoot} 'SESSION_INVALID'
}
Run-Test 'symlink source is refused before traversal' {
    param($f)
    $link=Join-Path $f.Game 'FPSAimTrainer/Saved/SaveGames/escape'
    $null=[IO.Directory]::CreateSymbolicLink($link,$f.Kit)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records
    Expect-Error {New-AimTestBaseline $ctx} 'UNSAFE_PATH'
}
Run-Test 'copy enforces the inventoried byte count before writing payload' {
    param($f)
    $target=Join-Path $f.Records 'copy.bin'
    Expect-Error {Copy-AimSnapshotFile $f.Primary $target (Hash-Fixture $f.Primary) 1} 'SOURCE_CHANGED'
    Assert-Test (-not [IO.File]::Exists($target)) 'unexpected payload copied'
}
Run-Test 'hashing enforces a byte bound before reading payload' {
    param($f)
    Expect-Error {Get-AimHash $f.Primary 1} 'LIMIT_EXCEEDED'
}

Run-Test 'missing primary settings and crosshair scope are reported' {
    param($f)
    $ctx=New-AimTestContext $f.Kit $f.Game $f.Records;$base=New-AimTestBaseline $ctx
    [IO.File]::Delete($f.Primary)
    [IO.Directory]::Delete((Join-Path $f.Game 'FPSAimTrainer/crosshairs'),$true)
    $r=Compare-AimTestRestoration $ctx $base.sessionRoot
    Assert-Test ($r.fileRestoration -eq 'needs_review') 'false restoration pass'
    Assert-Test (@($r.diff.removed).Count -eq 2) 'missing scope not reported'
}
if($IsWindows){
    Run-Test 'Windows path aliases are rejected' {
        param($f)
        Expect-Error {Assert-AimSeparate ($f.Game+'.\records') $f.Game} 'UNSAFE_PATH'
        Expect-Error {Assert-AimSeparate ('\\?\'+$f.Game+'\records') $f.Game} 'UNSAFE_PATH'
        Expect-Error {Get-AimPath 'C:\PROGRA~1\records'} 'UNSAFE_PATH'
    }
    Run-Test 'Windows command launcher checks a fixture and preserves results' {
        param($f)
        $launcher=Join-Path $PSScriptRoot '../windows/Run-Test.cmd'
        $before=Hash-Fixture (Join-Path $f.Kit 'results.json')
        $null=& $launcher -Mode Check -KitRoot $f.Kit -GameRoot $f.Game -OutputRoot $f.Records
        Assert-Test ($LASTEXITCODE -eq 0) 'launcher failed'
        Assert-Test ((Hash-Fixture (Join-Path $f.Kit 'results.json')) -eq $before) 'results changed'
    }
}

Write-Host "RESULT passed=$script:passed failed=$script:failed"
if($script:failed){exit 1}
