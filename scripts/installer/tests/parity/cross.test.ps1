#Requires -Version 7.0
# Cross-engine recovery: the PowerShell engine and the Rust engine share one game folder and one
# data folder, and each picks up what the other left -- a batch to undo, a recovery-required batch
# to retry, first protection, Profiles. ROADMAP ENGINE-RUST: "Either engine reads what the other
# wrote." The Rust side is the example worker (cargo build --example engine_worker).
param([string]$Worker='',[string]$CaseFilter='',[string]$TempRoot='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0

$installerRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $installerRoot 'kvk-engine.ps1')
. (Join-Path $installerRoot 'kvk-scheme.ps1')
. (Join-Path $installerRoot 'kvk-audio.ps1')
. (Join-Path $installerRoot 'kvk-crosshair.ps1')
. (Join-Path $installerRoot 'kvk-enemy.ps1')
. (Join-Path $installerRoot 'kvk-import.ps1')
. (Join-Path $installerRoot 'kvk-profile-apply.ps1')
. (Join-Path $installerRoot 'gui/kvk-gui-service.ps1')

$repoRoot=[IO.Path]::GetFullPath((Join-Path $installerRoot '../..'))
if (-not $Worker) {
    $name=if ($IsWindows) { 'engine_worker.exe' } else { 'engine_worker' }
    $Worker=Join-Path $repoRoot "packages/app/src-tauri/target/debug/examples/$name"
}
if (-not [IO.File]::Exists($Worker)) { throw "Build the Rust worker first (cargo build --example engine_worker): $Worker" }

# The PowerShell side sees no game unless a case makes it appear.
$script:ProcessListings=0; $script:RunningFrom=$null
function Get-Process {
    [CmdletBinding()] param()
    $script:ProcessListings++
    if ($null -ne $script:RunningFrom -and $script:ProcessListings -ge $script:RunningFrom) { return [pscustomobject]@{ProcessName='FPSAimTrainer'} }
    return [pscustomobject]@{ProcessName='explorer'}
}
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }

function Start-RustWorker([string]$Local,$RunningFrom=$null) {
    $info=[Diagnostics.ProcessStartInfo]::new($Worker)
    foreach ($a in @('--local-data-root',$Local,'--runtime-root',$installerRoot)) { $info.ArgumentList.Add($a) }
    $info.UseShellExecute=$false; $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false); $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    $info.Environment['KVK_TEST_PROCESSES']='explorer'
    if ($null -ne $RunningFrom) { $info.Environment['KVK_TEST_RUNNING_FROM']=[string]$RunningFrom }
    return [Diagnostics.Process]::Start($info)
}
function Stop-RustWorker($Process) {
    if ($null -eq $Process) { return }
    try { $Process.StandardInput.Close(); if (-not $Process.WaitForExit(10000)) { $Process.Kill() } } finally { $Process.Dispose() }
}
$script:Number=0
function New-Request([string]$Op,$RequestArgs) { $script:Number++; return [ordered]@{v=1;requestId=('x'+$script:Number);op=$Op;args=$RequestArgs} }
# One request to the Rust worker; progress lines are read past. The reply comes back parsed.
function Send-Rust($Process,[string]$Op,$RequestArgs) {
    $Process.StandardInput.WriteLine((ConvertTo-Json -InputObject (New-Request $Op $RequestArgs) -Depth 32 -Compress))
    $Process.StandardInput.Flush()
    while ($true) {
        $line=$Process.StandardOutput.ReadLine()
        if ($null -eq $line) { throw "The Rust worker ended: $($Process.StandardError.ReadToEnd())" }
        $reply=ConvertFrom-Json -InputObject $line -AsHashtable -Depth 64
        if ($reply['type'] -ceq 'reply') { return $reply }
    }
}
function Send-Ps($Session,[string]$Op,$RequestArgs) {
    $reply=Invoke-KvkGuiRequest -Session $Session -Request (New-Request $Op $RequestArgs)
    return (ConvertFrom-Json -InputObject (ConvertTo-Json -InputObject $reply -Depth 32 -Compress) -AsHashtable -Depth 64)
}
function Get-Ok($Reply,[string]$What) { Assert ($Reply['ok']) "$What failed: $(ConvertTo-Json $Reply -Depth 10 -Compress)"; return $Reply['data'] }
function Get-Code($Reply) { if ($Reply['ok']) { return 'ok' }; return $Reply['error']['code'] }

