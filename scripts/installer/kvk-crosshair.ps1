#Requires -Version 7.0
# UI-independent replacement adapter; importing only declares functions.
. (Join-Path $PSScriptRoot 'kvk-engine.ps1')

function Assert-KvkCrosshairTargetName([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name.Length -gt 128 -or
        $Name -notmatch '^[^\\/:*?"<>|\x00-\x1f]+\.png$' -or $Name -match '^[. ]|[. ]$' -or $Name.Contains('..') -or
        $Name.Split('.')[0] -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])$') { Throw-KvkFailure 'ENGINE_ERROR' "准星文件名无效：不能包含 \ / : * ? `" < > | 或连续的点，不能以点或空格开头结尾，连同 .png 不超过 128 个字符 (invalid file name): $Name" "The crosshair file name is not valid: it cannot contain \ / : * ? < > | a double quote, or consecutive dots, cannot start or end with a dot or a space, and must be at most 128 characters including .png: `"$Name`"." }
}
function Read-KvkCrosshairReplacement([string]$PackRoot) {
    $root=Get-KvkFullPath $PackRoot;Assert-KvkSafePath $root
    $path=Join-Path $root 'crosshair-replacement.json';Assert-KvkSafePath $path
    if (-not [IO.File]::Exists($path) -or ([IO.FileInfo]$path).Length -gt 65536) { throw 'Missing or oversized crosshair replacement metadata.' }
    $metadataHash=Get-KvkHash $path
    $m=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($path)) -ErrorAction Stop
    if ($m.schemaVersion -ne 1 -or $m.kind -cne 'crosshair-replacement' -or $m.requiresConfirmation -ne $true -or $m.gameSelectionChanged -ne $false) { throw 'Invalid crosshair replacement metadata.' }
    Assert-KvkCrosshairTargetName $m.targetFileName
    if ($m.png.file -cne ('crosshairs/'+$m.targetFileName) -or $m.png.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid crosshair asset identity.' }
    $catalog=Get-KvkPackFiles $root
    if ($catalog.Items.Count -ne 1 -or $catalog.Items[0].Category -cne 'crosshairs' -or $catalog.Items[0].Key -cne $m.png.file) { throw 'Replacement pack must contain exactly the declared crosshair asset.' }
    $png=$catalog.Items[0].Source;Assert-KvkSafePath $png
    $length=([IO.FileInfo]$png).Length
    if ($length -lt 45 -or $length -gt 2MB -or $length -ne $m.png.bytes) { throw 'Invalid crosshair PNG length.' }
    # Portable service performs full CRC/zlib/PNG validation. Here enforce bounded
    # canonical RGBA output header plus byte identity, without decoding game assets.
    $stream=[IO.File]::Open($png,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if($stream.Length -ne $length){throw 'PNG changed while reading.'}
        $bytes=[byte[]]::new([int]$length);$offset=0
        while($offset -lt $bytes.Length){$n=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($n -eq 0){throw 'Truncated PNG'};$offset+=$n}
        if($stream.ReadByte() -ne -1){throw 'PNG grew while reading.'}
    }finally{$stream.Dispose()}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    if($actual -cne $m.png.sha256){throw 'PNG differs from replacement preview.'}
    if([BitConverter]::ToString($bytes[0..15]) -cne '89-50-4E-47-0D-0A-1A-0A-00-00-00-0D-49-48-44-52' -or
        $bytes[24] -ne 8 -or $bytes[25] -ne 6 -or $bytes[26] -ne 0 -or $bytes[27] -ne 0 -or $bytes[28] -ne 0){throw 'Expected canonical RGBA PNG from preview service.'}
    $width=([long]$bytes[16]*16777216+[long]$bytes[17]*65536+[long]$bytes[18]*256+$bytes[19])
    $height=([long]$bytes[20]*16777216+[long]$bytes[21]*65536+[long]$bytes[22]*256+$bytes[23])
    if($width -lt 1 -or $height -lt 1 -or $width -gt 512 -or $height -gt 512 -or $width -ne $m.png.width -or $height -ne $m.png.height){throw 'Crosshair PNG dimensions differ from preview.'}
    if((Get-KvkHash $path) -cne $metadataHash){throw 'Replacement metadata changed while reading.'}
    return [pscustomobject]@{PackRoot=$root;Metadata=$m;MetadataHash=$metadataHash}
}
function New-KvkCrosshairReplacementPlan($Context,[string]$PackRoot) {
    Assert-KvkContext $Context
    $pack=Read-KvkCrosshairReplacement $PackRoot
    $gamePrefix=$Context.GameRoot.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    if($pack.PackRoot.Equals($Context.GameRoot,[StringComparison]::OrdinalIgnoreCase) -or $pack.PackRoot.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Replacement pack must be outside the game directory.' }
    $plan=New-KvkPlan $Context $pack.PackRoot @('crosshairs')
    if($plan.Items.Count -ne 1 -or $null -eq $plan.Items[0].BeforeHash){throw 'Replacement target does not exist; use normal install for new crosshairs.'}
    return [pscustomobject]@{Kind='crosshair-replacement';PackRoot=$pack.PackRoot;TargetFileName=$pack.Metadata.targetFileName;
        MetadataHash=$pack.MetadataHash;Warnings=@($pack.Metadata.warnings);Plan=$plan;RequiresConfirmation=$true;GameSelectionChanged=$false}
}
function Invoke-KvkCrosshairReplacement($Context,$Preview,[switch]$Confirm,[switch]$AllowRunningGame,[scriptblock]$Observer=$null) {
    if(-not $Confirm){throw 'Explicit confirmation of the replacement preview is required.'}
    if($Preview.Kind -cne 'crosshair-replacement'){throw 'Invalid replacement preview.'}
    $fresh=New-KvkCrosshairReplacementPlan $Context $Preview.PackRoot
    if($fresh.MetadataHash -cne $Preview.MetadataHash -or $fresh.TargetFileName -cne $Preview.TargetFileName -or
        $Preview.Plan.PackRoot -cne $fresh.PackRoot -or @($Preview.Plan.Categories).Count -ne 1 -or
        $Preview.Plan.Categories[0] -cne 'crosshairs'){throw 'Replacement preview is stale or invalid.'}
    # The existing engine locks, rechecks every plan field, snapshots original bytes,
    # publishes a durable backup, and provides rollback/restore. -AllowRunningGame is the
    # user-approved waiver shared with the scheme and audio current-configuration pages.
    return Invoke-KvkInstall $Context $Preview.Plan -AllowRunningGame:$AllowRunningGame -Observer $Observer
}


# ---------------------------------------------------------------------------
# Current-configuration page: replace one slot's image with chosen pixels.
# The pack it stages is the same shape the Node service produces, so the
# preview/apply path above is reused unchanged.
# ---------------------------------------------------------------------------

function Get-KvkCrosshairsDirectory($Context) {
    Assert-KvkContext $Context
    return (Join-Path $Context.GameRoot 'FPSAimTrainer/crosshairs')
}

function Get-KvkInstalledCrosshairs($Context) {
    $directory=Get-KvkCrosshairsDirectory $Context
    $crosshairs=@()
    if ([IO.Directory]::Exists($directory)) {
        $paths=@([IO.Directory]::EnumerateFiles($directory,'*.png',[IO.SearchOption]::TopDirectoryOnly)) | Sort-Object
        foreach ($path in $paths) {
            $crosshairs += [pscustomobject]@{Name=[IO.Path]::GetFileNameWithoutExtension($path);File=[IO.Path]::GetFileName($path);Path=$path}
        }
    }
    return [pscustomobject]@{Directory=$directory;Crosshairs=@($crosshairs)}
}

function Assert-KvkCrosshairImage([byte[]]$Bytes) {
    if ($Bytes.Length -lt 45 -or $Bytes.Length -gt 2MB) { Throw-KvkFailure 'ENGINE_ERROR' "准星 PNG 必须在 45 字节到 2 MiB 之间 (size limit)。" "A crosshair PNG must be between 45 bytes and 2 MiB." }
    foreach ($pair in @(@(0,137),@(1,80),@(2,78),@(3,71),@(4,13),@(5,10),@(6,26),@(7,10))) { if ($Bytes[$pair[0]] -ne $pair[1]) { Throw-KvkFailure 'ENGINE_ERROR' '准星 PNG 签名不正确 (damaged signature)。' 'The crosshair PNG signature is not correct.' } }
    if ($Bytes[12] -ne 0x49 -or $Bytes[13] -ne 0x48 -or $Bytes[14] -ne 0x44 -or $Bytes[15] -ne 0x52) { Throw-KvkFailure 'ENGINE_ERROR' '准星 PNG 缺少 IHDR。' 'The crosshair PNG has no IHDR chunk.' }
    if ($Bytes[24] -ne 8) { Throw-KvkFailure 'ENGINE_ERROR' '准星 PNG 必须是 8 位位深。' 'A crosshair PNG must use 8-bit depth.' }
    if ($Bytes[25] -ne 6) { Throw-KvkFailure 'ENGINE_ERROR' '准星 PNG 必须是 RGBA 颜色类型。' 'A crosshair PNG must use the RGBA color type.' }
    if ($Bytes[26] -ne 0) { Throw-KvkFailure 'ENGINE_ERROR' '准星 PNG 必须使用 deflate 压缩。' 'A crosshair PNG must use deflate compression.' }
    if ($Bytes[28] -ne 0) { Throw-KvkFailure 'ENGINE_ERROR' '准星 PNG 不能是隔行扫描。' 'A crosshair PNG must not be interlaced.' }
    $width=([long]$Bytes[16]*16777216+[long]$Bytes[17]*65536+[long]$Bytes[18]*256+$Bytes[19])
    $height=([long]$Bytes[20]*16777216+[long]$Bytes[21]*65536+[long]$Bytes[22]*256+$Bytes[23])
    if ($width -lt 1 -or $height -lt 1 -or $width -gt 512 -or $height -gt 512) { Throw-KvkFailure 'ENGINE_ERROR' "准星 PNG 尺寸必须在 1 到 512 之间 (image size)。" "A crosshair PNG must be between 1 and 512 pixels on each side." }
    return [pscustomobject]@{Width=$width;Height=$height}
}

function New-KvkCrosshairImagePlan($Context,[string]$FileName,[byte[]]$Png) {
    Assert-KvkContext $Context
    Assert-KvkCrosshairTargetName $FileName
    $size=Assert-KvkCrosshairImage $Png
    $directory=Get-KvkCrosshairsDirectory $Context
    $target=Join-Path $directory $FileName
    Assert-KvkSafePath $target
    if (-not [IO.File]::Exists($target)) { Throw-KvkFailure 'ENGINE_ERROR' "游戏目录里没有这个准星文件 (target does not exist): $FileName" "The game folder has no such crosshair file: `"$FileName`"." }
    $stage=Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) ('crosshair-previews/'+[guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Crosshair preview staging must be outside the game directory.' }
    New-KvkDirectory (Join-Path $stage 'crosshairs')
    $pngPath=Join-Path (Join-Path $stage 'crosshairs') $FileName
    Write-KvkDurableFile $pngPath $Png
    $sha=(Get-KvkHash $pngPath)
    # Same metadata shape the Node service writes, read back by the adapter above.
    $metadata=[pscustomobject]@{
        schemaVersion=1;kind='crosshair-replacement';targetFileName=$FileName
        png=@{file=('crosshairs/'+$FileName);sha256=$sha;bytes=$Png.Length;width=[int]$size.Width;height=[int]$size.Height}
        warnings=@();requiresConfirmation=$true;gameSelectionChanged=$false
    }
    $metadataPath=Join-Path $stage 'crosshair-replacement.json'
    Write-KvkAtomicJson $metadataPath $metadata
    $preview=New-KvkCrosshairReplacementPlan $Context $stage
    if ($preview.TargetFileName -cne $FileName -or @($preview.Plan.Items).Count -ne 1 -or $preview.Plan.Items[0].Key -cne ('crosshairs/'+$FileName)) {
        Throw-KvkFailure 'PLAN_STALE' '准星预览没有指向所选的文件。' 'Crosshair preview did not resolve to the chosen slot.'
    }
    return [pscustomobject]@{FileName=$FileName;PackRoot=$stage;PngPath=$pngPath;MetadataPath=$metadataPath;
        Sha256=$sha;Width=[int]$size.Width;Height=[int]$size.Height;GameSelectionChanged=$false
        Plan=$preview.Plan;Preview=$preview}
}

function Invoke-KvkCrosshairImageReplacement($Context,$ImagePlan,[scriptblock]$Observer=$null) {
    # Pass the reviewed preview through unchanged: the adapter re-derives the pack and the
    # slot and refuses a mismatch, while the engine still compares the reviewed plan's
    # before-hash. Re-deriving the plan here would silently adopt a changed slot as approved.
    return Invoke-KvkCrosshairReplacement $Context $ImagePlan.Preview -Confirm -AllowRunningGame -Observer $Observer
}


function New-KvkCrosshairAddPlan($Context,[string]$FileName,[byte[]]$Png) {
    Assert-KvkContext $Context
    Assert-KvkCrosshairTargetName $FileName
    $size=Assert-KvkCrosshairImage $Png
    $directory=Get-KvkCrosshairsDirectory $Context
    $target=Join-Path $directory $FileName
    Assert-KvkSafePath $target
    # Adding never overwrites: an existing file is the replacement path's job.
    if ([IO.File]::Exists($target)) { Throw-KvkFailure 'ENGINE_ERROR' "crosshairs 文件夹里已经有「$FileName」，新增不会覆盖它；请换一个文件名 (file already exists)。" "The crosshairs folder already has `"$FileName`", and adding never overwrites it. Choose another file name." }
    $stage=Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) ('crosshair-previews/'+[guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Crosshair staging must be outside the game directory.' }
    New-KvkDirectory (Join-Path $stage 'crosshairs')
    $pngPath=Join-Path (Join-Path $stage 'crosshairs') $FileName
    Write-KvkDurableFile $pngPath $Png
    $plan=New-KvkPlan $Context $stage @('crosshairs')
    if (@($plan.Items).Count -ne 1 -or $plan.Items[0].Key -cne ('crosshairs/'+$FileName) -or
        $plan.Items[0].Action -cne 'create' -or $plan.Items[0].BeforeHash -ne $null -or
        $plan.Items[0].AfterHash -cne (Get-KvkHash $pngPath)) {
        Throw-KvkFailure 'PLAN_STALE' '准备新增时，目标文件的状态发生了变化，这次没有写入。请刷新后重试 (add plan did not resolve to a new file)。' 'The target file changed while the add was being prepared, so nothing was written. Refresh and try again.'
    }
    return [pscustomobject]@{FileName=$FileName;PackRoot=$stage;PngPath=$pngPath;Sha256=$plan.Items[0].AfterHash;
        Width=[int]$size.Width;Height=[int]$size.Height;Plan=$plan}
}

function Invoke-KvkCrosshairAdd($Context,$AddPlan,[scriptblock]$Observer=$null) {
    # The reviewed plan carries a null before-hash; the engine refuses to create a file that
    # appeared after the review, so a race cannot turn an add into an overwrite.
    return Invoke-KvkInstall $Context $AddPlan.Plan -Observer $Observer -AllowRunningGame
}
