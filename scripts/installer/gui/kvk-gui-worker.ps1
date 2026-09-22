#Requires -Version 7.0
[CmdletBinding()]
param()

# Dot-sourcing exposes the loop for isolated process fixtures. The public script
# has no path/environment override arguments.
function Start-KvkGuiWorker {
    param([Parameter(Mandatory=$true)][string]$RuntimeRoot,
          [Parameter(Mandatory=$true)][string]$LocalDataRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0
# This process's stderr is copied into worker.log by the native layer, so the engine may write
# the original text of a message it could not word in English there. The console wizard, which
# shares the engine, leaves this unset and keeps its terminal clean.
$global:KvkStderrDetails=$true
$strictUtf8=[Text.UTF8Encoding]::new($false,$true)
# stdout and stdin get their own strict readers below, but stderr goes through the console's own
# encoding -- and stderr is exactly what the native layer copies into worker.log. Left at the
# OEM code page, a Chinese file name or message reaches the log as mojibake, which is the one
# thing the log exists to avoid. $OutputEncoding covers anything that writes through a pipeline.
try { [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false) } catch { <# a host without a console; stderr is redirected anyway #> }
$OutputEncoding=[Text.UTF8Encoding]::new($false)
$stdin=[IO.StreamReader]::new([Console]::OpenStandardInput(),$strictUtf8,$false,4096,$false)
$stdout=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),$strictUtf8,4096,$false)
$stdout.AutoFlush=$true

. (Join-Path $runtimeRoot 'kvk-engine.ps1')
. (Join-Path $runtimeRoot 'kvk-scheme.ps1')
. (Join-Path $runtimeRoot 'kvk-audio.ps1')
. (Join-Path $runtimeRoot 'kvk-crosshair.ps1')
. (Join-Path $runtimeRoot 'kvk-enemy.ps1')
. (Join-Path $runtimeRoot 'kvk-import.ps1')
. (Join-Path $runtimeRoot 'kvk-profile-apply.ps1')
. (Join-Path $runtimeRoot 'gui/kvk-gui-service.ps1')

function Write-KvkGuiLine($Value) {
    $json=ConvertTo-Json -InputObject $Value -Depth 32 -Compress
    $stdout.WriteLine($json)
}

function Write-KvkGuiParseFailure([string]$Message) {
    Write-KvkGuiLine ([pscustomobject]@{v=1;requestId=$null;type='reply';ok=$false;error=(New-KvkGuiIssue 'ENGINE_ERROR' $Message $Message $null)})
}

$session=New-KvkGuiSession -RuntimeRoot $runtimeRoot -LocalDataRoot $localDataRoot

while ($true) {
    $line=$stdin.ReadLine()
    if ($null -eq $line) { break }
    if ([Text.Encoding]::UTF8.GetByteCount($line) -gt 16777216) { Write-KvkGuiParseFailure 'Request exceeds the 16 MiB limit.';continue }
    try {
        $request=ConvertFrom-Json -InputObject $line -AsHashtable -Depth 32 -NoEnumerate -ErrorAction Stop
        # Profile strings are literal editor data; ConvertFrom-Json may promote
        # date-looking strings. Keep the established parser for game operations.
        if ((Test-KvkGuiMap $request) -and 'op' -cin @(Get-KvkGuiKeys $request) -and (Get-KvkGuiValue $request 'op') -cin @('profileList','profileRead','profileSave','profileDelete','profileAssetList','profileAssetRead')) {
            $options=[Text.Json.JsonDocumentOptions]::new();$options.MaxDepth=32
            $document=[Text.Json.JsonDocument]::Parse($line,$options)
            try { $request=ConvertFrom-KvkProfileElement $document.RootElement } finally { $document.Dispose() }
        }
    } catch {
        Write-KvkGuiParseFailure ("Invalid JSON request: $($_.Exception.Message)")
        continue
    }
    $operationId=$null
    if (Test-KvkGuiMap $request) {
        $keys=@(Get-KvkGuiKeys $request)
        if ('op' -cin $keys -and (Get-KvkGuiValue $request 'op') -ceq 'execute' -and 'args' -cin $keys) {
            $requestArgs=Get-KvkGuiValue $request 'args'
            if ((Test-KvkGuiMap $requestArgs) -and 'operationId' -cin @(Get-KvkGuiKeys $requestArgs)) { $operationId=Get-KvkGuiValue $requestArgs 'operationId' }
        }
    }
    $reply=Invoke-KvkGuiRequest -Session $session -Request $request -Observer {
        param($event)
        $data=[pscustomobject]@{phase=$event.Phase;completed=$event.Completed;total=$event.Total;currentFile=$event.CurrentFile;batchId=$event.BatchId}
        Write-KvkGuiLine ([pscustomobject]@{v=1;requestId=(Get-KvkGuiValue $request 'requestId');type='progress';operationId=$operationId;data=$data})
    }
    Write-KvkGuiLine $reply
}

}
if ($MyInvocation.InvocationName -ne '.') {
    Start-KvkGuiWorker -RuntimeRoot (Split-Path $PSScriptRoot -Parent) -LocalDataRoot ([Environment]::GetFolderPath('LocalApplicationData'))
}
