$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0

$installerRoot=Split-Path $PSScriptRoot -Parent
. (Join-Path $installerRoot 'kvk-engine.ps1')
. (Join-Path $installerRoot 'gui/kvk-gui-service.ps1')
. (Join-Path $PSScriptRoot 'helpers/gui-fixture.ps1')
function Assert($Condition,[string]$Message){if(-not $Condition){throw $Message}}

Invoke-WithKvkGuiFixture {
    param($f)
    $preview=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='p1';op='planInstall';args=@{gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=1}}
    $install=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='e1';op='execute';args=@{operationId='op1';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($install.ok -and $install.data.status -eq 'completed') 'Fixture install failed.'

    # Break caught: external edits are overwritten by ordinary restore confirmation.
    [IO.File]::WriteAllText($f.Target,'player edit',[Text.UTF8Encoding]::new($false))
    $restore=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='p2';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$install.data.batchId;revision=2}}
    Assert ($restore.ok -and $restore.data.rows[0].conflict) 'External edit was not exposed as a restore conflict.'
    $denied=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='e2';op='execute';args=@{operationId='op2';planId=$restore.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert (-not $denied.ok -and $denied.error.code -eq 'CONFLICT') 'Restore conflict executed without separate permission.'
    Assert ([IO.File]::ReadAllText($f.Target) -ceq 'player edit') 'Denied conflict restore changed target bytes.'

    # Break caught: conflict permission overwrites before preserving the edited bytes.
    $restore=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='p3';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$install.data.batchId;revision=3}}
    $allowed=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='e3';op='execute';args=@{operationId='op3';planId=$restore.data.planId;confirmation='restore';allowConflicts=$true}}
    Assert ($allowed.ok -and $allowed.data.status -eq 'restored') 'Explicit conflict restore failed.'
    Assert ([IO.File]::ReadAllText($f.Target) -ceq 'original sound') 'Restore did not recover the original bytes.'
    $ctx=New-KvkContext $f.GameRoot $f.LocalDataRoot
    $restoreManifest=Read-KvkManifest $ctx $allowed.data.batchId
    $savedEdit=Join-Path (Join-Path $ctx.BackupRoot $restoreManifest.Id) $restoreManifest.Items[0].Backup
    Assert ([IO.File]::ReadAllText($savedEdit) -ceq 'player edit') 'Conflict restore did not preserve the edited bytes first.'

    # Break caught: a pending operation is hidden and a new install can start.
    $pending=Read-KvkManifest $ctx $allowed.data.batchId
    $pending.Status='recovery-required';Save-KvkManifest $ctx $pending
    $blocked=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='p4';op='planInstall';args=@{gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=4}}
    Assert (-not $blocked.ok -and $blocked.error.code -eq 'RECOVERY_REQUIRED') 'Pending recovery did not block a fresh install preview.'
    $wrongRecovery=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='p5';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$install.data.batchId;revision=5}}
    Assert (-not $wrongRecovery.ok -and $wrongRecovery.error.code -eq 'RECOVERY_REQUIRED') 'Pending recovery allowed a different restore source.'
    $retryRecovery=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='p6';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$pending.Id;revision=6}}
    Assert ($retryRecovery.ok -and $retryRecovery.data.sourceId -eq $pending.Id) 'Pending recovery batch could not be previewed for retry.'
    $index=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='b1';op='backups';args=@{gameRoot=$f.GameRoot}}
    Assert ($index.ok -and $index.data.records[0].id -eq $pending.Id) 'Pending recovery record was not placed first.'
}

Invoke-WithKvkGuiFixture {
    param($f)
    # Create a first-touch record for a file that did not originally exist.
    $addedSource=Join-Path $f.PackRoot 'sounds/added.wav'
    Write-KvkGuiFixtureText $addedSource 'installer addition'
    $addedTarget=Join-Path $f.GameRoot 'FPSAimTrainer/sounds/added.wav'
    $preview=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='u1';op='planInstall';args=@{gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=1}}
    $install=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='u2';op='execute';args=@{operationId='u-op';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($install.ok) 'Unowned fixture install failed.'
    $ctx=New-KvkContext $f.GameRoot $f.LocalDataRoot
    Remove-Item -LiteralPath (Join-Path $ctx.BackupRoot $install.data.batchId) -Recurse -Force

    # Break caught: conflict permission also authorizes deletion without ownership history.
    $restore=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='u3';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId='pristine';revision=2}}
    $unowned=@($restore.data.rows | Where-Object {$_.key -eq 'sounds/added.wav'})[0]
    Assert ($unowned.unowned) 'Missing ownership history was not shown as unowned.'
    $denied=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='u4';op='execute';args=@{operationId='u-restore';planId=$restore.data.planId;confirmation='restore';allowConflicts=$true}}
    Assert (-not $denied.ok -and $denied.error.code -eq 'UNOWNED_FILE') 'Conflict permission authorized an unowned delete.'
    Assert ([IO.File]::ReadAllText($addedTarget) -ceq 'installer addition') 'Rejected unowned delete changed target bytes.'
}

Microsoft.PowerShell.Utility\Write-Host 'PASS: GUI recovery blocks pending work, preserves conflict bytes and refuses unowned deletion.'