$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Body) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $base=if ($TempRoot) { $TempRoot } else { [IO.Path]::GetTempPath() }
    if ($base.StartsWith('/var/')) { $base='/private'+$base }
    $root=Join-Path $base ('kvk-cross-'+[guid]::NewGuid().ToString('N'))
    $game=[IO.Path]::GetFullPath((Join-Path $root '游戏 with spaces'))
    $local=[IO.Path]::GetFullPath((Join-Path $root 'Local Data'))
    $primary=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($primary))
    $null=[IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/sounds'))
    $null=[IO.Directory]::CreateDirectory($local)
    $original=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'fixtures/enemy-crlf.json'))
    [IO.File]::WriteAllBytes($primary,$original)
    Clear-KvkDataRootMemo
    $script:ProcessListings=0; $script:RunningFrom=$null
    $f=[pscustomobject]@{Game=$game;Local=$local;Primary=$primary;Original=$original;Ps=(New-KvkGuiSession -RuntimeRoot $installerRoot -LocalDataRoot $local);Rust=$null}
    try { $f.Rust=Start-RustWorker $local; & $Body $f; $script:Count++; Write-Host "PASS $Name" }
    finally { Stop-RustWorker $f.Rust; Clear-KvkDataRootMemo; Remove-Item -LiteralPath $root -Recurse -Force }
}
function Test-Original($f) { return ([Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Primary)) -ceq [Convert]::ToBase64String($f.Original)) }
function Enemy([string]$Shape,[string]$Model,[string]$Skin,$f) { return [ordered]@{gameRoot=$f.Game;shape=$Shape;model=$Model;skin=$Skin;revision=1} }
function Run([string]$PlanId,[string]$Confirmation='install') { return [ordered]@{operationId=[guid]::NewGuid().ToString('N');planId=$PlanId;confirmation=$Confirmation;allowConflicts=$false} }

Test-Case 'Rust applies; PowerShell undoes it and restores the first protection' {
    param($f)
    $plan=Get-Ok (Send-Rust $f.Rust 'planEnemy' (Enemy 'cylindrical' 'Ghost' 'Default' $f)) 'Rust planEnemy'
    $done=Get-Ok (Send-Rust $f.Rust 'execute' (Run $plan['planId'])) 'Rust execute'
    Assert ($done['status'] -ceq 'completed' -and -not (Test-Original $f)) 'Rust did not apply'
    $undo=Get-Ok (Send-Ps $f.Ps 'planRestore' ([ordered]@{gameRoot=$f.Game;sourceId=$done['batchId'];revision=1})) 'PowerShell planRestore'
    $restored=Get-Ok (Send-Ps $f.Ps 'execute' (Run $undo['planId'] 'restore')) 'PowerShell restore'
    Assert ($restored['status'] -ceq 'restored' -and (Test-Original $f)) 'PowerShell did not restore the exact bytes Rust changed'
    $pristine=Get-Ok (Send-Ps $f.Ps 'planRestore' ([ordered]@{gameRoot=$f.Game;sourceId='pristine';revision=2})) 'PowerShell pristine plan'
    Assert (@($pristine['rows'])[0]['action'] -ceq 'skip') 'The first protection Rust wrote was not read as matching'
}

Test-Case 'PowerShell applies; Rust lists the same backups and undoes it' {
    param($f)
    $plan=Get-Ok (Send-Ps $f.Ps 'planEnemy' (Enemy 'cuboid' 'Mummy' 'Default' $f)) 'PowerShell planEnemy'
    $done=Get-Ok (Send-Ps $f.Ps 'execute' (Run $plan['planId'])) 'PowerShell execute'
    $psList=ConvertTo-Json (Get-Ok (Send-Ps $f.Ps 'backups' ([ordered]@{gameRoot=$f.Game})) 'PowerShell backups')['records'] -Depth 10 -Compress
    $rustList=ConvertTo-Json (Get-Ok (Send-Rust $f.Rust 'backups' ([ordered]@{gameRoot=$f.Game})) 'Rust backups')['records'] -Depth 10 -Compress
    Assert ($psList -ceq $rustList) "The two engines list the backups differently:`n$psList`n$rustList"
    $undo=Get-Ok (Send-Rust $f.Rust 'planRestore' ([ordered]@{gameRoot=$f.Game;sourceId=$done['batchId'];revision=1})) 'Rust planRestore'
    $restored=Get-Ok (Send-Rust $f.Rust 'execute' (Run $undo['planId'] 'restore')) 'Rust restore'
    Assert ($restored['status'] -ceq 'restored' -and (Test-Original $f)) 'Rust did not restore the exact bytes PowerShell changed'
    $after=Get-Ok (Send-Ps $f.Ps 'backups' ([ordered]@{gameRoot=$f.Game})) 'PowerShell backups after'
    Assert (@($after['records']).Count -eq 2) 'PowerShell could not validate the restore batch Rust wrote'
}

Test-Case 'a recovery-required batch left by PowerShell is refused and recovered by Rust' {
    param($f)
    $plan=Get-Ok (Send-Ps $f.Ps 'planEnemy' (Enemy 'cylindrical' 'Ghost' 'Default' $f)) 'PowerShell planEnemy'
    $script:RunningFrom=$script:ProcessListings+3
    $done=Get-Ok (Send-Ps $f.Ps 'execute' (Run $plan['planId'])) 'PowerShell execute'
    $script:RunningFrom=$null
    Assert ($done['status'] -ceq 'recovery-required') "Expected recovery-required, got $($done['status'])"
    Assert ((Get-Code (Send-Rust $f.Rust 'planEnemy' (Enemy 'cuboid' 'Mummy' 'Default' $f))) -ceq 'RECOVERY_REQUIRED') 'Rust ignored the unfinished PowerShell batch'
    $undo=Get-Ok (Send-Rust $f.Rust 'planRestore' ([ordered]@{gameRoot=$f.Game;sourceId=$done['batchId'];revision=1})) 'Rust planRestore'
    $restored=Get-Ok (Send-Rust $f.Rust 'execute' (Run $undo['planId'] 'restore')) 'Rust restore'
    Assert ($restored['status'] -ceq 'restored' -and (Test-Original $f)) 'Rust did not recover the PowerShell batch'
    $next=Get-Ok (Send-Ps $f.Ps 'planEnemy' (Enemy 'cuboid' 'Mummy' 'Default' $f)) 'PowerShell after recovery'
    Assert ($null -ne $next['planId']) 'PowerShell still sees an unfinished batch'
}

