$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$entry = Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-config.ps1'
if (-not (Test-Path -LiteralPath $entry)) { throw 'CLI feature missing: no wizard exists to enforce confirmation and category choices.' }
. $entry
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reset-Fixture([string[]]$Answers) {
    $script:answers = New-Object 'System.Collections.Generic.Queue[string]'
    foreach ($a in $Answers) { $script:answers.Enqueue($a) }
    $script:display = New-Object 'System.Collections.Generic.List[string]'
    $script:selected = @(); $script:installCount = 0; $script:restoreCount = 0
    $script:catalogCount = 0; $script:restoreId = ''; $script:allowConflicts = $false
    $script:backups = @(); $script:conflicts = @(); $script:candidates = @('game-A')
    $script:available = @('themes','sounds','crosshairs','ui','palette','primary')
    $script:executionStatus = 'completed'; $script:planError = $false
    $script:contextRoot = ''; $script:localRoot = ''; $script:packUsed = ''
}
function Read-Host { param([string]$Prompt) $script:display.Add($Prompt); if ($script:answers.Count -eq 0) { throw "Unexpected prompt: $Prompt" }; return $script:answers.Dequeue() }
function Write-Host { param($Object, $ForegroundColor, [switch]$NoNewline) $script:display.Add([string]$Object) }
# The engine is a filesystem/process boundary; fixtures keep all real game writes out of CLI tests.
function Get-KvkGameRoot { param($Path) if ($Path -eq 'bad') { throw 'invalid game' }; return $Path }
function Get-KvkCandidates { return $script:candidates }
function New-KvkContext { param($GameRoot,$LocalDataRoot) $script:contextRoot=$GameRoot; $script:localRoot=$LocalDataRoot; return [pscustomobject]@{GameRoot=$GameRoot;LocalDataRoot=$LocalDataRoot;BackupRoot='durable-backup-location'} }
function Get-KvkCatalog { param($PackRoot) $script:catalogCount++; $script:packUsed=$PackRoot; return [pscustomobject]@{Categories=$script:available;Skipped=@('unknown.zip')} }
function New-KvkPlan { param($Context,$PackRoot,$Categories) $script:selected=@($Categories); if ($script:planError) { throw 'invalid selected JSON' }; return [pscustomobject]@{Items=@([pscustomobject]@{Source='new.ogg';Target='game-A/sounds/new.ogg';Category='sounds';BeforeHash=$null;AfterHash='abc';Action='create'},[pscustomobject]@{Source='same.json';Target='game-A/Themes/same.json';Category='themes';BeforeHash='abc';AfterHash='abc';Action='skip'});Skipped=@('unknown.zip')} }
function Invoke-KvkInstall { param($Context,$Plan) $script:installCount++; return [pscustomobject]@{Status=$script:executionStatus;Id='batch-2';Items=$Plan.Items;Errors=@()} }
function Get-KvkBackupList { param($Context) return $script:backups }
function New-KvkRestorePlan { param($Context,$Id) $script:restoreId=$Id; return [pscustomobject]@{Id=$Id;Items=@([pscustomobject]@{Target='game-A/sounds/new.ogg';Action='delete'});Conflicts=$script:conflicts} }
function Invoke-KvkRestore { param($Context,$Plan,[switch]$AllowConflicts) $script:restoreCount++;$script:allowConflicts=[bool]$AllowConflicts; return [pscustomobject]@{Status='restored';Id=$Plan.Id;Items=$Plan.Items;Errors=@()} }

# Break caught: final blank response authorizes an install, or a default setting file is selected.
Reset-Fixture @('','','','','','','')
$code = Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 2 -and $script:installCount -eq 0) 'Blank final confirmation must cancel with code 2.'
Assert (($script:selected -join ',') -eq 'themes,sounds,crosshairs') 'Default selection must include only assets.'
Assert (($script:display -join "`n") -match 'DPI' -and ($script:display -join "`n") -match 'FOV') 'Primary warning must precede its selection.'
Assert (($script:display -join "`n") -match 'game-A/sounds/new.ogg') 'Final preview must show exact affected target.'
Assert (($script:display -join "`n") -match 'durable-backup-location') 'Final preview must show durable backup directory.'
Assert ($script:localRoot -eq [Environment]::GetFolderPath('LocalApplicationData')) 'CLI must use the actual OS LocalApplicationData.'

