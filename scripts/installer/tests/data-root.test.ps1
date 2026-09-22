#Requires -Version 7.0
# The data folder under %LOCALAPPDATA% was renamed KovaaKConfigInstaller -> Aimloom. It holds the
# permanent first-protection records, so the one rule is: data is never split across two folders.
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-import.ps1')
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$utf8=[Text.UTF8Encoding]::new($false)

$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-dataroot-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $script:Game=Join-Path $root 'Game'; $script:Local=Join-Path $root 'local'
    $script:Sounds=Join-Path $script:Game 'FPSAimTrainer/sounds'
    foreach ($dir in @($script:Sounds,(Join-Path $script:Game 'FPSAimTrainer/Saved/SaveGames/Themes'),(Join-Path $script:Game 'FPSAimTrainer/crosshairs'),$script:Local)) { $null=[IO.Directory]::CreateDirectory($dir) }
    [IO.File]::WriteAllText((Join-Path $script:Game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'),'{"stringSettings":{}}',$utf8)
    $script:New=Join-Path $script:Local 'Aimloom'; $script:Old=Join-Path $script:Local 'KovaaKConfigInstaller'
    Clear-KvkDataRootMemo
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Clear-KvkDataRootMemo; Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'a fresh machine uses Aimloom, and resolving creates nothing' {
    Assert ((Get-KvkDataRoot $Local) -ceq $New) 'A fresh machine must use the Aimloom folder'
    Assert (-not [IO.Directory]::Exists($New) -and -not [IO.Directory]::Exists($Old)) 'Resolving the folder must not create one'
}

Test-Case 'an existing KovaaKConfigInstaller folder is renamed once, with its contents' {
    $null=[IO.Directory]::CreateDirectory((Join-Path $Old 'backups/abc/pristine'))
    [IO.File]::WriteAllBytes((Join-Path $Old 'backups/abc/pristine/manifest.json'),[byte[]](1,2,3,250))
    Assert ((Get-KvkDataRoot $Local) -ceq $New) 'The old folder must be adopted under the new name'
    Assert (-not [IO.Directory]::Exists($Old)) 'The old folder must be gone: renamed, not copied'
    $bytes=[IO.File]::ReadAllBytes((Join-Path $New 'backups/abc/pristine/manifest.json'))
    Assert (($bytes -join ',') -ceq '1,2,3,250') 'The contents must arrive unchanged'
    Assert ((Get-KvkDataRoot $Local) -ceq $New) 'A second resolve must agree'
}

Test-Case 'when both folders exist Aimloom wins and the old one is left alone' {
    $null=[IO.Directory]::CreateDirectory((Join-Path $New 'backups')); $null=[IO.Directory]::CreateDirectory((Join-Path $Old 'backups'))
    [IO.File]::WriteAllText((Join-Path $Old 'backups/keep.txt'),'old',$utf8)
    Assert ((Get-KvkDataRoot $Local) -ceq $New) 'Aimloom must win'
    Assert ([IO.File]::ReadAllText((Join-Path $Old 'backups/keep.txt')) -ceq 'old') 'The old folder must not be merged or deleted'
    Assert (-not [IO.File]::Exists((Join-Path $New 'backups/keep.txt'))) 'Nothing may be merged into Aimloom'
}

Test-Case 'a rename that fails keeps the whole session on the old folder' {
    $null=[IO.Directory]::CreateDirectory((Join-Path $Old 'backups'))
    [IO.File]::WriteAllText($New,'in the way',$utf8)   # a FILE named Aimloom blocks the rename
    Assert ((Get-KvkDataRoot $Local) -ceq $Old) 'A failed rename must fall back to the old folder'
    $ctx=New-KvkContext $Game $Local
    Assert ($ctx.BackupRoot.StartsWith($Old,[StringComparison]::OrdinalIgnoreCase)) 'Backups must stay with the existing data'
    # The obstacle disappears mid-session. The session must not change folders under its own feet.
    [IO.File]::Delete($New)
    Assert ((Get-KvkDataRoot $Local) -ceq $Old) 'A session must keep the folder it started with'
    Assert (-not [IO.Directory]::Exists($New)) 'Nothing may appear under the new name during a fallback session'
    # The next session adopts it.
    Clear-KvkDataRootMemo
    Assert ((Get-KvkDataRoot $Local) -ceq $New) 'The next session must complete the rename'
    Assert (-not [IO.Directory]::Exists($Old)) 'The old folder must be gone after the rename'
}

Test-Case 'every consumer resolves the same folder' {
    $null=[IO.Directory]::CreateDirectory((Join-Path $Old 'profiles'))
    $ctx=New-KvkContext $Game $Local
    foreach ($path in @($ctx.BackupRoot,$ctx.LockRoot,(Get-KvkProfileDirectory $Local),(Get-KvkImportStageBase $ctx))) {
        Assert ($path.StartsWith($New+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) "Not under the data root: $path"
    }
    Assert (-not [IO.Directory]::Exists($Old)) 'The old folder must have been adopted'
}

Test-Case 'first-protection records and install batches written before the rename still validate and restore' {
    # Make real engine data, then put it where an older build would have left it.
    $source=Join-Path (Split-Path $Local -Parent) 'Downloads'; $null=[IO.Directory]::CreateDirectory($source)
    $bytes=[byte[]](82,73,70,70,9,8,7); $file=Join-Path $source 'Soft.wav'; [IO.File]::WriteAllBytes($file,$bytes)
    $sha=[Security.Cryptography.SHA256]::Create(); $hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant(); $sha.Dispose()
    $ctx=New-KvkContext $Game $Local
    $report=Invoke-KvkFileAdd $ctx (New-KvkFileAddPlan $ctx 'sound' $file $hash 'Soft.wav')
    Assert ($report.Status -eq 'completed') "Setup install failed: $($report.Errors -join '; ')"
    # A replacement too: its backup file and its first-protection record are what a rename could lose.
    $settings=Join-Path $Game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $original=[IO.File]::ReadAllBytes($settings)
    $pack=Join-Path (Split-Path $Local -Parent) 'pack'; $null=[IO.Directory]::CreateDirectory($pack)
    [IO.File]::WriteAllText((Join-Path $pack 'PrimaryUserSettings.json'),'{"stringSettings":{"changed":"yes"}}',$utf8)
    $replace=Invoke-KvkInstall $ctx (New-KvkPlan $ctx $pack @('primary')) -AllowRunningGame
    Assert ($replace.Status -eq 'completed') "Setup replacement failed: $($replace.Errors -join '; ')"
    Assert (([IO.File]::ReadAllBytes($settings) -join ',') -cne ($original -join ',')) 'Setup: the replacement must have changed the settings'
    [IO.Directory]::Move($New,$Old); Clear-KvkDataRootMemo

    $after=New-KvkContext $Game $Local
    Assert ($after.BackupRoot.StartsWith($New,[StringComparison]::OrdinalIgnoreCase) -and -not [IO.Directory]::Exists($Old)) 'Old data must be adopted under Aimloom'
    $list=@(Get-KvkBackupList $after)
    Assert (@($list | Where-Object { $_.Id -ceq $report.Id }).Count -eq 1) 'The batch made before the rename must still be listed'
    $undo=Invoke-KvkRestore $after (New-KvkRestorePlan $after $report.Id)
    Assert ($undo.Status -eq 'restored') "Restore after the rename failed: $($undo.Status) $($undo.Errors -join '; ')"
    Assert (-not [IO.File]::Exists((Join-Path $Sounds 'Soft.wav'))) 'Restore must remove the file the batch added'
    $null=Read-KvkManifest $after 'pristine'   # throws unless every first-protection record still validates
    $back=Invoke-KvkRestore $after (New-KvkRestorePlan $after $replace.Id)
    Assert ($back.Status -eq 'restored') "Restoring the replacement after the rename failed: $($back.Status) $($back.Errors -join '; ')"
    Assert (([IO.File]::ReadAllBytes($settings) -join ',') -ceq ($original -join ',')) 'The original settings bytes must come back from a backup made before the rename'
}

if ($IsWindows) {
    Test-Case 'on Windows, a session that fell back holds the old folder so no other process can rename it away' {
        $null=[IO.Directory]::CreateDirectory((Join-Path $Old 'backups'))
        [IO.File]::WriteAllText($New,'in the way',$utf8)
        Assert ((Get-KvkDataRoot $Local) -ceq $Old) 'Setup: the session must have fallen back'
        [IO.File]::Delete($New)
        $moved=$true; try { [IO.Directory]::Move($Old,$New) } catch { $moved=$false }
        Assert (-not $moved) 'Another process renamed the folder out from under a session that is still using it'
    }
}
Write-Host "data-root tests passed: $script:Count"
