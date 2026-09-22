param([Parameter(Mandatory=$true)][string]$ReleaseRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0


function Assert-GuiDistribution($Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Write-GuiDistributionText([string]$Path,[string]$Text){
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))
}
function Invoke-GuiWorkerRequest($Process,$Request,[Collections.Generic.List[object]]$Progress){
    $requestId=[string]$Request.requestId
    $Process.StandardInput.WriteLine((ConvertTo-Json -InputObject $Request -Depth 10 -Compress))
    $Process.StandardInput.Flush()
    while($true){
        $line=$Process.StandardOutput.ReadLine()
        if($null -eq $line){throw "Worker exited before replying to $requestId"}
        $message=ConvertFrom-Json -InputObject $line -Depth 32 -ErrorAction Stop
        if($message.type -eq 'progress'){$Progress.Add($message);continue}
        if($message.type -eq 'reply' -and $message.requestId -ceq $requestId){Write-Output -NoEnumerate $message;return}
        throw "Unexpected worker message while waiting for $requestId"
    }
}

$release=[IO.Path]::GetFullPath($ReleaseRoot)
$worker=Join-Path $release 'scripts/gui/kvk-gui-worker.ps1'
$schema=Join-Path $release 'scripts/gui/protocol.schema.json'
$pack=Join-Path $release 'KVK Settings 2025'
foreach($required in @($worker,$schema,(Join-Path $release 'scripts/gui/kvk-gui-service.ps1'),(Join-Path $release 'scripts/kvk-engine.ps1'))){
    if(-not [IO.File]::Exists($required)){throw "GUI distribution runtime missing: $required"}
}
if(-not [IO.Directory]::Exists($pack)){throw "GUI distribution pack missing: $pack"}

