#Requires -Version 7.0
param([Parameter(Mandatory=$true)][string]$PackRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-crosshair.ps1')
function Assert($Value,[string]$Message){if(-not $Value){throw $Message}}
function Reject([scriptblock]$Action){$failed=$false;try{& $Action|Out-Null}catch{$failed=$true};Assert $failed 'Expected rejection'}
$root=Join-Path ([IO.Path]::GetTempPath()) ('crosshair-replace-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($root)
try{
 $game=Join-Path $root 'Game';$local=Join-Path $root 'Local';$data=Join-Path $game 'FPSAimTrainer'
 foreach($dir in @('sounds','crosshairs','Saved/SaveGames')){$null=[IO.Directory]::CreateDirectory((Join-Path $data $dir))}
 $primary=Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json';[IO.File]::WriteAllText($primary,'{"sensitivity":0.91,"unrelated":true}')
 $source=Join-Path $PackRoot 'crosshairs/My-crosshair.png';$target=Join-Path $data 'crosshairs/My-crosshair.png'
 # Old bytes can be any existing asset; rollback must preserve them exactly.
 [IO.File]::WriteAllBytes($target,[byte[]](0,255,1,2,3,13,10));$before=Get-KvkHash $target;$settings=Get-KvkHash $primary
 $ctx=New-KvkContext $game $local
 $preview=New-KvkCrosshairReplacementPlan $ctx $PackRoot
 Assert ($preview.Plan.Items.Count -eq 1 -and $preview.Plan.Items[0].Action -eq 'replace') 'Expected one replacement'
 Assert ((Get-KvkHash $target) -eq $before) 'Preview wrote game'
 Reject {Invoke-KvkCrosshairReplacement $ctx $preview}
 Assert (-not [IO.Directory]::Exists($ctx.BackupRoot)) 'Unconfirmed execute wrote backups'
 $report=Invoke-KvkCrosshairReplacement $ctx $preview -Confirm
 Assert ($report.Status -eq 'completed') 'Replacement failed'
 Assert ((Get-KvkHash $target) -eq (Get-KvkHash $source)) 'Replacement bytes mismatch'
 Assert ((Get-KvkHash $primary) -eq $settings) 'Settings changed'
 $again=New-KvkCrosshairReplacementPlan $ctx $PackRoot
 Assert ((Invoke-KvkCrosshairReplacement $ctx $again -Confirm).Status -eq 'no-change') 'Identical replace not skipped'
 $restore=Invoke-KvkRestore $ctx (New-KvkRestorePlan $ctx $report.Id)
 Assert ($restore.Status -eq 'restored' -and (Get-KvkHash $target) -eq $before) 'Exact restore failed'
 $stale=New-KvkCrosshairReplacementPlan $ctx $PackRoot
 [IO.File]::WriteAllText($target,'external change');$changed=Get-KvkHash $target
 Reject {Invoke-KvkCrosshairReplacement $ctx $stale -Confirm}
 Assert ((Get-KvkHash $target) -eq $changed) 'Stale preview overwrote target'
 $tampered=Join-Path $root 'TamperedPack';Copy-Item -LiteralPath $PackRoot -Destination $tampered -Recurse
 $tamperSource=Join-Path $tampered 'crosshairs/My-crosshair.png';[IO.File]::WriteAllText($tamperSource,'corrupt')
 Reject {New-KvkCrosshairReplacementPlan $ctx $tampered}
 $extra=Join-Path $root 'ExtraPack';Copy-Item -LiteralPath $PackRoot -Destination $extra -Recurse
 [IO.File]::WriteAllText((Join-Path $extra 'PrimaryUserSettings.json'),'{}')
 Reject {New-KvkCrosshairReplacementPlan $ctx $extra}
 $metaPack=Join-Path $root 'MetadataPack';Copy-Item -LiteralPath $PackRoot -Destination $metaPack -Recurse
 $metaPreview=New-KvkCrosshairReplacementPlan $ctx $metaPack
 $metaPath=Join-Path $metaPack 'crosshair-replacement.json'
 [IO.File]::AppendAllText($metaPath,"`n")
 Reject {Invoke-KvkCrosshairReplacement $ctx $metaPreview -Confirm}
 Assert ((Get-KvkHash $target) -eq $changed) 'Metadata changes overwrote target'
 [IO.File]::Delete($target)
 Reject {New-KvkCrosshairReplacementPlan $ctx $PackRoot}
 Assert ((Get-KvkHash $primary) -eq $settings) 'Rejections changed settings'
 Write-Output 'PASS replacement preview/no-confirm/no-write, exact replace, no-change, backup restore, stale target/metadata, corrupt source, extra category and missing target guards'
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
