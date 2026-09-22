#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Menu','Check','Baseline','Capture','Compare')][string]$Mode='Menu',
    [string]$GameRoot,
    [string]$KitRoot=$PSScriptRoot,
    [string]$OutputRoot,
    [string]$SessionRoot,
    [string]$Label='capture'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Crosshair-Test.Core.ps1')
function Resolve-AimSelection([string]$Selected,[bool]$Interactive) {
    if($Selected){return $Selected}
    $candidates=@(Find-AimGameRoots)
    if($candidates.Count -eq 1){return $candidates[0]}
    if($Interactive){
        if($candidates.Count){Write-Host ('找到的候选目录：'+($candidates -join ', '))}
        return (Read-Host '粘贴游戏安装根目录（包含 FPSAimTrainer 子目录）').Trim().Trim('"')
    }
    Throw-AimTest 'GAME_ROOT_REQUIRED' '无法唯一确定游戏目录，请使用 -GameRoot 明确指定'
}
function Write-AimOperationResult($Result) {
    $Result|ConvertTo-Json -Depth 12|Write-Host
    if($Result.PSObject.Properties['reportPath']){Write-Host ('报告：'+$Result.reportPath)}
    if($Result.PSObject.Properties['sessionRoot']){Write-Host ('会话目录（后续继续使用）：'+$Result.sessionRoot)}
}
try {
    if(-not $IsWindows){Throw-AimTest 'UNSUPPORTED_PLATFORM' '这个入口用于 Windows；容器测试使用模拟目录，不代表实机验收'}
    if($Mode -ne 'Menu') {
        $selected=Resolve-AimSelection $GameRoot $false
        $context=New-AimTestContext $KitRoot $selected $OutputRoot -AllowMissing:($Mode -in @('Capture','Compare','Menu'))
        $result=switch($Mode){
            'Check' {Get-AimTestCheck $context}
            'Baseline' {New-AimTestBaseline $context}
            'Capture' {if(-not $SessionRoot){Throw-AimTest 'SESSION_REQUIRED' '采集需要 -SessionRoot 基线会话目录'};New-AimTestCapture $context $SessionRoot $Label}
            'Compare' {if(-not $SessionRoot){Throw-AimTest 'SESSION_REQUIRED' '核对需要 -SessionRoot 基线会话目录'};Compare-AimTestRestoration $context $SessionRoot}
        }
        $result|ConvertTo-Json -Depth 12
        exit 0
    }
    Write-Host 'Aimloom 准星实机测试助手'
    Write-Host '只读游戏文件，写入独立的测试记录；不安装、不删除、不恢复游戏文件。'
    $selected=Resolve-AimSelection $GameRoot $true
    Write-Host ('将读取游戏目录：'+$selected)
    $context=New-AimTestContext $KitRoot $selected $OutputRoot -AllowMissing:($Mode -in @('Capture','Compare','Menu'))
    while($true){
        Write-Host ''
        Write-Host '1 检查环境和测试包'
        Write-Host '2 保存安装前基线（先退出游戏）'
        Write-Host '3 采集测试后的文件变化（先退出游戏）'
        Write-Host '4 核对恢复结果（原准星恢复后，先退出游戏）'
        Write-Host '0 退出'
        $choice=Read-Host '输入编号'
        if($choice -eq '0'){break}
        try {
            switch($choice){
                '1' {Write-AimOperationResult (Get-AimTestCheck $context)}
                '2' {
                    Write-Host '基线会复制 SaveGames 和原有准星文件，只用于保护与对照。请在安装测试素材前执行。'
                    $result=New-AimTestBaseline $context
                    $SessionRoot=$result.sessionRoot
                    Write-AimOperationResult $result
                }
                '3' {
                    if(-not $SessionRoot){$SessionRoot=(Read-Host '粘贴此前生成的 session-... 会话目录').Trim().Trim('"')}
                    $captureLabel=Read-Host '标签（例如 simple-cross 或 after-restart，留空使用 capture）'
                    if(-not $captureLabel){$captureLabel='capture'}
                    Write-AimOperationResult (New-AimTestCapture $context $SessionRoot $captureLabel)
                }
                '4' {
                    if(-not $SessionRoot){$SessionRoot=(Read-Host '粘贴此前生成的 session-... 会话目录').Trim().Trim('"')}
                    Write-AimOperationResult (Compare-AimTestRestoration $context $SessionRoot)
                    Write-Host '这里只核对文件；游戏里的外观、缩放和选中状态仍需你观察。'
                }
                default {Write-Host '请输入 0–4。'}
            }
        } catch {Write-Host $_.Exception.Message -ForegroundColor Red;Write-Host '操作未完成，不能将其记录为通过。'}
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