Test-Case 'a recovery-required batch left by Rust is refused and recovered by PowerShell' {
    param($f)
    Stop-RustWorker $f.Rust
    # The Rust worker's game check: planEnemy lists twice (check, preview), execute once, the
    # file change twice; the game "starts" just before the rename, and rollback cannot run.
    $f.Rust=Start-RustWorker $f.Local 5
    $plan=Get-Ok (Send-Rust $f.Rust 'planEnemy' (Enemy 'cylindrical' 'Ghost' 'Default' $f)) 'Rust planEnemy'
    $done=Get-Ok (Send-Rust $f.Rust 'execute' (Run $plan['planId'])) 'Rust execute'
    Assert ($done['status'] -ceq 'recovery-required') "Expected recovery-required, got $($done['status'])"
    Stop-RustWorker $f.Rust; $f.Rust=Start-RustWorker $f.Local
    Assert ((Get-Code (Send-Ps $f.Ps 'planEnemy' (Enemy 'cuboid' 'Mummy' 'Default' $f))) -ceq 'RECOVERY_REQUIRED') 'PowerShell ignored the unfinished Rust batch'
    $undo=Get-Ok (Send-Ps $f.Ps 'planRestore' ([ordered]@{gameRoot=$f.Game;sourceId=$done['batchId'];revision=1})) 'PowerShell planRestore'
    $restored=Get-Ok (Send-Ps $f.Ps 'execute' (Run $undo['planId'] 'restore')) 'PowerShell restore'
    Assert ($restored['status'] -ceq 'restored' -and (Test-Original $f)) 'PowerShell did not recover the Rust batch'
}

Test-Case 'a Profile saved by either engine is read by the other' {
    param($f)
    $profile=[ordered]@{schemaVersion=1;id='shared';name='Shared 共享';scheme=[ordered]@{name='Dark';path='C:\Themes\Dark.json'};audio=[ordered]@{kill=@([ordered]@{name='hit';path='C:\sounds\hit.wav'})}}
    $saved=Get-Ok (Send-Ps $f.Ps 'profileSave' ([ordered]@{profile=$profile})) 'PowerShell profileSave'
    $read=Get-Ok (Send-Rust $f.Rust 'profileRead' ([ordered]@{id='shared'})) 'Rust profileRead'
    Assert ((ConvertTo-Json $read['profile'] -Depth 10 -Compress) -ceq (ConvertTo-Json $saved['profile'] -Depth 10 -Compress)) 'Rust read a different Profile'
    $profile['id']='rusty'; $profile['name']='Rusty'
    $null=Get-Ok (Send-Rust $f.Rust 'profileSave' ([ordered]@{profile=$profile})) 'Rust profileSave'
    $list=Get-Ok (Send-Ps $f.Ps 'profileList' ([ordered]@{})) 'PowerShell profileList'
    Assert (@($list['profiles']).Count -eq 2 -and @($list['errors']).Count -eq 0) 'PowerShell could not read the Profile Rust wrote'
}

Test-Case 'first protection is shared: two engines, one record, one exact restore' {
    param($f)
    $a=Get-Ok (Send-Rust $f.Rust 'planEnemy' (Enemy 'cylindrical' 'Ghost' 'Default' $f)) 'Rust planEnemy'
    $null=Get-Ok (Send-Rust $f.Rust 'execute' (Run $a['planId'])) 'Rust execute'
    $b=Get-Ok (Send-Ps $f.Ps 'planEnemy' (Enemy 'spheroid' 'None' 'None' $f)) 'PowerShell planEnemy'
    $null=Get-Ok (Send-Ps $f.Ps 'execute' (Run $b['planId'])) 'PowerShell execute'
    $p=Get-Ok (Send-Rust $f.Rust 'planRestore' ([ordered]@{gameRoot=$f.Game;sourceId='pristine';revision=1})) 'Rust pristine plan'
    Assert (-not @($p['rows'])[0]['conflict']) 'Rust saw a conflict in the history the two engines wrote'
    $restored=Get-Ok (Send-Rust $f.Rust 'execute' (Run $p['planId'] 'restore')) 'Rust pristine restore'
    Assert ($restored['status'] -ceq 'restored' -and (Test-Original $f)) 'The first protection did not bring back the exact original bytes'
}

Write-Host "cross.test.ps1: $script:Count passed"
