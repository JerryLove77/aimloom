#Requires -Version 7.0
. (Join-Path $PSScriptRoot 'kvk-scheme.ps1')
. (Join-Path $PSScriptRoot 'kvk-audio.ps1')

# Adds one file from outside the game — a theme JSON or a sound — to the folder the game reads.
# It is an ordinary single-file install through the engine: backed up, recoverable, recorded
# for undo. It never overwrites, never rewrites the bytes, and changes nothing that is in
# effect: a theme still has to be applied and a sound still has to be bound.

function Assert-KvkImportKind([string]$Kind) {
    if ($Kind -cnotin @('theme','sound')) { Throw-KvkFailure 'ENGINE_ERROR' '导入类型无效：只能是主题或音效。' 'The kind must be theme or sound.' }
}

function Assert-KvkImportFileName([string]$Kind,[string]$FileName) {
    $extensions=if ($Kind -ceq 'theme') { @('.json') } else { @('.wav','.ogg') }
    $invalid=[string]::IsNullOrWhiteSpace($FileName) -or $FileName.Length -gt 128 -or
        $FileName -match '[\\/:*?"<>|\x00-\x1f]' -or $FileName -match '^[. ]|[. ]$' -or $FileName.Contains('..') -or
        [IO.Path]::GetExtension($FileName) -inotin $extensions -or
        $FileName.Split('.')[0] -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])$'
    if (-not $invalid) {
        $stem=[IO.Path]::GetFileNameWithoutExtension($FileName)
        # A sound is bound by its stem, and ';' separates names in the game's settings.
        $invalid=[string]::IsNullOrWhiteSpace($stem) -or $stem -match '[. ]$' -or ($Kind -ceq 'sound' -and $stem.Contains(';'))
    }
    if ($invalid) {
        $wanted=if ($Kind -ceq 'theme') { '.json' } else { '.wav 或 .ogg' }
        $wantedEn=if ($Kind -ceq 'theme') { '.json' } else { '.wav or .ogg' }
        Throw-KvkFailure 'INVALID_PATH' "文件名无效：必须以 $wanted 结尾，不能包含 \ / : * ? `" < > | ; 或连续的点，不能以点或空格开头结尾，总长不超过 128 个字符: $FileName" "The file name is not valid: it must end with $wantedEn, cannot contain \ / : * ? < > | ; a double quote, or consecutive dots, cannot start or end with a dot or a space, and must be at most 128 characters: `"$FileName`"."
    }
}

function Get-KvkImportStageBase($Context) { return (Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) 'import-previews') }

# Removes one staging folder. It only ever touches <data root>/import-previews/<32 hex>.
function Remove-KvkImportStage($Context,[string]$Stage) {
    try {
        if ([string]::IsNullOrWhiteSpace($Stage)) { return }
        $base=Get-KvkFullPath (Get-KvkImportStageBase $Context)
        $full=Get-KvkFullPath $Stage
        if ([IO.Path]::GetDirectoryName($full) -ine $base -or [IO.Path]::GetFileName($full) -notmatch '^[0-9a-f]{32}$') { return }
        if ([IO.Directory]::Exists($full)) { [IO.Directory]::Delete($full,$true) }
    } catch { }  # best effort: a leftover staging copy is harmless and outside the game
}

