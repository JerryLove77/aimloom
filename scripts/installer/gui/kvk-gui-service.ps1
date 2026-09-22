# Dot-source after kvk-engine.ps1. This file exposes the typed GUI boundary only.

function New-KvkGuiSession {
    param(
        [Parameter(Mandatory=$true)][string]$RuntimeRoot,
        [Parameter(Mandatory=$true)][string]$LocalDataRoot
    )
    $runtime = [IO.Path]::GetFullPath($RuntimeRoot)
    $local = [IO.Path]::GetFullPath($LocalDataRoot)
    return [pscustomobject]@{RuntimeRoot=$runtime;LocalDataRoot=$local;Plan=$null}
}

# messageEn is always English (see Get-KvkEnglishText in the engine): no CJK outside
# double-quoted spans, so a quoted file or theme name may be Chinese while an untranslated
# sentence is refused. An English player never reads a Chinese message, and Rust refuses an
# issue without English.
function New-KvkGuiIssue([string]$Code,[string]$Message,[string]$MessageEn,$Path=$null) {
    return [pscustomobject]@{code=$Code;message=$Message;messageEn=(Get-KvkEnglishText $Message $MessageEn);path=$Path}
}

function Throw-KvkGuiIssue([string]$Code,[string]$Message,[string]$MessageEn,$Path=$null) {
    $exception=[InvalidOperationException]::new($Message)
    $exception.Data['KvkCode']=$Code
    $exception.Data['KvkMessageEn']=$MessageEn
    if ($null -ne $Path) { $exception.Data['KvkPath']=[string]$Path }
    throw $exception
}

function Test-KvkGuiMap($Value) {
    if ($Value -is [Collections.IDictionary]) { return $true }
    return ($null -ne $Value -and $Value.GetType() -eq [Management.Automation.PSCustomObject])
}

function Get-KvkGuiKeys($Value) {
    if ($Value -is [Collections.IDictionary]) { return @($Value.Keys | ForEach-Object {[string]$_}) }
    if ($null -ne $Value -and $Value.GetType() -eq [Management.Automation.PSCustomObject]) { return @($Value.PSObject.Properties.Name) }
    return @()
}

function Get-KvkGuiValue($Value,[string]$Name) {
    if ($Value -is [Collections.IDictionary]) { return $Value[$Name] }
    return $Value.$Name
}

function Get-KvkGuiArrayValue($Value,[string]$Name) {
    if ($Value -is [Collections.IDictionary]) { Write-Output -NoEnumerate $Value[$Name];return }
    Write-Output -NoEnumerate $Value.$Name
}

function Assert-KvkGuiFields($Value,[string[]]$Names,[string]$Label) {
    if (-not (Test-KvkGuiMap $Value)) { Throw-KvkGuiIssue 'ENGINE_ERROR' "$Label must be a JSON object." "$Label must be a JSON object." }
    $actual=@(Get-KvkGuiKeys $Value)
    foreach ($field in $Names) {
        if ($field -cnotin $actual) { Throw-KvkGuiIssue 'ENGINE_ERROR' "$Label is missing field: $field" "$Label is missing field: $field." }
    }
    foreach ($field in $actual) {
        if ($field -cnotin $Names) { Throw-KvkGuiIssue 'ENGINE_ERROR' "$Label contains an unknown field: $field" "$Label contains an unknown field: $field." }
    }
}

function Assert-KvkGuiString($Value,[string]$FieldName) {
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { Throw-KvkGuiIssue 'ENGINE_ERROR' "$FieldName must be a non-empty string." "$FieldName must be a non-empty string." }
}

function Get-KvkGuiGameState {
    try {
        $running=@(Get-Process -ErrorAction Stop | Where-Object {$_.ProcessName -in @('FPSAimTrainer','FPSAimTrainer-Win64-Shipping')})
        if ($running.Count -gt 0) { return 'running' }
        return 'closed'
    } catch { return 'unknown' }
}

function ConvertTo-KvkGuiLocation($Context) {
    return [pscustomobject]@{gameRoot=$Context.GameRoot;backupRoot=$Context.BackupRoot;gameState=(Get-KvkGuiGameState)}
}

function Get-KvkGuiDefaultPack([string]$RuntimeRoot) {
    $parent=Split-Path $RuntimeRoot -Parent
    foreach ($base in @($parent,(Split-Path $parent -Parent))) {
        if ([string]::IsNullOrWhiteSpace($base)) { continue }
        $candidate=Join-Path $base 'KVK Settings 2025'
        if ([IO.Directory]::Exists($candidate)) { return [IO.Path]::GetFullPath($candidate) }
    }
    return $null
}

