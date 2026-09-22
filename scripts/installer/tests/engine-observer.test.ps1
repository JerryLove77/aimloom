$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$installerRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $installerRoot 'kvk-engine.ps1')
. (Join-Path $installerRoot 'gui/kvk-gui-service.ps1')
. (Join-Path $PSScriptRoot 'helpers/gui-fixture.ps1')

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

$baseline = $null
Invoke-WithKvkGuiFixture {
    param($f)
    $ctx = New-KvkContext $f.GameRoot $f.LocalDataRoot
    $installed = Invoke-KvkInstall $ctx (New-KvkPlan $ctx $f.PackRoot @('sounds'))
    $installedBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Target))
    $restored = Invoke-KvkRestore $ctx (New-KvkRestorePlan $ctx 'pristine')
    $script:baseline = [pscustomobject]@{
        InstallStatus=$installed.Status; InstalledBytes=$installedBytes
        RestoreStatus=$restored.Status; RestoredBytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Target))
    }
}

$observed = $null
Invoke-WithKvkGuiFixture {
    param($f)
    $ctx = New-KvkContext $f.GameRoot $f.LocalDataRoot
    $events = [Collections.Generic.List[object]]::new()
    $installed = Invoke-KvkInstall $ctx (New-KvkPlan $ctx $f.PackRoot @('sounds')) -Observer {
        param($event)
        $events.Add($event)
        throw 'observer failure must remain diagnostic'
    }
    $installedBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Target))
    $restored = Invoke-KvkRestore $ctx (New-KvkRestorePlan $ctx 'pristine') -Observer {
        param($event)
        $events.Add($event)
        throw 'observer failure must remain diagnostic'
    }
    $script:observed = [pscustomobject]@{
        InstallStatus=$installed.Status; InstalledBytes=$installedBytes
        RestoreStatus=$restored.Status; RestoredBytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Target))
        Names=@($events | ForEach-Object { $_.name })
    }
}

# Break caught: observer exceptions enter the transaction path or change durable bytes.
Assert ($observed.InstallStatus -eq $baseline.InstallStatus -and $observed.RestoreStatus -eq $baseline.RestoreStatus) 'Observer errors changed final engine status.'
Assert ($observed.InstalledBytes -ceq $baseline.InstalledBytes -and $observed.RestoredBytes -ceq $baseline.RestoredBytes) 'Observer errors changed installed or restored bytes.'

# Break caught: progress is synthetic and omits actual durable milestones.
foreach ($name in @('source-staging','pristine-protected','file-verified','report')) {
    Assert ($name -in $observed.Names) "Missing durable observer milestone: $name"
}
Assert ('restore-preparing' -in $observed.Names) 'Restore preparation was not observed.'

Microsoft.PowerShell.Utility\Write-Host 'PASS: observer milestones are real and observer failures do not affect install or restore transactions.'