# Break caught: opt-ins are coupled or chosen categories do not reach planning.
Reset-Fixture @('n','','','y','n','y','y')
$code = Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 0 -and $script:installCount -eq 1) 'Explicit final confirmation installs once.'
Assert (($script:selected -join ',') -eq 'sounds,crosshairs,ui,primary') 'Each extra and asset must be independently selectable.'

Reset-Fixture @('y','y')
$script:available=@('palette')
$code = Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 0 -and ($script:selected -join ',') -eq 'palette') 'Partial packs prompt only available categories.'
Assert (($script:display -join "`n") -match 'unknown.zip') 'Unknown files must be visible as skipped.'

Reset-Fixture @('q')
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 2 -and $script:installCount -eq 0) 'Q must cancel without writing.'
Reset-Fixture @()
$script:available=@()
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 1 -and $script:installCount -eq 0) 'An empty pack must fail without confirmation.'
Reset-Fixture @('n')
$script:available=@('themes')
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 2 -and $script:installCount -eq 0) 'Deselecting everything must cancel.'

# Break caught: multiple validated game candidates silently select the first.
Reset-Fixture @('2','y','y')
$script:available=@('sounds'); $script:candidates=@('game-A','game-B')
$code=Invoke-KvkCli -Mode Install -PackDir pack
Assert ($code -eq 0 -and $script:contextRoot -eq 'game-B') 'Candidate number must select the matching root.'
Reset-Fixture @('q')
$script:candidates=@('game-A','game-B')
$code=Invoke-KvkCli -Mode Install -PackDir pack
Assert ($code -eq 2 -and $script:installCount -eq 0) 'Canceling game selection must not install.'

# Break caught: a single detected game hides manual nonstandard installations.
Reset-Fixture @('','y','y')
$script:available=@('sounds')
$code=Invoke-KvkCli -Mode Install -PackDir pack
Assert ($code -eq 0 -and $script:contextRoot -eq 'game-A') 'Single candidate default confirmation must select its root.'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Reset-Fixture @('n','nonstandard game','y','y')
    $script:available=@('sounds')
    $code=Invoke-KvkCli -Mode Install -PackDir pack
    Assert ($code -eq 0 -and $script:contextRoot -eq 'nonstandard game') 'Declining the single candidate must allow manual selection.'
}

# Break caught: restore reads the source pack or chooses the wrong snapshot kind.
Reset-Fixture @('','y')
$script:backups=@([pscustomobject]@{Id='batch-2';CreatedAt='2026-09-06';Status='completed';Kind='install'})
$code=Invoke-KvkCli -Mode Restore -GameDir game-A -PackDir missing-pack
Assert ($code -eq 0 -and $script:catalogCount -eq 0 -and $script:restoreId -eq 'batch-2') 'Default restore uses latest backup independently of source pack.'
Reset-Fixture @('p','y')
$script:backups=@([pscustomobject]@{Id='batch-2';CreatedAt='2026-09-06';Status='completed';Kind='install'})
$code=Invoke-KvkCli -Mode Restore -GameDir game-A
Assert ($code -eq 0 -and $script:restoreId -eq 'pristine') 'First protection selection must use pristine.'
Reset-Fixture @('','')
$script:backups=@([pscustomobject]@{Id='batch-2';CreatedAt='2026-09-06';Status='completed';Kind='install'})
$code=Invoke-KvkCli -Mode Restore -GameDir game-A
Assert ($code -eq 2 -and $script:restoreCount -eq 0) 'Restore also requires explicit final confirmation.'