function ConvertTo-KvkGuiInstallPreview($Session,$Context,$Plan,[int]$Revision,[string]$PlanId) {
    $rows=@($Plan.Items | ForEach-Object {
        [pscustomobject]@{key=$_.Key;category=$_.Category;source=$_.Source;target=$_.Target;action=$_.Action;conflict=$false;unowned=$false}
    })
    return [pscustomobject]@{
        planId=$PlanId;revision=$Revision;kind='install';location=(ConvertTo-KvkGuiLocation $Context)
        packRoot=$Plan.PackRoot;categories=@($Plan.Categories);sourceId=$null;rows=@($rows);skipped=@($Plan.Skipped)
    }
}

function ConvertTo-KvkGuiRestorePreview($Context,$Plan,[int]$Revision,[string]$PlanId) {
    $rows=@($Plan.Items | ForEach-Object {
        $category=([string]$_.Key).Split('/')[0]
        [pscustomobject]@{key=$_.Key;category=$category;source=$null;target=$_.Target;action=$_.Action;conflict=[bool]$_.Conflict;unowned=[bool]$_.Unowned}
    })
    $categories=@($rows | ForEach-Object {$_.category} | Select-Object -Unique)
    return [pscustomobject]@{
        planId=$PlanId;revision=$Revision;kind='restore';location=(ConvertTo-KvkGuiLocation $Context)
        packRoot=$null;categories=@($categories);sourceId=$Plan.Id;rows=@($rows);skipped=@()
    }
}

function ConvertTo-KvkGuiExecution($Report) {
    $items=@($Report.Items | ForEach-Object {
        $state=$null
        if ($null -ne $_.PSObject.Properties['State']) { $state=$_.State }
        elseif ($null -ne $_.PSObject.Properties['Action']) { $state=$_.Action }
        [pscustomobject]@{key=$_.Key;target=$_.Target;state=[string]$state}
    })
    # errorsEn pairs each line of errors, in order. A report made without English gets it derived.
    $errors=@($Report.Errors);$errorsEn=@()
    if ($null -ne $Report.PSObject.Properties['ErrorsEn']) { $errorsEn=@($Report.ErrorsEn) }
    if ($errorsEn.Count -ne $errors.Count) { $errorsEn=@($errors | ForEach-Object { Get-KvkEnglishText $_ }) }
    else { $errorsEn=@(for ($i=0;$i -lt $errors.Count;$i++) { Get-KvkEnglishText $errors[$i] $errorsEn[$i] }) }
    return [pscustomobject]@{status=$Report.Status;batchId=$Report.Id;items=@($items);errors=@($errors);errorsEn=@($errorsEn)}
}

function Get-KvkGuiMappedIssue($Exception) {
    # KvkMessageEn, when the thrower set it, is the English; otherwise Get-KvkErrorEnglish falls
    # back to an English exception message, then to a fixed line.
    $english=Get-KvkErrorEnglish $Exception
    if ($Exception.Data.Contains('KvkCode')) {
        $path=$null;if($Exception.Data.Contains('KvkPath')){$path=[string]$Exception.Data['KvkPath']}
        return (New-KvkGuiIssue ([string]$Exception.Data['KvkCode']) $Exception.Message $english $path)
    }
    # Unclassified execution errors stay uncertain; wording never grants safe retry.
    return (New-KvkGuiIssue 'ENGINE_ERROR' $Exception.Message $english $null)
}

