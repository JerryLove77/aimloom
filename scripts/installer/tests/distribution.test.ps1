param([Parameter(Mandatory=$true)][string]$ReleaseRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$runtime = Join-Path $ReleaseRoot 'scripts/kvk-engine.ps1'
if (-not [IO.File]::Exists($runtime)) { throw 'Distribution engine missing' }
. $runtime
function Assert-Distribution($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-DistributionFixture([string]$Path, [string]$Text) {
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('kvk-distribution-' + [Guid]::NewGuid().ToString('N'))
# macOS presents its temp root through /var -> /private/var. Exercise the real
# directory so the engine's junction/link rejection remains enabled unchanged.
if ($root.StartsWith('/var/')) { $root = '/private' + $root }
$game = Join-Path $root 'Game with spaces'
$data = Join-Path $game 'FPSAimTrainer'
$local = Join-Path $root 'local fixture'
$pack = Join-Path $ReleaseRoot 'KVK Settings 2025'
$settings = Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json'
$ui = Join-Path $data 'Saved/SaveGames/UI.json'
$palette = Join-Path $local 'FPSAimTrainer/Saved/Config/WindowsNoEditor/Palette.ini'
try {
    Write-DistributionFixture $settings '{"personalSensitivity":0.123456789012345}'
    Write-DistributionFixture $ui '{"personalUI":true}'
    Write-DistributionFixture $palette 'original palette'
    $null = [IO.Directory]::CreateDirectory((Join-Path $data 'sounds'))
    Write-DistributionFixture (Join-Path $data 'sounds/unrelated-user.wav') 'unrelated user sound'
    $ctx = New-KvkContext -GameRoot $game -LocalDataRoot $local
    $beforeHash = @{}; $beforeTime = @{}
    foreach ($p in @($settings,$ui,$palette)) {
        $beforeHash[$p] = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
        $beforeTime[$p] = [IO.File]::GetLastWriteTimeUtc($p)
    }
    Write-Host 'Distribution fixture: planning all real assets.'
    $plan = New-KvkPlan -Context $ctx -PackRoot $pack -Categories @('themes','sounds','crosshairs')
    Write-Host ('Distribution fixture: installing ' + $plan.Items.Count + ' assets.')
    $install = Invoke-KvkInstall -Context $ctx -Plan $plan
    Assert-Distribution ($install.Status -eq 'completed') ('Distribution installation failed: ' + ($install.Errors -join '; '))
    foreach ($p in @($settings,$ui,$palette)) {
        Assert-Distribution ((Get-FileHash -LiteralPath $p).Hash -eq $beforeHash[$p]) 'Default installation changed personal settings'
        Assert-Distribution ([IO.File]::GetLastWriteTimeUtc($p) -eq $beforeTime[$p]) 'Default installation changed settings timestamp'
    }
    # Derive destinations from the agreed filesystem layout, independently of engine Plan.Items.
    $verified = 0
    foreach ($map in @(
        @{Source='Themes';Destination='Saved/SaveGames/Themes';Pattern='\.json$'},
        @{Source='sounds';Destination='sounds';Pattern='\.(ogg|wav)$'},
        @{Source='crosshairs';Destination='crosshairs';Pattern='\.png$'}
    )) {
        foreach ($source in @(Get-ChildItem -LiteralPath (Join-Path $pack $map.Source) -File -Force | Where-Object { $_.Name -match $map.Pattern })) {
            $target = Join-Path (Join-Path $data $map.Destination) $source.Name
            Assert-Distribution ([IO.File]::Exists($target)) ('Missing installed asset: ' + $target)
            Assert-Distribution ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $source.FullName).Hash) ('Changed source bytes: ' + $source.Name)
            $verified++
        }
    }
    Assert-Distribution ($verified -gt 0) 'No release assets exercised'
    Write-Host 'Distribution fixture: copied bytes verified; checking repeat installation.'
    $again = Invoke-KvkInstall -Context $ctx -Plan (New-KvkPlan -Context $ctx -PackRoot $pack -Categories @('themes','sounds','crosshairs'))
    Assert-Distribution ($again.Status -eq 'no-change') 'Reinstall was not idempotent'
    Write-Host 'Distribution fixture: installing the 3 explicit opt-in settings.'
    $extras = Invoke-KvkInstall -Context $ctx -Plan (New-KvkPlan -Context $ctx -PackRoot $pack -Categories @('ui','palette','primary'))
    Assert-Distribution ($extras.Status -eq 'completed') ('Extras installation failed: ' + ($extras.Errors -join '; '))
    foreach ($pair in @(@{Source='PrimaryUserSettings.json';Target=$settings},@{Source='UI.json';Target=$ui},@{Source='Palette.ini';Target=$palette})) {
        Assert-Distribution ((Get-FileHash -LiteralPath $pair.Target).Hash -eq (Get-FileHash -LiteralPath (Join-Path $pack $pair.Source)).Hash) 'Opt-in setting copy changed original source bytes'
    }
    Write-Host 'Distribution fixture: recovering all first-touch originals.'
    $restored = Invoke-KvkRestore -Context $ctx -Plan (New-KvkRestorePlan -Context $ctx -Id 'pristine')
    Assert-Distribution ($restored.Status -eq 'restored') ('First protection recovery failed: ' + ($restored.Errors -join '; '))
    foreach ($p in @($settings,$ui,$palette)) {
        Assert-Distribution ((Get-FileHash -LiteralPath $p).Hash -eq $beforeHash[$p]) 'Pristine failed to restore exact personal bytes'
    }
    Assert-Distribution (@(Get-ChildItem -LiteralPath (Join-Path $data 'sounds') -File -Force).Count -eq 1) 'Recovery left installed sounds or deleted unrelated file'
    Assert-Distribution ([IO.File]::ReadAllText((Join-Path $data 'sounds/unrelated-user.wav')) -ceq 'unrelated user sound') 'Unrelated sound modified'
    foreach ($sub in @('Saved/SaveGames/Themes','crosshairs')) {
        $dir = Join-Path $data $sub
        if ([IO.Directory]::Exists($dir)) { Assert-Distribution (@(Get-ChildItem -LiteralPath $dir -File -Force).Count -eq 0) 'Recovery left added assets' }
    }
    Write-Host ('PASS: actual distribution ' + $verified + ' asset byte copies, independent path mappings, 3 optional settings, idempotence, expanded pristine and unrelated-file preservation. No real game directory used.')
} finally {
    if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