# Break caught: unresolved recovery allows a fresh install, or conflict consent is implicit.
Reset-Fixture @('')
$script:backups=@([pscustomobject]@{Id='pending-1';CreatedAt='2026-09-06';Status='applying';Kind='install'})
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 2 -and $script:installCount -eq 0 -and $script:catalogCount -eq 0) 'Pending recovery must be handled before reading the install pack.'
Reset-Fixture @('y')
$script:backups=@([pscustomobject]@{Id='pending-1';CreatedAt='2026-09-06';Status='recovery-required';Kind='install'})
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 0 -and $script:restoreId -eq 'pending-1' -and $script:installCount -eq 0) 'Pending recovery finishes this invocation without starting an install.'
Reset-Fixture @('','y','')
$script:backups=@([pscustomobject]@{Id='batch-2';CreatedAt='2026-09-06';Status='completed';Kind='install'});$script:conflicts=@('edited.ogg')
$code=Invoke-KvkCli -Mode Restore -GameDir game-A
Assert ($code -eq 2 -and $script:restoreCount -eq 0) 'Final consent alone must not allow conflict overwrite.'
Reset-Fixture @('','y','y')
$script:backups=@([pscustomobject]@{Id='batch-2';CreatedAt='2026-09-06';Status='completed';Kind='install'});$script:conflicts=@('edited.ogg')
$code=Invoke-KvkCli -Mode Restore -GameDir game-A
Assert ($code -eq 0 -and $script:allowConflicts) 'Separate conflict confirmation must be propagated.'

Reset-Fixture @('y')
$script:available=@('sounds');$script:planError=$true
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 1 -and $script:installCount -eq 0) 'Preflight errors must fail before execution.'
Reset-Fixture @('y','y')
$script:available=@('sounds');$script:executionStatus='recovery-required'
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 1) 'Incomplete recovery must return failure.'
Reset-Fixture @('y','y')
$script:available=@('sounds');$script:executionStatus='rolled-back'
$code=Invoke-KvkCli -Mode Install -GameDir game-A -PackDir pack
Assert ($code -eq 1) 'Rolled-back installation must not report success.'


# Break caught: durable engine records use State, not the preview Action property.
Reset-Fixture @()
$report=[pscustomobject]@{Status='recovery-required';Id='pending';Items=@([pscustomobject]@{Target='unfinished.ogg';State='pending'},[pscustomobject]@{Target='done.ogg';State='applied'});Errors=@('permission denied unfinished.ogg')}
Show-KvkResult -Result $report -Context ([pscustomobject]@{BackupRoot='durable-backup-location'})
Assert (($script:display -join "`n") -match '\[pending\] unfinished.ogg') 'Recovery report must show the actual per-file execution state.'
Assert (($script:display -join "`n") -match 'permission denied unfinished.ogg') 'Recovery report must preserve exact error details.'

# Break caught: manual fallback loses quoted paths, or blank input chooses a game.
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Reset-Fixture @('"manual game"','y','y')
    $script:candidates=@(); $script:available=@('sounds')
    $code=Invoke-KvkCli -Mode Install -PackDir pack
    Assert ($code -eq 0 -and $script:contextRoot -eq 'manual game') 'Typed fallback must preserve spaces and remove surrounding quotes.'
    Reset-Fixture @('')
    $script:candidates=@()
    $code=Invoke-KvkCli -Mode Install -PackDir pack
    Assert ($code -eq 2 -and $script:installCount -eq 0) 'Empty typed path must cancel.'
}

# Break caught: repository or ZIP layout resolves the pack relative to the caller cwd.
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('kvk-cli-' + [Guid]::NewGuid().ToString('N'))
try {
    $repoRuntime=Join-Path $fixtureRoot 'repo/scripts/installer'
    $repoPack=Join-Path $fixtureRoot 'repo/KVK Settings 2025'
    $distRuntime=Join-Path $fixtureRoot 'dist/scripts'
    $distPack=Join-Path $fixtureRoot 'dist/KVK Settings 2025'
    foreach ($dir in @($repoRuntime,$repoPack,$distRuntime,$distPack)) { $null=[IO.Directory]::CreateDirectory($dir) }
    Assert ((Get-KvkDefaultPack -RuntimeRoot $repoRuntime) -eq $repoPack) 'Repository pack resolution is incorrect.'
    Assert ((Get-KvkDefaultPack -RuntimeRoot $distRuntime) -eq $distPack) 'Distribution pack resolution is incorrect.'

    # Break caught: double-click invocation cannot choose a different unpacked pack.
    $savedRuntime=$script:KvkRuntimeRoot
    $script:KvkRuntimeRoot=$distRuntime
    try {
        Reset-Fixture @('','y','y')
        $script:available=@('sounds')
        $code=Invoke-KvkCli -Mode Install -GameDir game-A
        Assert ($code -eq 0 -and $script:packUsed -eq $distPack) 'Blank default-pack choice must keep bundled pack.'
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
            Reset-Fixture @('n','alternate pack','y','y')
            $script:available=@('sounds')
            $code=Invoke-KvkCli -Mode Install -GameDir game-A
            Assert ($code -eq 0 -and $script:packUsed -eq 'alternate pack') 'Declining bundled pack must offer a different directory.'
        }
    } finally { $script:KvkRuntimeRoot=$savedRuntime }

    # Launch the actual entry script against a filesystem/process-boundary engine.
    # The child uses real parameter binding, stdin prompts and process exit status.
    Copy-Item -LiteralPath $entry -Destination (Join-Path $distRuntime 'kvk-config.ps1')
    $engineText = @'