$tempRoot=[IO.Path]::GetTempPath();if($tempRoot.StartsWith('/var/')){$tempRoot='/private'+$tempRoot}
$root=Join-Path $tempRoot ('kvk-gui-distribution-'+[Guid]::NewGuid().ToString('N'))
$game=Join-Path $root '最终 GUI 游戏目录'
$data=Join-Path $game 'FPSAimTrainer'
$settings=Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json'
$ui=Join-Path $data 'Saved/SaveGames/UI.json'
$fixtureLocal=Join-Path $root 'Local Data'
$palette=Join-Path $fixtureLocal 'FPSAimTrainer/Saved/Config/WindowsNoEditor/Palette.ini'
$process=$null;$backupRoot=$null
try{
    Write-GuiDistributionText $settings '{"personalSensitivity":0.123456789012345}'
    Write-GuiDistributionText $ui '{"personalUI":true}'
    Write-GuiDistributionText $palette 'original palette'
    $null=[IO.Directory]::CreateDirectory((Join-Path $data 'sounds'))
    Write-GuiDistributionText (Join-Path $data 'sounds/unrelated-user.wav') 'unrelated user sound'
    $before=@{};foreach($path in @($settings,$ui,$palette)){$before[$path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}

    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=(Get-Process -Id $PID).Path
    $wrapper=Join-Path $root 'fixture-worker.ps1'
    $workerQuoted=$worker.Replace("'","''")
    $scriptsQuoted=(Join-Path $release 'scripts').Replace("'","''")
    $localQuoted=$fixtureLocal.Replace("'","''")
    Write-GuiDistributionText $wrapper (". '$workerQuoted'`nStart-KvkGuiWorker -RuntimeRoot '$scriptsQuoted' -LocalDataRoot '$localQuoted'`n")
    $start.ArgumentList.Add('-NoProfile');$start.ArgumentList.Add('-File');$start.ArgumentList.Add($wrapper)
    $start.UseShellExecute=$false;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    # The production parent is UTF-8: worker.rs write_request serialises the request
    # with serde_json::to_vec and writes those bytes raw. Without these the child's
    # pipes fall back to Console.InputEncoding, the console code page, and the first
    # non-ASCII byte in a request kills the strict UTF-8 worker before it can reply.
    $utf8=[Text.UTF8Encoding]::new($false)
    $start.StandardInputEncoding=$utf8
    $start.StandardOutputEncoding=$utf8
    $start.StandardErrorEncoding=$utf8
    # The test wrapper injects only the internal loop/session context. The public
    # worker entry still has no LocalData argument and uses the real OS folder.
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    Assert-GuiDistribution ($process.Start()) 'Could not start the packaged GUI worker.'
    $stderrTask=$process.StandardError.ReadToEndAsync()
    $progress=[Collections.Generic.List[object]]::new()

    $location=Invoke-GuiWorkerRequest $process @{v=1;requestId='location';op='locate';args=@{gameRoot=$game}} $progress
    $fixturePrefix=[IO.Path]::GetFullPath($fixtureLocal).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    Assert-GuiDistribution ($location.ok -and $location.data.backupRoot.StartsWith($fixturePrefix,[StringComparison]::OrdinalIgnoreCase)) 'Worker did not resolve the isolated process LocalApplicationData; refusing filesystem writes.'

    $preview=Invoke-GuiWorkerRequest $process @{v=1;requestId='default-plan';op='planInstall';args=@{gameRoot=$game;packRoot=$pack;categories=@('themes','sounds','crosshairs');revision=1}} $progress
    if(-not $preview.ok){throw ('Default plan failed: '+$preview.error.message)}
    $backupRoot=$preview.data.location.backupRoot
    Assert-GuiDistribution (@($preview.data.rows).Count -eq 692) 'Final GUI pack must expose exactly 692 default asset rows.'
    Write-Host 'GUI distribution: installing 692 real assets through the JSONL worker loop.'
    $installed=Invoke-GuiWorkerRequest $process @{v=1;requestId='default-run';op='execute';args=@{operationId='distribution-default';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}} $progress
    Assert-GuiDistribution ($installed.ok -and $installed.data.status -eq 'completed') 'Packaged worker default install failed.'
    Assert-GuiDistribution (@($progress | Where-Object {$_.operationId -eq 'distribution-default'}).Count -gt 0) 'Packaged worker emitted no install progress.'
    foreach($path in @($settings,$ui,$palette)){Assert-GuiDistribution ((Get-FileHash -LiteralPath $path).Hash -eq $before[$path]) 'Default GUI install changed an opt-in setting.'}

    Write-Host 'GUI distribution: verifying bytes and repeated installation.'
    $packFiles=Get-ChildItem -LiteralPath $pack -Recurse -File -Force
    $verified=0
    foreach($row in $preview.data.rows){
      Assert-GuiDistribution ((Get-FileHash -LiteralPath $row.target).Hash -eq (Get-FileHash -LiteralPath $row.source).Hash) ('Installed bytes differ: '+$row.target)
      $verified++
    }
    Assert-GuiDistribution ($verified -eq 692) 'Expected 692 independently hashed copies.'
    $repeat=Invoke-GuiWorkerRequest $process @{v=1;requestId='repeat-plan';op='planInstall';args=@{gameRoot=$game;packRoot=$pack;categories=@('themes','sounds','crosshairs');revision=2}} $progress
    $repeatRun=Invoke-GuiWorkerRequest $process @{v=1;requestId='repeat-run';op='execute';args=@{operationId='distribution-repeat';planId=$repeat.data.planId;confirmation='install';allowConflicts=$false}} $progress
    Assert-GuiDistribution ($repeatRun.ok -and $repeatRun.data.status -eq 'no-change') 'Packaged worker install was not idempotent.'

    Write-Host 'GUI distribution: installing 3 opt-in settings.'
    $extras=Invoke-GuiWorkerRequest $process @{v=1;requestId='extras-plan';op='planInstall';args=@{gameRoot=$game;packRoot=$pack;categories=@('ui','palette','primary');revision=3}} $progress
    $extrasRun=Invoke-GuiWorkerRequest $process @{v=1;requestId='extras-run';op='execute';args=@{operationId='distribution-extras';planId=$extras.data.planId;confirmation='install';allowConflicts=$false}} $progress
    Assert-GuiDistribution ($extrasRun.ok -and $extrasRun.data.status -eq 'completed' -and @($extrasRun.data.items).Count -eq 3) 'Packaged worker opt-in install failed.'

    Write-Host 'GUI distribution: restoring first-touch originals.'
    $restore=Invoke-GuiWorkerRequest $process @{v=1;requestId='restore-plan';op='planRestore';args=@{gameRoot=$game;sourceId='pristine';revision=4}} $progress
    $restoreRun=Invoke-GuiWorkerRequest $process @{v=1;requestId='restore-run';op='execute';args=@{operationId='distribution-restore';planId=$restore.data.planId;confirmation='restore';allowConflicts=$false}} $progress
    Assert-GuiDistribution ($restoreRun.ok -and $restoreRun.data.status -eq 'restored') 'Packaged worker pristine restore failed.'
    foreach($path in @($settings,$ui,$palette)){Assert-GuiDistribution ((Get-FileHash -LiteralPath $path).Hash -eq $before[$path]) 'Packaged worker did not restore an opt-in setting exactly.'}
    Assert-GuiDistribution ([IO.File]::ReadAllText((Join-Path $data 'sounds/unrelated-user.wav')) -ceq 'unrelated user sound') 'Packaged worker changed an unrelated file.'

    $process.StandardInput.Close();Assert-GuiDistribution ($process.WaitForExit(30000)) 'Packaged worker did not exit after idle stdin EOF.'
    Assert-GuiDistribution ($process.ExitCode -eq 0) ('Packaged worker exit failed: '+$stderrTask.Result)
    Microsoft.PowerShell.Utility\Write-Host 'PASS: packaged GUI worker planned 692 assets, installed defaults and 3 opt-ins, repeated safely, restored pristine bytes and preserved unrelated files.'
}finally{
    $canClean=$true
    if($null -ne $process){
        if(-not $process.HasExited){try{$process.StandardInput.Close()}catch{};$canClean=$process.WaitForExit(30000)}
        $process.Dispose()
    }
    if($canClean -and [IO.Directory]::Exists($root)){Remove-Item -LiteralPath $root -Recurse -Force}
    elseif(-not $canClean){Write-Warning ('Worker may still be active; fixture preserved at '+$root)}
}
