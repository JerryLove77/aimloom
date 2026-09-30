#Requires -Version 7.0
# Engine parity: runs cases/*.json through the PowerShell engine and compares what it observes with
# goldens/ (or rewrites them with -Write). The Rust engine is held to the same goldens by
# packages/app/src-tauri/tests/engine_parity.rs. README.md holds the case format and the
# normalization both harnesses apply; change them together.
param([string]$CaseFilter='',[switch]$Write,[string]$TempRoot='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0

$installerRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# The worker's load order.
. (Join-Path $installerRoot 'kvk-engine.ps1')
. (Join-Path $installerRoot 'kvk-scheme.ps1')
. (Join-Path $installerRoot 'kvk-audio.ps1')
. (Join-Path $installerRoot 'kvk-crosshair.ps1')
. (Join-Path $installerRoot 'kvk-enemy.ps1')
. (Join-Path $installerRoot 'kvk-import.ps1')
. (Join-Path $installerRoot 'kvk-profile-apply.ps1')
. (Join-Path $installerRoot 'gui/kvk-gui-service.ps1')

# Every game check and every gameState lists processes through Get-Process. This stands in for
# it: the game appears from the RunningFrom-th listing on. The Rust harness counts the same way.
$script:ProcessListings=0
$script:RunningFrom=$null
function Get-Process {
    [CmdletBinding()] param()
    $script:ProcessListings++
    if ($null -ne $script:RunningFrom -and $script:ProcessListings -ge $script:RunningFrom) { return [pscustomobject]@{ProcessName='FPSAimTrainer'} }
    return [pscustomobject]@{ProcessName='explorer'}
}

# A fault replaces the named engine function with one that throws at its entry.
$script:FaultTargets=[ordered]@{'file-change'='Invoke-KvkFileChange';'snapshot'='Copy-KvkSnapshot'}
$script:Originals=@{}
foreach ($name in $script:FaultTargets.Values) { $script:Originals[$name]=(Get-Item -LiteralPath "function:$name").ScriptBlock }
function Clear-ParityFaults { foreach ($name in $script:FaultTargets.Values) { Set-Item -LiteralPath "function:script:$name" -Value $script:Originals[$name] } }

function Get-ParitySha([byte[]]$Bytes) {
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Resolve-ParityValue($Value,[string]$Game,[string]$Pack,[string]$Plan,[string]$Batch) {
    if ($Value -is [string]) {
        if ($Value -ceq '<plan>') { return $Plan }
        if ($Value -ceq '<batch>') { return $Batch }
        if ($Value.StartsWith('<game>',[StringComparison]::Ordinal)) { return $Game+$Value.Substring(6) }
        if ($Value.StartsWith('<pack>',[StringComparison]::Ordinal)) { return $Pack+$Value.Substring(6) }
        return $Value
    }
    if ($Value -is [Collections.IDictionary]) {
        $copy=[ordered]@{}
        foreach ($key in $Value.Keys) { $copy[$key]=Resolve-ParityValue $Value[$key] $Game $Pack $Plan $Batch }
        return $copy
    }
    if ($Value -is [Array]) { return ,@($Value | ForEach-Object { Resolve-ParityValue $_ $Game $Pack $Plan $Batch }) }
    return $Value
}
function Write-ParityFiles([string]$Root,$Files,[string]$Fixtures) {
    foreach ($relative in $Files.Keys) {
        $spec=$Files[$relative]; $path=Join-Path $Root $relative
        if ($spec.Contains('dir')) { $null=[IO.Directory]::CreateDirectory($path); continue }
        $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        if ($spec.Contains('fixture')) { [IO.File]::WriteAllBytes($path,[IO.File]::ReadAllBytes((Join-Path $Fixtures $spec['fixture']))) }
        else { [IO.File]::WriteAllBytes($path,[Text.UTF8Encoding]::new($false).GetBytes([string]$spec['text'])) }
    }
}

function Get-ParityFiles([string]$Root) {
    $entries=[Collections.Generic.List[object]]::new()
    if (-not [IO.Directory]::Exists($Root)) { return ,$entries }
    foreach ($file in @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force)) {
        $relative=[IO.Path]::GetRelativePath($Root,$file.FullName).Replace('\','/')
        if ($file.Name -ceq 'manifest.json') { $entries.Add([ordered]@{path=$relative;text=[IO.File]::ReadAllText($file.FullName)}) }
        else { $bytes=[IO.File]::ReadAllBytes($file.FullName); $entries.Add([ordered]@{path=$relative;size=$bytes.Length;sha256=(Get-ParitySha $bytes)}) }
    }
    return ,$entries
}

# README.md "Normalization", steps 1-6.
$script:GuidPattern='(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])'
$script:TimePattern='\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z'
function ConvertTo-ParityText([string]$Text,$Context) {
    foreach ($pair in $Context.Roots) { $Text=$Text.Replace($pair[0],$pair[1]) }
    $Text=$Text.Replace($Context.GameHash,'<gamehash>').Replace('\\','/')
    foreach ($name in $Context.Pristine.Keys) { $Text=$Text.Replace($name,$Context.Pristine[$name]) }
    return [regex]::Replace($Text,$script:TimePattern,'<time>')
}
function Register-ParityGuids([string]$Text,$Context) {
    foreach ($match in [regex]::Matches($Text,$script:GuidPattern)) {
        if (-not $Context.Guids.Contains($match.Value)) { $Context.Guids[$match.Value]='<guid#'+($Context.Guids.Count+1)+'>' }
    }
}
function Use-ParityGuids([string]$Text,$Context,[bool]$Unknown) {
    return [regex]::Replace($Text,$script:GuidPattern,{ param($m) if ($Context.Guids.Contains($m.Value)) { $Context.Guids[$m.Value] } elseif ($Unknown) { '<guid>' } else { $m.Value } })
}

function Invoke-ParityCase([string]$Name,$Case) {
    $base=if ($TempRoot) { $TempRoot } else { [IO.Path]::GetTempPath() }
    if ($base.StartsWith('/var/')) { $base='/private'+$base }
    $root=Join-Path $base ('kvk-parity-'+[guid]::NewGuid().ToString('N'))
    $game=[IO.Path]::GetFullPath((Join-Path $root '游戏 with spaces'))
    $local=[IO.Path]::GetFullPath((Join-Path $root 'Local Data'))
    $pack=[IO.Path]::GetFullPath((Join-Path $root '配置 pack'))
    $primary=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $fixtures=Join-Path $PSScriptRoot 'fixtures'
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($primary))
    $null=[IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/sounds'))
    $null=[IO.Directory]::CreateDirectory($local)
    [IO.File]::WriteAllBytes($primary,[IO.File]::ReadAllBytes((Join-Path $fixtures $Case['fixture'])))
    if ($Case.Contains('gameFiles')) { Write-ParityFiles $game $Case['gameFiles'] $fixtures }
    if ($Case.Contains('packFiles')) { $null=[IO.Directory]::CreateDirectory($pack); Write-ParityFiles $pack $Case['packFiles'] $fixtures }
    Clear-KvkDataRootMemo
    $session=New-KvkGuiSession -RuntimeRoot $installerRoot -LocalDataRoot $local
    $script:ProcessListings=0; $script:RunningFrom=$null
    $steps=[Collections.Generic.List[object]]::new()
    $lock=$null; $lastPlan='<plan>'; $lastBatch='<batch>'; $number=0
    try {
        foreach ($step in $Case['steps']) {
            if ($step.Contains('request') -or $step.Contains('raw')) {
                $number++
                if ($step.Contains('raw')) { $value=$step['raw'] }
                else { $value=[ordered]@{v=1;requestId=('r'+$number);op=$step['request'];args=(Resolve-ParityValue $step['args'] $game $pack $lastPlan $lastBatch)} }
                # The request travels as a JSON line and is parsed exactly as the worker parses it.
                $line=ConvertTo-Json -InputObject $value -Depth 32 -Compress
                $strings=$script:KvkJsonStrings
                $request=ConvertFrom-Json -InputObject $line -AsHashtable -Depth 32 -NoEnumerate @strings
                $progress=[Collections.Generic.List[string]]::new()
                $requestId=$null; $operationId=$null
                if (Test-KvkGuiMap $request) {
                    $keys=@(Get-KvkGuiKeys $request)
                    if ('requestId' -cin $keys) { $requestId=Get-KvkGuiValue $request 'requestId' }
                    if ('op' -cin $keys -and (Get-KvkGuiValue $request 'op') -ceq 'execute' -and 'args' -cin $keys) {
                        $requestArgs=Get-KvkGuiValue $request 'args'
                        if ((Test-KvkGuiMap $requestArgs) -and 'operationId' -cin @(Get-KvkGuiKeys $requestArgs)) { $operationId=Get-KvkGuiValue $requestArgs 'operationId' }
                    }
                }
                $observer={
                    param($event)
                    $data=[pscustomobject]@{phase=$event.Phase;completed=$event.Completed;total=$event.Total;currentFile=$event.CurrentFile;batchId=$event.BatchId}
                    $progress.Add((ConvertTo-Json -InputObject ([pscustomobject]@{v=1;requestId=$requestId;type='progress';operationId=$operationId;data=$data}) -Depth 32 -Compress))
                }.GetNewClosure()
                $reply=Invoke-KvkGuiRequest -Session $session -Request $request -Observer $observer
                if ($step.Contains('compare') -and $step['compare'] -ceq 'code') {
                    $code=$null; if (-not $reply.ok) { $code=$reply.error.code }
                    $text=ConvertTo-Json -InputObject ([ordered]@{ok=$reply.ok;code=$code}) -Compress
                } else { $text=ConvertTo-Json -InputObject $reply -Depth 32 -Compress }
                if ($reply.ok -and $reply.data -is [pscustomobject] -and $null -ne $reply.data.PSObject.Properties['planId']) { $lastPlan=$reply.data.planId }
                if ($reply.ok -and $reply.data -is [pscustomobject] -and $null -ne $reply.data.PSObject.Properties['batchId'] -and $null -ne $reply.data.batchId) { $lastBatch=$reply.data.batchId }
                $steps.Add([ordered]@{progress=@($progress);reply=$text})
            } elseif ($step.Contains('setPrimary')) {
                [IO.File]::WriteAllBytes($primary,[IO.File]::ReadAllBytes((Join-Path $fixtures $step['setPrimary'])))
            } elseif ($step.Contains('appendPrimary')) {
                [IO.File]::WriteAllBytes($primary,[byte[]]([IO.File]::ReadAllBytes($primary)+[Text.Encoding]::UTF8.GetBytes([string]$step['appendPrimary'])))
            } elseif ($step.Contains('gameRunningFrom')) {
                $from=$step['gameRunningFrom']
                $script:RunningFrom=if ($null -eq $from) { $null } else { $script:ProcessListings+[int]$from }
            } elseif ($step.Contains('fault')) {
                $fault=[string]$step['fault']
                Set-Item -LiteralPath ("function:script:"+$script:FaultTargets[$fault]) -Value ([scriptblock]::Create("throw 'Injected failure at $fault'"))
            } elseif ($step.Contains('clearFaults')) {
                Clear-ParityFaults
            } elseif ($step.Contains('holdLock')) {
                $locks=Join-Path $local 'Aimloom/locks'; $null=[IO.Directory]::CreateDirectory($locks)
                $lock=[IO.File]::Open((Join-Path $locks 'palette.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
            } elseif ($step.Contains('releaseLock')) {
                if ($null -ne $lock) { $lock.Dispose(); $lock=$null }
            } else { throw "Unknown step in case $Name" }
        }
    } finally {
        if ($null -ne $lock) { $lock.Dispose() }
        Clear-ParityFaults
        Clear-KvkDataRootMemo
    }
    $gameFiles=Get-ParityFiles $game
    $localFiles=Get-ParityFiles $local
    Remove-Item -LiteralPath $root -Recurse -Force

    $jsonRoot={ param($path) $path.Replace('\','\\').Replace('"','\"') }
    $context=[pscustomobject]@{
        Roots=@(@((& $jsonRoot $game),'<game>'),@((& $jsonRoot $local),'<local>'),@((& $jsonRoot $pack),'<pack>'),@($game,'<game>'),@($local,'<local>'),@($pack,'<pack>'))
        GameHash=(Get-KvkTextHash $game.ToLowerInvariant())
        Pristine=[ordered]@{}
        Guids=[ordered]@{}
    }
    $pristine=[Collections.Generic.List[string]]::new([string[]]@($localFiles | ForEach-Object { $_.path } | Where-Object { $_ -cmatch '/pristine/files/[0-9a-f]{64}\.bin\z' }))
    $pristine.Sort([StringComparer]::Ordinal)
    foreach ($path in $pristine) { $hex=$path.Substring($path.Length-68,64); $context.Pristine[$hex]='<pristine#'+($context.Pristine.Count+1)+'>' }

    $outSteps=@()
    foreach ($s in $steps) {
        $lines=@($s.progress | ForEach-Object { ConvertTo-ParityText $_ $context })
        $reply=ConvertTo-ParityText $s.reply $context
        foreach ($l in $lines) { Register-ParityGuids $l $context }
        Register-ParityGuids $reply $context
        $outSteps+=[ordered]@{progress=@($lines | ForEach-Object { Use-ParityGuids $_ $context $false });reply=(Use-ParityGuids $reply $context $false)}
    }
    $outFiles=[ordered]@{}
    foreach ($group in @(@('game',$gameFiles),@('local',$localFiles))) {
        $items=[Collections.Generic.List[object]]::new()
        foreach ($found in $group[1]) {
            $path=ConvertTo-ParityText $found.path $context
            $items.Add([pscustomobject]@{Key=(Use-ParityGuids $path $context $true);Path=$path;Entry=$found})
        }
        # Ordinal, so both harnesses order files the same way on any Windows language.
        $items.Sort([Comparison[object]]{ param($a,$b) [string]::CompareOrdinal($a.Key,$b.Key) })
        $list=@()
        foreach ($item in $items) {
            Register-ParityGuids $item.Path $context
            $entry=[ordered]@{path=(Use-ParityGuids $item.Path $context $false)}
            if ($item.Entry.Contains('text')) {
                $text=ConvertTo-ParityText $item.Entry.text $context
                Register-ParityGuids $text $context
                $entry.text=Use-ParityGuids $text $context $false
            } else { $entry.size=$item.Entry.size; $entry.sha256=$item.Entry.sha256 }
            $list+=$entry
        }
        $outFiles[$group[0]]=@($list)
    }
    return [ordered]@{case=$Name;steps=@($outSteps);files=$outFiles}
}

$caseDir=Join-Path $PSScriptRoot 'cases'
$goldenDir=Join-Path $PSScriptRoot 'goldens'
$compareDir=if ($Write) { $goldenDir } else { Join-Path ([IO.Path]::GetTempPath()) ('kvk-parity-out-'+[guid]::NewGuid().ToString('N')) }
$null=[IO.Directory]::CreateDirectory($compareDir)
$failed=@(); $count=0
foreach ($file in @(Get-ChildItem -LiteralPath $caseDir -Filter '*.json' | Sort-Object Name -Culture '')) {
    $name=[IO.Path]::GetFileNameWithoutExtension($file.Name)
    if ($CaseFilter -and $name -notlike "*$CaseFilter*") { continue }
    $case=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($file.FullName)) -AsHashtable -Depth 32 -NoEnumerate
    $record=Invoke-ParityCase $name $case
    $text=(ConvertTo-Json -InputObject $record -Depth 16)+"`n"
    $text=$text.Replace("`r`n","`n")
    [IO.File]::WriteAllText((Join-Path $compareDir "$name.json"),$text,[Text.UTF8Encoding]::new($false))
    if (-not $Write) {
        $golden=Join-Path $goldenDir "$name.json"
        if (-not [IO.File]::Exists($golden)) { $failed+="$name (no golden)" }
        elseif ([IO.File]::ReadAllText($golden) -cne $text) { $failed+=$name }
    }
    $count++
    Write-Host "RAN $name"
}
if (-not $Write) { Remove-Item -LiteralPath $compareDir -Recurse -Force }
if ($failed.Count -gt 0) { throw "parity: golden differs for $($failed -join ', ')" }
Write-Host "parity.test.ps1: $count cases $(if ($Write) { 'written' } else { 'match their goldens' })"