function Invoke-KvkGuiOperation($Session,[string]$Op,$RequestArgs,[scriptblock]$Observer) {
    switch -CaseSensitive ($Op) {
        'profileAssetList' {
            Assert-KvkGuiFields $RequestArgs @('kind','directory') 'args'
            return (Get-KvkProfileAssets (Get-KvkGuiValue $RequestArgs 'kind') (Get-KvkGuiValue $RequestArgs 'directory'))
        }
        'profileAssetRead' {
            Assert-KvkGuiFields $RequestArgs @('kind','path') 'args'
            return (Read-KvkProfileAsset (Get-KvkGuiValue $RequestArgs 'kind') (Get-KvkGuiValue $RequestArgs 'path'))
        }
        'profileList' {
            Assert-KvkGuiFields $RequestArgs @() 'args'
            return (Get-KvkProfiles $Session.LocalDataRoot)
        }
        'profileRead' {
            Assert-KvkGuiFields $RequestArgs @('id') 'args'
            return (Get-KvkProfile $Session.LocalDataRoot (Get-KvkGuiValue $RequestArgs 'id'))
        }
        'profileSave' {
            Assert-KvkGuiFields $RequestArgs @('profile') 'args'
            return (Save-KvkProfile $Session.LocalDataRoot (Get-KvkGuiValue $RequestArgs 'profile'))
        }
        'profileDelete' {
            Assert-KvkGuiFields $RequestArgs @('id') 'args'
            return (Remove-KvkProfile $Session.LocalDataRoot (Get-KvkGuiValue $RequestArgs 'id'))
        }
        'discover' {
            Assert-KvkGuiFields $RequestArgs @() 'args'
            return [pscustomobject]@{candidates=@(Get-KvkCandidates);defaultPack=(Get-KvkGuiDefaultPack $Session.RuntimeRoot)}
        }
        'locate' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot') 'args';$gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';Assert-KvkGuiString $gameRoot 'gameRoot'
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            return (ConvertTo-KvkGuiLocation $ctx)
        }
        'catalog' {
            Assert-KvkGuiFields $RequestArgs @('packRoot') 'args';$packRoot=Get-KvkGuiValue $RequestArgs 'packRoot';Assert-KvkGuiString $packRoot 'packRoot'
            $files=Get-KvkPackFiles $packRoot
            $categories=@($files.Items | Group-Object Category | Sort-Object Name | ForEach-Object {[pscustomobject]@{category=$_.Name;count=$_.Count}})
            return [pscustomobject]@{packRoot=$files.Root;categories=@($categories);skipped=@($files.Skipped)}
        }
        'backups' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot') 'args';$gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';Assert-KvkGuiString $gameRoot 'gameRoot'
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            $all=@(Get-KvkManifests $ctx)
            $records=@($all | Where-Object {$_.Kind -ne 'pristine'} | Sort-Object @{Expression={if($_.Status -in @('prepared','applying','recovery-required')){0}else{1}}},@{Expression={[datetime]$_.CreatedAt};Descending=$true} | ForEach-Object {
                [pscustomobject]@{id=$_.Id;createdAt=$_.CreatedAt;kind=$_.Kind;status=$_.Status;categories=@($_.Categories);fileCount=@($_.Items).Count}
            })
            return [pscustomobject]@{location=(ConvertTo-KvkGuiLocation $ctx);records=@($records);hasPristine=(@($all | Where-Object {$_.Kind -eq 'pristine'}).Count -eq 1)}
        }
        'gameState' {
            Assert-KvkGuiFields $RequestArgs @() 'args'
            return (Get-KvkGuiGameState)
        }
        'planInstall' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','packRoot','categories','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$packRoot=Get-KvkGuiValue $RequestArgs 'packRoot';$categories=Get-KvkGuiArrayValue $RequestArgs 'categories';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $packRoot 'packRoot'
            if ($categories -isnot [array]) { Throw-KvkGuiIssue 'INVALID_PACK' 'categories must be an array.' 'categories must be an array.' }
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $seenCategories=@{}
            foreach($category in $categories){
                if($category -isnot [string] -or $category -cnotin @('themes','sounds','crosshairs','ui','palette','primary')){Throw-KvkGuiIssue 'INVALID_PACK' 'categories contains an unknown value.' 'categories contains an unknown value.'}
                if($seenCategories.ContainsKey($category)){Throw-KvkGuiIssue 'INVALID_PACK' 'categories must not contain duplicates.' 'categories must not contain duplicates.'}
                $seenCategories[$category]=$true
            }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能安装。' 'An unfinished operation must be recovered before installing.' }
            $plan=New-KvkPlan $ctx $packRoot ([string[]]$categories)
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $plan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$plan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$false}
            return $preview
        }
        'schemeList' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot') 'args'
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';Assert-KvkGuiString $gameRoot 'gameRoot'
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            $installed=Get-KvkInstalledThemes $ctx
            $themes=@($installed.Themes | ForEach-Object {[pscustomobject]@{name=$_.Name;file=$_.File;path=$_.Path;readable=$_.Readable;duplicateName=$_.DuplicateName}})
            return [pscustomobject]@{directory=$installed.Directory;current=$installed.Current;themes=@($themes)}
        }
        'planScheme' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','file','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$file=Get-KvkGuiValue $RequestArgs 'file';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $file 'file'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            # The game rewrites PrimaryUserSettings.json when it exits; a write made while it runs is lost.
            Assert-KvkGameClosed
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能更换背景。' 'An unfinished operation must be recovered before changing the scheme.' }
            $scheme=New-KvkSchemePlan $ctx $file
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $scheme.InstallerPlan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$scheme.InstallerPlan;Revision=[int]$revision;Preview=$preview;SchemePlan=$scheme;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$false}
            return $preview
        }
        'audioList' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot') 'args'
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';Assert-KvkGuiString $gameRoot 'gameRoot'
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            $installed=Get-KvkInstalledSounds $ctx
            $sounds=@($installed.Sounds | ForEach-Object {[pscustomobject]@{name=$_.Name;file=$_.File;path=$_.Path;ambiguous=$_.Ambiguous}})
            return [pscustomobject]@{directory=$installed.Directory;sounds=@($sounds);bindings=(Get-KvkAudioBindings $ctx)}
        }
        'planAudio' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','event','names','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$event=Get-KvkGuiValue $RequestArgs 'event';$names=Get-KvkGuiArrayValue $RequestArgs 'names';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $event 'event'
            if ($names -isnot [array]) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'names must be an array.' 'names must be an array.' }
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            # The game rewrites PrimaryUserSettings.json when it exits; a write made while it runs is lost.
            Assert-KvkGameClosed
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能更换音效。' 'An unfinished operation must be recovered before changing sounds.' }
            $audio=New-KvkAudioPlan $ctx $event ([string[]]$names)
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $audio.InstallerPlan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$audio.InstallerPlan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$audio;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$false}
            return $preview
        }
        'crosshairList' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot') 'args'
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';Assert-KvkGuiString $gameRoot 'gameRoot'
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            $installed=Get-KvkInstalledCrosshairs $ctx
            $crosshairs=@($installed.Crosshairs | ForEach-Object {[pscustomobject]@{name=$_.Name;file=$_.File;path=$_.Path}})
            return [pscustomobject]@{directory=$installed.Directory;crosshairs=@($crosshairs)}
        }
        'planCrosshair' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','file','pngBase64','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$file=Get-KvkGuiValue $RequestArgs 'file'
            $encoded=Get-KvkGuiValue $RequestArgs 'pngBase64';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $file 'file';Assert-KvkGuiString $encoded 'pngBase64'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            if ($encoded.Length -gt 4 * [Math]::Ceiling(2MB / 3) -or $encoded.Length % 4 -ne 0 -or $encoded -cnotmatch '^[A-Za-z0-9+/]*={0,2}$') { Throw-KvkGuiIssue 'ENGINE_ERROR' '准星 PNG 编码无效或超出大小限制。' 'The crosshair PNG encoding is invalid or over the size limit.' }
            try { $png=[Convert]::FromBase64String($encoded) } catch { Throw-KvkGuiIssue 'ENGINE_ERROR' '准星 PNG 编码无效。' 'The crosshair PNG encoding is invalid.' }
            if ([Convert]::ToBase64String($png) -cne $encoded) { Throw-KvkGuiIssue 'ENGINE_ERROR' '准星 PNG 编码不是规范 base64。' 'The crosshair PNG encoding is not canonical base64.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能替换准星。' 'An unfinished operation must be recovered before replacing a crosshair.' }
            $crosshair=New-KvkCrosshairImagePlan $ctx $file $png
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $crosshair.Plan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$crosshair.Plan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$crosshair;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$true}
            return $preview
        }
        'planCrosshairAdd' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','file','pngBase64','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$file=Get-KvkGuiValue $RequestArgs 'file'
            $encoded=Get-KvkGuiValue $RequestArgs 'pngBase64';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $file 'file';Assert-KvkGuiString $encoded 'pngBase64'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            if ($encoded.Length -gt 4 * [Math]::Ceiling(2MB / 3) -or $encoded.Length % 4 -ne 0 -or $encoded -cnotmatch '^[A-Za-z0-9+/]*={0,2}$') { Throw-KvkGuiIssue 'ENGINE_ERROR' '准星 PNG 编码无效或超出大小限制。' 'The crosshair PNG encoding is invalid or over the size limit.' }
            try { $png=[Convert]::FromBase64String($encoded) } catch { Throw-KvkGuiIssue 'ENGINE_ERROR' '准星 PNG 编码无效。' 'The crosshair PNG encoding is invalid.' }
            if ([Convert]::ToBase64String($png) -cne $encoded) { Throw-KvkGuiIssue 'ENGINE_ERROR' '准星 PNG 编码不是规范 base64。' 'The crosshair PNG encoding is not canonical base64.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能添加准星。' 'An unfinished operation must be recovered before adding a crosshair.' }
            $crosshair=New-KvkCrosshairAddPlan $ctx $file $png
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $crosshair.Plan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$crosshair.Plan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$crosshair;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$true}
            return $preview
        }
        'planFileAdd' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','kind','sourcePath','sourceSha256','file','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$kind=Get-KvkGuiValue $RequestArgs 'kind';$file=Get-KvkGuiValue $RequestArgs 'file'
            $sourcePath=Get-KvkGuiValue $RequestArgs 'sourcePath';$sourceHash=Get-KvkGuiValue $RequestArgs 'sourceSha256';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $kind 'kind';Assert-KvkGuiString $file 'file'
            Assert-KvkGuiString $sourcePath 'sourcePath';Assert-KvkGuiString $sourceHash 'sourceSha256'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '上一次操作没有完成，请先到「一键拖入」处理，再添加文件 (an unfinished operation must be recovered first)。' 'The last operation did not finish. Resolve it in Quick import before adding files.' }
            # The engine reads the source itself and checks it against the hash the sheet previewed.
            $add=New-KvkFileAddPlan $ctx $kind $sourcePath $sourceHash $file
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $add.Plan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$add.Plan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$add;ProfileApplyPlan=$null;AllowRunningGame=$true}
            return $preview
        }
        'enemyList' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot') 'args'
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';Assert-KvkGuiString $gameRoot 'gameRoot'
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            $listed=Get-KvkEnemySkins $ctx
            $current=[pscustomobject]@{cylindrical=$listed.Current.cylindrical;cuboid=$listed.Current.cuboid;spheroid=$listed.Current.spheroid}
            return [pscustomobject]@{current=$current;skins=@($listed.Skins)}
        }
        'planEnemy' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','shape','model','skin','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$shape=Get-KvkGuiValue $RequestArgs 'shape'
            $model=Get-KvkGuiValue $RequestArgs 'model';$skin=Get-KvkGuiValue $RequestArgs 'skin';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $shape 'shape';Assert-KvkGuiString $model 'model';Assert-KvkGuiString $skin 'skin'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            # The game rewrites PrimaryUserSettings.json when it exits; a write made while it runs is lost.
            Assert-KvkGameClosed
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能更换敌人皮肤。' 'An unfinished operation must be recovered before changing the enemy skin.' }
            $enemy=New-KvkEnemySkinPlan $ctx $shape $model $skin
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $enemy.Plan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='install';Context=$ctx;Plan=$enemy.Plan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$enemy;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$false}
            return $preview
        }
        'planProfileApply' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','id','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$id=Get-KvkGuiValue $RequestArgs 'id';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $id 'id'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            # The game rewrites PrimaryUserSettings.json when it exits; a write made while it runs is lost.
            Assert-KvkGameClosed
            if (@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先恢复未完成的操作，才能应用 Profile。' 'An unfinished operation must be recovered before applying a Profile.' }
            $apply=New-KvkProfileApplyPlan $ctx $id
            $planId=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiInstallPreview $Session $ctx $apply.InstallerPlan ([int]$revision) $planId
            $Session.Plan=[pscustomobject]@{Id=$planId;Kind='install';Context=$ctx;Plan=$apply.InstallerPlan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$apply;AllowRunningGame=$false}
            return $preview
        }
        'planRestore' {
            Assert-KvkGuiFields $RequestArgs @('gameRoot','sourceId','revision') 'args'
            $Session.Plan=$null
            $gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot';$sourceId=Get-KvkGuiValue $RequestArgs 'sourceId';$revision=Get-KvkGuiValue $RequestArgs 'revision'
            Assert-KvkGuiString $gameRoot 'gameRoot';Assert-KvkGuiString $sourceId 'sourceId'
            if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'revision must be a non-negative integer.' 'revision must be a non-negative integer.' }
            $ctx=New-KvkContext $gameRoot $Session.LocalDataRoot
            $pending=@(Get-KvkManifests $ctx | Where-Object {$_.Status -in @('prepared','applying','recovery-required')})
            if($pending.Count -gt 0 -and $sourceId -cnotin @($pending | ForEach-Object {$_.Id})) { Throw-KvkGuiIssue 'RECOVERY_REQUIRED' '必须先处理未完成的恢复批次，才能再次恢复。' 'The pending recovery batch must be handled before another restore.' }
            $plan=New-KvkRestorePlan $ctx $sourceId
            $id=[Guid]::NewGuid().ToString('N');$preview=ConvertTo-KvkGuiRestorePreview $ctx $plan ([int]$revision) $id
            $Session.Plan=[pscustomobject]@{Id=$id;Kind='restore';Context=$ctx;Plan=$plan;Revision=[int]$revision;Preview=$preview;SchemePlan=$null;AudioPlan=$null;CrosshairPlan=$null;CrosshairAddPlan=$null;EnemyPlan=$null;FileAddPlan=$null;ProfileApplyPlan=$null;AllowRunningGame=$false}
            return $preview
        }
        'exportFile' {
            Assert-KvkGuiFields $RequestArgs @('directory','fileName','base64','gameRoot') 'args'
            $directory=Get-KvkGuiValue $RequestArgs 'directory';$fileName=Get-KvkGuiValue $RequestArgs 'fileName'
            $encoded=Get-KvkGuiValue $RequestArgs 'base64';$gameRoot=Get-KvkGuiValue $RequestArgs 'gameRoot'
            Assert-KvkGuiString $directory 'directory';Assert-KvkGuiString $fileName 'fileName';Assert-KvkGuiString $encoded 'base64';Assert-KvkGuiString $gameRoot 'gameRoot'
            if ($encoded.Length -gt 4 * [Math]::Ceiling(2MB / 3) -or $encoded.Length % 4 -ne 0 -or $encoded -cnotmatch '^[A-Za-z0-9+/]*={0,2}$') { Throw-KvkGuiIssue 'ENGINE_ERROR' '导出内容编码无效或超出大小限制。' 'The export encoding is invalid or over the size limit.' }
            try { $bytes=[Convert]::FromBase64String($encoded) } catch { Throw-KvkGuiIssue 'ENGINE_ERROR' '导出内容编码无效。' 'The export encoding is invalid.' }
            if ([Convert]::ToBase64String($bytes) -cne $encoded) { Throw-KvkGuiIssue 'ENGINE_ERROR' '导出内容不是规范 base64。' 'The export encoding is not canonical base64.' }
            return (Export-KvkFile $directory $fileName $bytes $gameRoot)
        }
        'execute' {
            Assert-KvkGuiFields $RequestArgs @('operationId','planId','confirmation','allowConflicts') 'args'
            $operationId=Get-KvkGuiValue $RequestArgs 'operationId';$planId=Get-KvkGuiValue $RequestArgs 'planId';$confirmation=Get-KvkGuiValue $RequestArgs 'confirmation';$allow=Get-KvkGuiValue $RequestArgs 'allowConflicts'
            Assert-KvkGuiString $operationId 'operationId';Assert-KvkGuiString $planId 'planId';Assert-KvkGuiString $confirmation 'confirmation'
            if ($allow -isnot [bool]) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'allowConflicts must be boolean.' 'allowConflicts must be boolean.' }
            $cached=$Session.Plan
            if ($null -eq $cached -or $cached.Id -cne $planId) { Throw-KvkGuiIssue 'PLAN_MISSING' '预览已失效，请重新生成。' 'The preview is no longer available. Create a new preview.' }
            $Session.Plan=$null
            if ($confirmation -cne $cached.Kind) { Throw-KvkGuiIssue 'PLAN_STALE' '确认内容与缓存的清单不一致。' 'Confirmation does not match the cached plan.' }
            if ($cached.Kind -eq 'install') {
                if ($allow) { Throw-KvkGuiIssue 'CONFLICT' '安装清单不接受冲突覆盖许可。' 'Install plans do not accept conflict permission.' }
                if ($null -ne $cached.SchemePlan) { $report=Invoke-KvkSchemeReplacement $cached.Context $cached.SchemePlan -Observer $Observer }
                elseif ($null -ne $cached.AudioPlan) { $report=Invoke-KvkAudioReplacement $cached.Context $cached.AudioPlan -Observer $Observer }
                elseif ($null -ne $cached.CrosshairPlan) { $report=Invoke-KvkCrosshairImageReplacement $cached.Context $cached.CrosshairPlan -Observer $Observer }
                elseif ($null -ne $cached.CrosshairAddPlan) { $report=Invoke-KvkCrosshairAdd $cached.Context $cached.CrosshairAddPlan -Observer $Observer }
                elseif ($null -ne $cached.EnemyPlan) { $report=Invoke-KvkEnemySkinReplacement $cached.Context $cached.EnemyPlan -Observer $Observer }
                elseif ($null -ne $cached.FileAddPlan) { $report=Invoke-KvkFileAdd $cached.Context $cached.FileAddPlan -Observer $Observer }
                elseif ($null -ne $cached.ProfileApplyPlan) { $report=Invoke-KvkProfileApply $cached.Context $cached.ProfileApplyPlan -Observer $Observer }
                else { $report=Invoke-KvkInstall $cached.Context $cached.Plan -Observer $Observer }
            } else {
                if (@($cached.Plan.Items | Where-Object {$_.Unowned}).Count -gt 0) { Throw-KvkGuiIssue 'UNOWNED_FILE' '无法确认文件由本工具创建，不能删除。' 'Cannot delete a file without proof that this installer created it.' }
                if (@($cached.Plan.Items | Where-Object {$_.Conflict}).Count -gt 0 -and -not $allow) { Throw-KvkGuiIssue 'CONFLICT' '恢复冲突需要明确确认。' 'Restore conflicts require explicit confirmation.' }
                $report=Invoke-KvkRestore $cached.Context $cached.Plan -AllowConflicts:$allow -Observer $Observer
            }
            return (ConvertTo-KvkGuiExecution $report)
        }
        default { Throw-KvkGuiIssue 'ENGINE_ERROR' "Unknown operation: $Op" "Unknown operation: $Op." }
    }
}

