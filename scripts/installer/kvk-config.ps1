#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Restore')][string]$Mode = 'Install',
    [string]$GameDir,
    [string]$PackDir
)

# Dot-sourcing defines only the interactive functions. The executable entry loads
# its sibling engine below; there are no environment or process bypass switches.
$script:KvkRuntimeRoot = $PSScriptRoot

function Read-KvkAnswer {
    param([string]$Prompt)
    $answer = Read-Host $Prompt
    if ($null -eq $answer) { return '' }
    $answer = $answer.Trim()
    if ($answer -ieq 'q') { throw [OperationCanceledException]::new('用户取消。') }
    return $answer
}

function Confirm-KvkChoice {
    param([string]$Prompt, [bool]$Default = $false)
    $suffix = if ($Default) { ' [Y/n，q 取消]' } else { ' [y/N，q 取消]' }
    while ($true) {
        $answer = Read-KvkAnswer ($Prompt + $suffix)
        if ($answer -eq '') { return $Default }
        if ($answer -imatch '^(y|yes|是)$') { return $true }
        if ($answer -imatch '^(n|no|否)$') { return $false }
        Write-Host '请输入 y 或 n；输入 q 取消。'
    }
}

function Select-KvkFolder {
    param([string]$Description)
    Write-Host ($Description + '。将尝试打开系统文件夹选择器；也可随后输入完整路径。')
    $selected = $null
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $dialog = $null
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            $dialog.Description = $Description
            $dialog.ShowNewFolderButton = $false
            if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $selected = $dialog.SelectedPath }
        } catch {
            Write-Host ('文件夹选择器不可用：' + $_.Exception.Message)
        } finally {
            if ($null -ne $dialog) { $dialog.Dispose() }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($selected)) { return $selected }
    $selected = Read-KvkAnswer ($Description + '，输入完整路径（留空或 q 取消）')
    if ([string]::IsNullOrWhiteSpace($selected)) { throw [OperationCanceledException]::new('未选择目录。') }
    return $selected.Trim('"')
}

function Get-KvkDefaultPack {
    param([string]$RuntimeRoot = $script:KvkRuntimeRoot)
    # Source checkout: scripts/installer; ZIP: scripts.
    $parent = Split-Path $RuntimeRoot -Parent
    $releasePack = Join-Path $parent 'KVK Settings 2025'
    if (Test-Path -LiteralPath $releasePack -PathType Container) { return $releasePack }
    $repoPack = Join-Path (Split-Path $parent -Parent) 'KVK Settings 2025'
    if (Test-Path -LiteralPath $repoPack -PathType Container) { return $repoPack }
    return Select-KvkFolder '请选择已解压的配置包目录'
}

function Select-KvkGame {
    param([string]$Hint)
    if (-not [string]::IsNullOrWhiteSpace($Hint)) { return Get-KvkGameRoot -Path $Hint }
    $candidates = @(Get-KvkCandidates)
    if ($candidates.Count -eq 1) {
        Write-Host ('检测到游戏目录：' + $candidates[0])
        if (Confirm-KvkChoice '使用此游戏目录？选择 n 可手动指定其他安装位置' $true) {
            return Get-KvkGameRoot -Path $candidates[0]
        }
    }
    if ($candidates.Count -gt 1) {
        Write-Host '检测到多个游戏安装位置，请选择：'
        for ($i = 0; $i -lt $candidates.Count; $i++) { Write-Host ('{0}. {1}' -f ($i + 1), $candidates[$i]) }
        while ($true) {
            $answer = Read-KvkAnswer '输入编号，m 手动选择，q 取消'
            if ($answer -ieq 'm') { break }
            $index = 0
            if ([int]::TryParse($answer, [ref]$index) -and $index -ge 1 -and $index -le $candidates.Count) {
                return Get-KvkGameRoot -Path $candidates[$index - 1]
            }
            Write-Host '请输入列表中的编号，或 m 手动选择。'
        }
    }
    Write-Host '请选择包含 FPSAimTrainer 子目录的游戏根目录；内层目录也会尝试归一化。'
    Write-Host '如果还未生成设置，请先启动游戏并正常退出一次。'
    return Get-KvkGameRoot -Path (Select-KvkFolder '请选择游戏目录')
}

function Show-KvkSkipped {
    param($Items)
    foreach ($item in @($Items)) { Write-Host ('跳过（不安装）：' + [string]$item) }
}

