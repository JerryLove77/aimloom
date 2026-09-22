$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$control=Join-Path (Split-Path $PSScriptRoot -Parent) 'control-kovaak-challenge.ps1'
if(-not (Test-Path -LiteralPath $control)){throw 'MISSING FEATURE: guarded challenge controls'}
. $control
function Assert($condition,[string]$message){if(-not $condition){throw $message}}
function Reject([scriptblock]$action,[string]$message){$failed=$false;try{$null=& $action}catch{$failed=$true};Assert $failed $message}
$script:context=[pscustomobject]@{sessionId=2;window=[intptr]123;processId=456;processName='FPSAimTrainer-Win64-Shipping';targetSessionId=2;heldKeys=@()}
$script:sent=[Collections.Generic.List[int]]::new();$script:sendCount=2
function Get-KvkChallengeContext { return $script:context }
function Send-KvkChallengeStroke($Context,[int]$VirtualKey){$script:sent.Add($VirtualKey);return $script:sendCount}

$status=Invoke-KvkChallengeControl
Assert ($status.status -eq 'status-only' -and $script:sent.Count -eq 0) 'Default action sent a key'
Assert ($status.challengeState -eq 'unknown') 'Status invented a paused/running state'
Write-Host 'PASS default status is read-only and does not infer challenge state'

$script:context.sessionId=0
Reject {Invoke-KvkChallengeControl -Action TogglePause -DelaySeconds 0} 'Session 0 accepted input'
Assert ($script:sent.Count -eq 0) 'Session 0 sent input'
$script:context.sessionId=2
$script:context.processName='pwsh'
Reject {Invoke-KvkChallengeControl -Action Reset -DelaySeconds 0} 'Non-game foreground accepted input'
Assert ($script:sent.Count -eq 0) 'Non-game window received input'
$script:context.processName='FPSAimTrainer-Win64-Shipping';$script:context.targetSessionId=3
Reject {Invoke-KvkChallengeControl -Action Reset -DelaySeconds 0} 'Other session accepted input'
$script:context.targetSessionId=2;$script:context.heldKeys=@(18)
Reject {Invoke-KvkChallengeControl -Action TogglePause -DelaySeconds 0} 'Held modifier accepted input'
Assert ($script:sent.Count -eq 0) 'Rejected action sent input'
$script:context.heldKeys=@()
Write-Host 'PASS session, foreground and held-key guards reject unsafe contexts'

$dry=Invoke-KvkChallengeControl -Action Reset -DelaySeconds 0 -DryRun
Assert ($dry.status -eq 'dry-run' -and $script:sent.Count -eq 0) 'Dry run sent input'
Write-Host 'PASS dry run never sends input'

$toggle=Invoke-KvkChallengeControl -Action TogglePause -DelaySeconds 0
$reset=Invoke-KvkChallengeControl -Action Reset -DelaySeconds 0
Assert ($script:sent.Count -eq 2 -and $script:sent[0] -eq 27 -and $script:sent[1] -eq 32) 'Actions did not map to one Escape and one Space stroke'
Assert ($toggle.status -eq 'input-sent' -and $reset.status -eq 'input-sent') 'Successful queueing not reported'
Assert ($toggle.challengeState -eq 'unknown') 'Queued key was mistaken for game acceptance'
Write-Host 'PASS explicit actions send one requested stroke and preserve unknown game outcome'

$script:sendCount=0
Reject {Invoke-KvkChallengeControl -Action Reset -DelaySeconds 0} 'Blocked input was reported as sent'
Assert ($script:sent.Count -eq 3) 'Blocked action retried automatically'
Write-Host 'PASS blocked input fails without retrying a toggle'

Initialize-KvkChallengeNative
$expectedSize=if([intptr]::Size -eq 8){40}else{28}
Assert ([AimloomChallenge.NativeInput]::InputSize -eq $expectedSize) 'Native INPUT layout has the wrong size'
$stroke=[AimloomChallenge.NativeInput]::BuildStroke(27)
Assert ($stroke.Count -eq 2 -and $stroke[0].type -eq 1 -and $stroke[1].type -eq 1) 'Native stroke is not two keyboard events'
Assert ($stroke[0].data.keyboard.wVk -eq 27 -and $stroke[0].data.keyboard.dwFlags -eq 0) 'Missing Escape key-down'
Assert ($stroke[1].data.keyboard.wVk -eq 27 -and $stroke[1].data.keyboard.dwFlags -eq 2) 'Missing Escape key-up'
Reject {[AimloomChallenge.NativeInput]::SendStroke([intptr]::Zero,0,27)} 'Native adapter accepted an empty target'
Write-Host 'PASS native event layout and empty-target rejection without actual key injection'
Write-Host 'PASS all 6 challenge-control validation groups; no real keystrokes sent'