function New-KvkFileAddPlan($Context,[string]$Kind,[string]$SourcePath,[string]$SourceSha256,[string]$FileName) {
    Assert-KvkContext $Context
    Assert-KvkImportKind $Kind
    Assert-KvkImportFileName $Kind $FileName
    if ($SourceSha256 -cnotmatch '^[0-9a-f]{64}$') { Throw-KvkFailure 'ENGINE_ERROR' '来源文件的校验值无效。' "The source file's checksum is not valid." }
    $isTheme=$Kind -ceq 'theme'
    $assetKind=if ($isTheme) { 'scheme' } else { 'audio' }

    $sourceFull=Get-KvkProfileAssetPath $SourcePath
    if (-not [IO.File]::Exists($sourceFull)) { Throw-KvkFailure 'INVALID_PATH' "找不到来源文件，它可能已被移动或删除: $sourceFull" "The source file was not found; it may have been moved or deleted: `"$sourceFull`"." }
    $read=Read-KvkProfileAssetBytes $assetKind $sourceFull
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $actual=([BitConverter]::ToString($sha.ComputeHash([byte[]]$read.Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    # The player approved the bytes they previewed. If the file changed since, ask again.
    if ($actual -cne $SourceSha256) { Throw-KvkFailure 'PLAN_STALE' '来源文件在预览之后发生了变化，请重新选择这个文件。' 'The source file changed after the preview. Choose the file again.' }

    $directory=if ($isTheme) { Get-KvkThemeDirectory $Context } else { Get-KvkSoundsDirectory $Context }
    $folder=if ($isTheme) { 'Themes' } else { 'sounds' }
    if ([IO.Directory]::Exists($directory)) {
        $taken=@([IO.Directory]::EnumerateFiles($directory,'*',[IO.SearchOption]::TopDirectoryOnly) | ForEach-Object { [IO.Path]::GetFileName($_) } | Where-Object { $_ -ieq $FileName })
        if ($taken.Count -gt 0) { Throw-KvkFailure 'ENGINE_ERROR' "$folder 文件夹里已经有「$($taken[0])」，添加不会覆盖它；请换一个文件名。" "The $folder folder already has `"$($taken[0])`", and adding never overwrites it. Choose another file name." }
    }
    if (-not $isTheme) {
        # A second file with the same stem makes the pair ambiguous: neither could be bound,
        # and a binding that already names the stem would break.
        $stem=[IO.Path]::GetFileNameWithoutExtension($FileName)
        $same=@((Get-KvkInstalledSounds $Context).Sounds | Where-Object { $_.Name -ieq $stem })
        if ($same.Count -gt 0) { Throw-KvkFailure 'ENGINE_ERROR' "sounds 文件夹里已经有同名音效「$($same[0].File)」。游戏按不含扩展名的名字绑定音效，再添加一个会让两者都无法绑定；请换一个文件名。" "The sounds folder already has a sound named `"$($same[0].File)`". The game binds sounds by the name without its extension, so adding another would leave neither one bindable. Choose another file name." }
    }

    $stage=Join-Path (Get-KvkImportStageBase $Context) ([guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { Throw-KvkFailure 'ENGINE_ERROR' '导入的暂存位置不能在游戏目录里。' 'The import staging folder must be outside the game directory.' }
    try {
        New-KvkDirectory (Join-Path $stage $folder)
        $staged=Join-Path (Join-Path $stage $folder) $FileName
        Write-KvkDurableFile $staged ([byte[]]$read.Bytes)
        $themeName=$null
        if ($isTheme) {
            $themeName=[string](Read-KvkThemeFile $staged)['themeName']
            # The game keys themes by this name, not by file name. Two themes sharing it cannot be
            # told apart when one is applied, so the Scheme page would disable both.
            $clash=@((Get-KvkInstalledThemes $Context).Themes | Where-Object { $_.Readable -and $_.Name -ieq $themeName })
            if ($clash.Count -gt 0) { Throw-KvkFailure 'ENGINE_ERROR' "这个主题的内部名称是「$themeName」，而游戏里的「$($clash[0].File)」已经叫这个名字。游戏按内部名称识别主题，再添加一个会让两者都无法应用；没有添加。" "This theme's internal name is `"$themeName`", and `"$($clash[0].File)`" in the game already uses that name. The game identifies themes by their internal name, so adding another would leave neither one applicable. Nothing was added." }
        }
        $category=$folder.ToLowerInvariant()
        $plan=New-KvkPlan $Context $stage @($category)
        if (@($plan.Items).Count -ne 1 -or $plan.Items[0].Key -cne ($category+'/'+$FileName) -or
            $plan.Items[0].Action -cne 'create' -or $plan.Items[0].BeforeHash -ne $null -or $plan.Items[0].AfterHash -cne $actual) {
            Throw-KvkFailure 'PLAN_STALE' '准备添加时，目标文件的状态发生了变化，这次没有写入。请刷新后重试。' 'The target file changed while the add was being prepared, so nothing was written. Refresh and try again.'
        }
        return [pscustomobject]@{Kind=$Kind;FileName=$FileName;Key=$plan.Items[0].Key;PackRoot=$stage;Sha256=$actual;ThemeName=$themeName;Plan=$plan}
    } catch { Remove-KvkImportStage $Context $stage; throw }
}

function Invoke-KvkFileAdd($Context,$AddPlan,[scriptblock]$Observer=$null) {
    # The plan carries a null before-hash, and the engine re-plans before writing: a file that
    # appeared after review stops the import, so an add can never become an overwrite. The
    # engine keeps its own copy of the source in the batch, so the staging folder can go.
    try { return Invoke-KvkInstall $Context $AddPlan.Plan -Observer $Observer -AllowRunningGame }
    finally { Remove-KvkImportStage $Context $AddPlan.PackRoot }
}