function Show-KvkPlan {
    param($Context, $Plan, [switch]$Restore)
    Write-Host ''
    Write-Host '请核对本次操作：'
    Write-Host ('游戏目录：' + $Context.GameRoot)
    Write-Host ('Palette 独立目录：' + (Join-Path $Context.LocalDataRoot 'FPSAimTrainer/Saved/Config/WindowsNoEditor'))
    Write-Host ('永久备份位置：' + $Context.BackupRoot)
    if ($Restore) {
        Write-Host ('恢复记录：' + $Plan.Id)
        Write-Host '以下列出全部影响路径；未列出的用户文件不会清理。'
    }
    $labels = @{create='新增';replace='覆盖';skip='相同／已恢复，跳过';restore='恢复';delete='删除本次新增'}
    foreach ($item in @($Plan.Items)) {
        $label = [string]$item.Action
        if ($labels.ContainsKey($label)) { $label = $labels[$label] }
        Write-Host ('[{0}] {1}' -f $label, $item.Target)
    }
    foreach ($action in @('create','replace','restore','delete','skip')) {
        $count = @($Plan.Items | Where-Object { $_.Action -eq $action }).Count
        if ($count -gt 0) { Write-Host ('{0}：{1} 个文件' -f $labels[$action], $count) }
    }
    if (-not $Restore) { Show-KvkSkipped $Plan.Skipped }
    Write-Host '继续前请正常退出 KovaaK；检测到游戏运行或状态无法确认时会停止，不会强制关闭游戏。'
}

function Show-KvkResult {
    param($Result, $Context)
    Write-Host ('结果状态：' + $Result.Status)
    if ($Result.Id) { Write-Host ('备份／操作编号：' + $Result.Id) }
    Write-Host ('备份保留在：' + $Context.BackupRoot)
    foreach ($item in @($Result.Items)) {
        $status = '待核对'
        if ($item.PSObject.Properties['Action']) { $status = [string]$item.Action }
        if ($item.PSObject.Properties['Status']) { $status = [string]$item.Status }
        if ($item.PSObject.Properties['State']) { $status = [string]$item.State }
        Write-Host ('[{0}] {1}' -f $status, $item.Target)
    }
    foreach ($errorMessage in @($Result.Errors)) { Write-Host ('错误／待处理：' + $errorMessage) }
    if ($Result.Status -eq 'recovery-required') {
        Write-Host '尚有文件待恢复。请保留以上备份，解决列出的原因后运行“恢复配置.cmd”重试。'
    } elseif ($Result.Status -eq 'rolled-back') {
        Write-Host '安装未完成，本次修改已撤销；备份仍保留。'
    }
}

function Invoke-KvkRestoreWizard {
    param($Context, $Backups, [string]$PendingId)
    $id = $PendingId
    if ([string]::IsNullOrWhiteSpace($id)) {
        $installs = @($Backups | Where-Object { $_.Kind -eq 'install' -and $_.Status -eq 'completed' })
        Write-Host '恢复方式：撤销某次安装，或恢复每个文件首次被工具保护前的状态。'
        Write-Host '首次保护状态不是游戏出厂设置；它覆盖所有曾接管路径。'
        for ($i = 0; $i -lt $installs.Count; $i++) {
            Write-Host ('{0}. 撤销 {1}  时间 {2}  状态 {3}' -f ($i + 1), $installs[$i].Id, $installs[$i].CreatedAt, $installs[$i].Status)
        }
        Write-Host 'p. 恢复首次保护状态'
        while ($true) {
            $answer = Read-KvkAnswer '输入编号（留空选最近一次），p 首次保护状态，q 取消'
            if ($answer -ieq 'p') { $id = 'pristine'; break }
            if ($answer -eq '' -and $installs.Count -gt 0) { $id = $installs[0].Id; break }
            $index = 0
            if ([int]::TryParse($answer, [ref]$index) -and $index -ge 1 -and $index -le $installs.Count) { $id=$installs[$index-1].Id; break }
            Write-Host '请输入可用编号、p 或 q。'
        }
    } else {
        Write-Host ('发现未完成操作 ' + $id + '，必须先恢复。恢复完成后，请重新运行安装入口。')
    }
    $plan = New-KvkRestorePlan -Context $Context -Id $id
    Show-KvkPlan -Context $Context -Plan $plan -Restore
    if (@($plan.Conflicts).Count -gt 0) {
        Write-Host '以下文件在安装后被修改，恢复将覆盖或删除这些当前内容：'
        foreach ($conflict in @($plan.Conflicts)) { Write-Host ('冲突：' + $conflict) }
    }
    if (-not (Confirm-KvkChoice '确认执行以上恢复计划？')) { return 2 }
    $allowConflicts = $false
    if (@($plan.Conflicts).Count -gt 0) {
        $allowConflicts = Confirm-KvkChoice '明确允许处理以上冲突？工具会先另存当前文件，再执行恢复'
        if (-not $allowConflicts) { return 2 }
    }
    Write-Host '正在校验备份并恢复文件，可能需要几分钟。请保持此窗口开启，暂勿启动游戏。'
    $result = Invoke-KvkRestore -Context $Context -Plan $plan -AllowConflicts:$allowConflicts
    Show-KvkResult -Result $result -Context $Context
    if ($result.Status -eq 'restored') { Write-Host '恢复完成。'; return 0 }
    return 1
}