function Invoke-KvkGuiRequest {
    param(
        [Parameter(Mandatory=$true)]$Session,
        $Request,
        [scriptblock]$Observer=$null
    )
    $requestId=$null;$op=$null
    try {
        Assert-KvkGuiFields $Request @('v','requestId','op','args') 'request'
        $version=Get-KvkGuiValue $Request 'v';$requestId=Get-KvkGuiValue $Request 'requestId';$op=Get-KvkGuiValue $Request 'op';$args=Get-KvkGuiValue $Request 'args'
        if (($version -isnot [int] -and $version -isnot [long]) -or $version -ne 1) { Throw-KvkGuiIssue 'ENGINE_ERROR' 'Unsupported protocol version.' 'Unsupported protocol version.' }
        Assert-KvkGuiString $requestId 'requestId';Assert-KvkGuiString $op 'op'
        if ($op -cnotin @('discover','locate','catalog','backups','gameState','planInstall','planRestore','schemeList','planScheme','audioList','planAudio','crosshairList','planCrosshair','planCrosshairAdd','exportFile','enemyList','planEnemy','planProfileApply','planFileAdd','execute','profileList','profileRead','profileSave','profileDelete','profileAssetList','profileAssetRead')) { Throw-KvkGuiIssue 'ENGINE_ERROR' "Unknown operation: $op" "Unknown operation: $op." }
        $data=Invoke-KvkGuiOperation $Session $op $args $Observer
        return [pscustomobject]@{v=1;requestId=$requestId;type='reply';ok=$true;data=$data}
    } catch {
        $issue=Get-KvkGuiMappedIssue $_.Exception
        if($op -cin @('profileList','profileRead','profileSave','profileDelete','profileAssetList','profileAssetRead') -and -not $_.Exception.Data.Contains('KvkCode')){$issue.message='Profile 存储操作失败，请检查文件和目录权限。';$issue.messageEn='The Profile store could not be read or written. Check the files and folder permissions.'}
        # The operation, not English exception wording, determines read-only guidance.
        if($issue.code -eq 'ENGINE_ERROR' -and -not $_.Exception.Data.Contains('KvkCode')) {
            switch -CaseSensitive ($op) {
                'locate' {$issue.code='INVALID_PATH'}
                'catalog' {$issue.code='INVALID_PACK'}
                'backups' {$issue.code='BACKUP_INVALID'}
                'planRestore' {$issue.code='BACKUP_INVALID'}
            }
        }
        return [pscustomobject]@{v=1;requestId=$requestId;type='reply';ok=$false;error=$issue}
    }
}