function Get-KvkGameRoot { param($Path) return $Path }
function New-KvkContext { param($GameRoot,$LocalDataRoot) return [pscustomobject]@{GameRoot=$GameRoot;LocalDataRoot=$LocalDataRoot;BackupRoot='child-backups'} }
function Get-KvkBackupList { param($Context) return @() }
function Get-KvkCatalog { param($PackRoot) return [pscustomobject]@{Categories=@('sounds');Skipped=@()} }
function New-KvkPlan { param($Context,$PackRoot,$Categories) if (($Categories -join ',') -ne 'sounds') { throw 'wrong child selection' }; return [pscustomobject]@{Items=@([pscustomobject]@{Source='child-source';Target='child-target';Category='sounds';Action='create';BeforeHash=$null;AfterHash='abc'});Skipped=@()} }
function Invoke-KvkInstall { param($Context,$Plan) return [pscustomobject]@{Status='completed';Id='child-batch';Items=$Plan.Items;Errors=@()} }
'@
    [IO.File]::WriteAllText((Join-Path $distRuntime 'kvk-engine.ps1'),$engineText,(New-Object Text.UTF8Encoding($true)))
    $powershell=(Get-Process -Id $PID).Path
    $child=Join-Path $distRuntime 'kvk-config.ps1'
    $childOutput=('y' + "`n" + 'y') | & $powershell -NoProfile -File $child -Mode Install -GameDir 'child game' -PackDir 'child pack'
    Assert ($LASTEXITCODE -eq 0 -and ($childOutput -join "`n") -match 'child-batch') 'Confirmed child entry must return success and report the installed batch.'
    $childOutput=('y' + "`n" + 'n') | & $powershell -NoProfile -File $child -Mode Install -GameDir 'child game' -PackDir 'child pack'
    Assert ($LASTEXITCODE -eq 2 -and ($childOutput -join "`n") -notmatch 'child-batch') 'Declined child entry must exit 2 without install report.'
    $childOutput=& $powershell -NoProfile -File $child -Mode Restore -GameDir 'child game' -PackDir 'missing pack'
    Assert ($LASTEXITCODE -eq 1) 'Real child entry must propagate restore-no-backup failure.'
    # Native stderr may be promoted to terminating errors by Windows PowerShell.
    $oldPreference=$ErrorActionPreference; $ErrorActionPreference='Continue'
    try {
        $childOutput=& $powershell -NoProfile -File $child -Mode Install -LocalDataRoot 'forbidden' 2>&1
        Assert ($LASTEXITCODE -ne 0) 'CLI must reject a public LocalDataRoot override.'
        $childOutput=& $powershell -NoProfile -File $child -Mode Install -Yes 2>&1
        Assert ($LASTEXITCODE -ne 0) 'CLI must reject silent confirmation bypass.'
        $childOutput=& $powershell -NoProfile -File $child -Mode Unknown 2>&1
        Assert ($LASTEXITCODE -ne 0) 'CLI must reject an invalid mode.'
    } finally { $ErrorActionPreference=$oldPreference }
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}

Microsoft.PowerShell.Utility\Write-Host 'PASS: CLI selection, confirmation, recovery routing, layout, typed fallback and native exit-code fixtures.'