function Invoke-KvkCli {
    [CmdletBinding()]
    param([ValidateSet('Install','Restore')][string]$Mode='Install', [string]$GameDir, [string]$PackDir)
    try {
        Write-Host 'KovaaK 配置安装器 v0.1.0'
        Write-Host '随时输入 q 取消。备份独立保留，恢复无需原配置包。'
        $root = Select-KvkGame -Hint $GameDir
        $localData = [Environment]::GetFolderPath('LocalApplicationData')
        if ([string]::IsNullOrWhiteSpace($localData)) { throw '无法取得当前用户 LocalAppData，已停止。' }
        $context = New-KvkContext -GameRoot $root -LocalDataRoot $localData
        $backups = @(Get-KvkBackupList -Context $context)
        $pending = @($backups | Where-Object { $_.Status -in @('prepared','applying','recovery-required') })
        if ($pending.Count -gt 0) {
            foreach ($job in $pending) { Write-Host ('未完成：{0}  {1}  {2}' -f $job.Id,$job.CreatedAt,$job.Status) }
            return Invoke-KvkRestoreWizard -Context $context -Backups $backups -PendingId $pending[0].Id
        }
        if ($Mode -eq 'Restore') {
            if ($backups.Count -eq 0) { Write-Host '此游戏位置没有可用备份。'; return 1 }
            return Invoke-KvkRestoreWizard -Context $context -Backups $backups
        }
        if ([string]::IsNullOrWhiteSpace($PackDir)) {
            $PackDir = Get-KvkDefaultPack
            Write-Host ('默认配置包：' + $PackDir)
            if (-not (Confirm-KvkChoice '使用此配置包？选择 n 可指定其他已解压配置包' $true)) {
                $PackDir = Select-KvkFolder '请选择其他已解压的配置包目录'
            }
        }
        $catalog = Get-KvkCatalog -PackRoot $PackDir
        Write-Host ('配置包：' + $PackDir)
        Show-KvkSkipped $catalog.Skipped
        if (@($catalog.Categories).Count -eq 0) { throw '配置包没有可安装内容。' }
        $names = @{themes='主题';sounds='音效';crosshairs='准星';ui='界面 UI.json';palette='配色 Palette.ini';primary='完整设置 PrimaryUserSettings.json'}
        $selected = @()
        foreach ($category in @('themes','sounds','crosshairs','ui','palette','primary')) {
            if ($category -notin @($catalog.Categories)) { Write-Host ($names[$category] + '：包内不存在，不可选'); continue }
            if ($category -eq 'primary') {
                Write-Host '警告：使用包内 PrimaryUserSettings.json，覆盖当前灵敏度、DPI、FOV 等该文件中的设置。原文件会备份，可恢复。'
            } elseif ($category -in @('ui','palette')) {
                Write-Host ($names[$category] + '：将整体替换该文件，原文件会备份。')
            }
            if (Confirm-KvkChoice ('安装' + $names[$category] + '？') ($category -in @('themes','sounds','crosshairs'))) { $selected += $category }
        }
        if ($selected.Count -eq 0) { Write-Host '未选择任何内容，已取消。'; return 2 }
        $plan = New-KvkPlan -Context $context -PackRoot $PackDir -Categories $selected
        Write-Host ('所选类别：' + (($selected | ForEach-Object { $names[$_] }) -join '、'))
        Show-KvkPlan -Context $context -Plan $plan
        if (-not (Confirm-KvkChoice '确认按以上清单安装？')) { Write-Host '已取消，未执行安装。'; return 2 }
        Write-Host '正在备份并安装文件，可能需要几分钟。请保持此窗口开启，暂勿启动游戏。'
        $result = Invoke-KvkInstall -Context $context -Plan $plan
        Show-KvkResult -Result $result -Context $context
        if ($result.Status -in @('completed','no-change')) {
            Write-Host '文件处理完成。素材复制后仍需在游戏中选择主题、绑定音效、选择准星；不会自动应用素材。'
            Write-Host '需要撤销时，请退出游戏并运行“恢复配置.cmd”。'
            return 0
        }
        return 1
    } catch [OperationCanceledException] {
        Write-Host '已取消，未继续执行。'
        return 2
    } catch {
        Write-Host ('操作停止：' + $_.Exception.Message)
        Write-Host '请保留已有备份。确认游戏已退出；若目录尚未生成设置，请先运行并正常退出游戏一次。'
        return 1
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    try {
        . (Join-Path $PSScriptRoot 'kvk-engine.ps1')
        $exitCode = Invoke-KvkCli -Mode $Mode -GameDir $GameDir -PackDir $PackDir
        exit $exitCode
    } catch {
        Write-Host ('无法启动安装器：' + $_.Exception.Message)
        exit 1
    }
}
