param([Parameter(Mandatory=$true)][string]$ReleaseRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Run this suite on Windows.' }
function Assert-Entry($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Invoke-Entry([string]$Path,[string]$InputText) {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$env:ComSpec
    $info.Arguments='/d /s /c ""' + $Path + '""'
    $info.WorkingDirectory=[IO.Path]::GetTempPath()
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true
    $info.RedirectStandardOutput=$true
    $info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$info
    try {
        $null=$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'CMD entrypoint timed out.' }
        return [pscustomobject]@{Code=$process.ExitCode;Output=($stdout.Result + $stderr.Result)}
    } finally { $process.Dispose() }
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('kvk 入口 test ' + [Guid]::NewGuid().ToString('N'))
$count=0
try {
    foreach ($layout in @('flat','scripts')) {
        $base=Join-Path $root $layout
        $runtime=if($layout -eq 'flat'){$base}else{Join-Path $base 'scripts'}
        $null=[IO.Directory]::CreateDirectory($runtime)
        foreach ($mode in @('Install','Restore')) {
            $name=if($mode -eq 'Install'){'安装配置.cmd'}else{'恢复配置.cmd'}
            $cmd=Join-Path $base $name
            Copy-Item -LiteralPath (Join-Path $ReleaseRoot $name) -Destination $cmd
            $entry=Join-Path $runtime 'kvk-config.ps1'
            foreach ($code in @(0,1,2)) {
                # Substitute only the called PS script to observe real CMD arguments,
                # STA mode and propagation of success/error/cancellation exit codes.
                $stub='param([string]$Mode)' + "`r`n" + 'Write-Output ("ENTRY_MODE=" + $Mode + ";APARTMENT=" + [Threading.Thread]::CurrentThread.ApartmentState)' + "`r`nexit " + $code
                [IO.File]::WriteAllText($entry,$stub,(New-Object Text.UTF8Encoding($true)))
                $result=Invoke-Entry $cmd "`r`n"
                Assert-Entry ($result.Code -eq $code) ('Wrong CMD exit code: '+$layout+'/'+$mode+'/'+$code+' '+$result.Output)
                Assert-Entry ($result.Output -match ('ENTRY_MODE='+$mode+';APARTMENT=STA')) 'CMD lost mode argument or STA.'
                $count++
            }
            # Now run the actual shipped CLI. A boundary engine provides a single
            # candidate; Q cancels before any context, pack or write is reached.
            Copy-Item -LiteralPath (Join-Path $ReleaseRoot 'scripts/kvk-config.ps1') -Destination $entry -Force
            [IO.File]::WriteAllText((Join-Path $runtime 'kvk-engine.ps1'),'function Get-KvkCandidates { return "fixture game" }',(New-Object Text.UTF8Encoding($true)))
            $result=Invoke-Entry $cmd "q`r`n`r`n"
            Assert-Entry ($result.Code -eq 2 -and $result.Output -match 'Cancelled. No further action was started.') ('Actual CLI cancellation failed: '+$result.Output)
            $count++
        }
    }
    $missing=Join-Path $root 'missing runtime'
    $null=[IO.Directory]::CreateDirectory($missing)
    foreach ($name in @('安装配置.cmd','恢复配置.cmd')) {
        $cmd=Join-Path $missing $name
        Copy-Item -LiteralPath (Join-Path $ReleaseRoot $name) -Destination $cmd
        $result=Invoke-Entry $cmd "`r`n"
        Assert-Entry ($result.Code -eq 1 -and $result.Output -match 'Installer files are missing') 'Missing runtime must fail clearly.'
        $count++
    }
    Write-Output ('PASS all '+$count+' native CMD fixtures: Unicode/spaces, independent cwd, both layouts/modes, STA, exit codes, real CLI cancellation and missing runtime. No real game directory used.')
} finally {
    if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
