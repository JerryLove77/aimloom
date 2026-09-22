#Requires -Version 7.0
# Functions only. Game files are read-only; new output is confined to a separate session.
function Throw-AimTest([string]$Code,[string]$Message) { throw "[$Code] $Message" }
function Get-AimPath([string]$Path) {
    if([string]::IsNullOrWhiteSpace($Path)){Throw-AimTest 'UNSAFE_PATH' '路径不能为空'}
    if($IsWindows -and ($Path -match '^[/\\]{2}' -or $Path -match '~' -or
        @($Path.Split([char[]]'\/')|Where-Object {$_ -notin @('.','..') -and $_ -match '[. ]$'}).Count)){
        Throw-AimTest 'UNSAFE_PATH' '路径包含不支持的 Windows 别名'
    }
    $full=[IO.Path]::GetFullPath($Path)
    if($IsWindows){
        # Accept ordinary drive paths only; reject device/UNC and DOS short-name aliases.
        if($full -notmatch '^[a-zA-Z]:[\\/]' -or $full.Substring(3) -match '[:~]' -or
            @($full.Substring(3).Split([char[]]'\/')|Where-Object {$_ -match '[. ]$'}).Count){
            Throw-AimTest 'UNSAFE_PATH' '请使用普通盘符完整路径，不支持设备路径、短文件名或末尾点和空格'
        }
    }
    $root=[IO.Path]::GetPathRoot($full)
    if($full.Length -gt $root.Length){$full=$full.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)}
    return $full
}
function Assert-AimNoLinks([string]$Path) {
    $current=Get-AimPath $Path
    while($current){
        if(Test-Path -LiteralPath $current -ErrorAction Stop){
            $item=Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Throw-AimTest 'UNSAFE_PATH' '不支持链接、junction 或重解析路径'}
        }
        $parent=[IO.Path]::GetDirectoryName($current)
        if($parent -eq $current){break};$current=$parent
    }
}
function Test-AimUnder([string]$Child,[string]$Parent) {
    $childPath=Get-AimPath $Child;$parentPath=Get-AimPath $Parent
    return $childPath.Equals($parentPath,[StringComparison]::OrdinalIgnoreCase) -or
        $childPath.StartsWith($parentPath.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-AimSeparate([string]$Output,[string]$GameRoot) {
    Assert-AimNoLinks $Output
    if((Test-AimUnder $Output $GameRoot) -or (Test-AimUnder $GameRoot $Output)){
        Throw-AimTest 'UNSAFE_PATH' '记录目录必须与游戏目录分开，不能互相包含'
    }
}
function Get-AimHash([string]$Path,[long]$MaxBytes=64MB) {
    Assert-AimNoLinks $Path
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try{
        $length=$stream.Length
        if($MaxBytes -lt 0 -or $length -gt $MaxBytes){Throw-AimTest 'LIMIT_EXCEEDED' '文件超过读取上限'}
        $buffer=[byte[]]::new(65536);[long]$total=0
        while(($count=$stream.Read($buffer,0,[int][Math]::Min($buffer.Length,$MaxBytes-$total+1))) -gt 0){
            $total+=$count;if($total -gt $MaxBytes){Throw-AimTest 'LIMIT_EXCEEDED' '文件在读取期间超过上限'}
            $hash.AppendData($buffer,0,$count)
        }
        if($total -ne $length -or $stream.Length -ne $length){Throw-AimTest 'SOURCE_CHANGED' '文件在读取期间变化'}
        return [BitConverter]::ToString($hash.GetHashAndReset()).Replace('-','').ToLowerInvariant()
    }
    finally{$hash.Dispose();$stream.Dispose()}
}
function Read-AimJson([string]$Path,[string]$Code) {
    Assert-AimNoLinks $Path
    try {
        $info=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if($info.PSIsContainer -or $info.Length -gt 4MB){throw 'size'}
        $value=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Path)) -AsHashtable -Depth 64 -ErrorAction Stop
        if($value -isnot [Collections.IDictionary]){throw 'object'}
        return $value
    } catch {Throw-AimTest $Code '记录缺失、过大或格式损坏'}
}
function Test-AimSchema($Value) { return (($Value.schemaVersion -is [int]) -or ($Value.schemaVersion -is [long])) -and $Value.schemaVersion -eq 1 }
function New-AimDirectory([string]$Path) { Assert-AimNoLinks $Path;$null=[IO.Directory]::CreateDirectory($Path);Assert-AimNoLinks $Path }
function Write-AimJson([string]$Path,$Data) {
    Assert-AimNoLinks $Path
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Data -Depth 32)+"`n")
    $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
}
function Get-AimGameState {
    try {
        $running=@(Get-Process -ErrorAction Stop|Where-Object {$_.ProcessName -in @('FPSAimTrainer','FPSAimTrainer-Win64-Shipping')})
        if($running.Count){return 'running'};return 'closed'
    } catch {return 'unknown'}
}
function Assert-AimClosed {if((Get-AimGameState) -ne 'closed'){Throw-AimTest 'GAME_NOT_CLOSED' '请退出 KovaaK；无法确定进程状态时也不能采集基线'} }
function Find-AimGameRoots {
    $paths=[Collections.Generic.List[string]]::new()
    foreach($envName in @('ProgramFiles(x86)','ProgramFiles')){
        $base=[Environment]::GetEnvironmentVariable($envName)
        if($base){$paths.Add((Join-Path $base 'Steam/steamapps/common/FPSAimTrainer'))}
    }
    foreach($drive in [IO.DriveInfo]::GetDrives()){
        if($drive.DriveType -eq [IO.DriveType]::Fixed){$paths.Add((Join-Path $drive.RootDirectory.FullName 'SteamLibrary/steamapps/common/FPSAimTrainer'))}
    }
    $seen=@{}
    foreach($path in $paths){
        if([IO.File]::Exists((Join-Path $path 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json')) -and
            [IO.Directory]::Exists((Join-Path $path 'FPSAimTrainer/crosshairs')) -and -not $seen.ContainsKey($path)){
            $seen[$path]=$true;$path
        }
    }
}
function New-AimTestContext([string]$KitRoot,[string]$GameRoot,[string]$OutputRoot,[switch]$AllowMissing) {
    $kit=Get-AimPath $KitRoot;$game=Get-AimPath $GameRoot
    Assert-AimNoLinks $kit;Assert-AimNoLinks $game
    $save=Join-Path $game 'FPSAimTrainer/Saved/SaveGames';$cross=Join-Path $game 'FPSAimTrainer/crosshairs'
    if(-not $AllowMissing -and (-not [IO.File]::Exists((Join-Path $save 'PrimaryUserSettings.json')) -or -not [IO.Directory]::Exists($cross))){
        Throw-AimTest 'GAME_ROOT_INVALID' '请选择包含 FPSAimTrainer 子目录的游戏安装根目录'
    }
    Assert-AimNoLinks $save;Assert-AimNoLinks $cross
    $output=if($OutputRoot){Get-AimPath $OutputRoot}else{Join-Path $kit 'test-records'}
    Assert-AimSeparate $output $game
    $manifest=Read-AimJson (Join-Path $kit 'manifest.json') 'KIT_INVALID'
    if(-not (Test-AimSchema $manifest) -or $manifest.kitId -cnotmatch '^[0-9a-f]{12}$' -or
        $manifest.cases -isnot [array] -or $manifest.cases.Count -lt 1 -or $manifest.cases.Count -gt 64){Throw-AimTest 'KIT_INVALID' '测试包清单无效'}
    $seen=@{}
    foreach($case in $manifest.cases){
        if($case -isnot [Collections.IDictionary] -or $case.id -cnotmatch '^[a-z][a-z-]+$') {Throw-AimTest 'KIT_INVALID' '测试案例无效'}
        $expected='crosshairs/aimloom_test_'+$manifest.kitId+'_'+$case.id+'.png'
        if($case.png.file -cne $expected -or $seen.ContainsKey($expected) -or $case.png.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
            ($case.png.bytes -isnot [long] -and $case.png.bytes -isnot [int])){Throw-AimTest 'KIT_INVALID' '测试 PNG 路径、哈希或长度无效'}
        $seen[$expected]=$true;$path=Join-Path $kit $expected;Assert-AimNoLinks $path
        if(-not [IO.File]::Exists($path) -or $case.png.bytes -lt 1 -or $case.png.bytes -gt 2MB){Throw-AimTest 'KIT_INVALID' '测试 PNG 缺失或过大'}
        if(([IO.FileInfo]$path).Length -ne $case.png.bytes -or (Get-AimHash $path) -cne $case.png.sha256){Throw-AimTest 'KIT_INVALID' '测试 PNG 校验失败'}
    }
    return [pscustomobject]@{KitRoot=$kit;GameRoot=$game;OutputRoot=$output;SaveRoot=$save;CrosshairRoot=$cross;
        KitId=$manifest.kitId;KitHash=(Get-AimHash (Join-Path $kit 'manifest.json'));Cases=@($manifest.cases)}
}
function Get-AimInventory($Context) {
    $items=[Collections.Generic.List[object]]::new();$seen=@{};[long]$total=0;$directories=0
    foreach($scope in @(@{Name='settings';Root=$Context.SaveRoot},@{Name='crosshairs';Root=$Context.CrosshairRoot})){
        Assert-AimNoLinks $scope.Root
        if(-not [IO.Directory]::Exists($scope.Root)){continue}
        $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($scope.Root)
        while($pending.Count){
            $directory=$pending.Pop();Assert-AimNoLinks $directory;$directories++
            if($directories -gt 5000){Throw-AimTest 'LIMIT_EXCEEDED' '目录数量超过采集上限'}
            foreach($path in [IO.Directory]::EnumerateFileSystemEntries($directory)){
                Assert-AimNoLinks $path
                if([IO.Directory]::Exists($path)){$pending.Push($path);continue}
                $info=[IO.FileInfo]$path;$total+=$info.Length
                if($info.Length -gt 64MB -or $total -gt 512MB -or $items.Count -ge 5000){Throw-AimTest 'LIMIT_EXCEEDED' '采集超过 5000 个文件、单文件 64 MiB 或总量 512 MiB 上限'}
                $relative=$scope.Name+'/'+[IO.Path]::GetRelativePath($scope.Root,$path).Replace('\','/')
                if($seen.ContainsKey($relative)){Throw-AimTest 'UNSAFE_PATH' '发现大小写冲突文件'}
                $seen[$relative]=$true
                $items.Add([pscustomobject]@{path=$relative;source=$path;bytes=$info.Length;sha256=(Get-AimHash $path)})
            }
        }
    }
    return @($items|Sort-Object path)
}
function Copy-AimSnapshotFile([string]$Source,[string]$Target,[string]$ExpectedHash,[long]$ExpectedBytes) {
    Assert-AimNoLinks $Source;New-AimDirectory ([IO.Path]::GetDirectoryName($Target));Assert-AimNoLinks $Target
    $from=[IO.File]::Open($Source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if($ExpectedBytes -lt 0 -or $ExpectedBytes -gt 64MB -or $from.Length -ne $ExpectedBytes){Throw-AimTest 'SOURCE_CHANGED' '源文件大小已变化'}
        $to=[IO.File]::Open($Target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {
            $buffer=[byte[]]::new(65536);[long]$remaining=$ExpectedBytes
            while($remaining -gt 0){
                $count=$from.Read($buffer,0,[int][Math]::Min($buffer.Length,$remaining))
                if($count -le 0){Throw-AimTest 'SOURCE_CHANGED' '复制期间源文件缩短'}
                $to.Write($buffer,0,$count);$remaining-=$count
            }
            if($from.ReadByte() -ne -1){Throw-AimTest 'SOURCE_CHANGED' '复制期间源文件增长'}
        } finally {$to.Dispose()}
    } finally {$from.Dispose()}
    if((Get-AimHash $Target) -cne $ExpectedHash){Throw-AimTest 'SOURCE_CHANGED' '复制期间源文件发生变化，快照未完成'}
}
function Get-AimDiff($Before,$After) {
    $a=@{};$b=@{};foreach($f in $Before){$a[$f.path]=$f};foreach($f in $After){$b[$f.path]=$f}
    $added=@();$removed=@();$changed=@()
    foreach($path in @($a.Keys|Sort-Object)){
        if(-not $b.ContainsKey($path)){$removed+= $path}
        elseif($a[$path].sha256 -cne $b[$path].sha256){$changed+=[pscustomobject]@{path=$path;before=$a[$path].sha256;after=$b[$path].sha256}}
    }
    foreach($path in @($b.Keys|Sort-Object)){if(-not $a.ContainsKey($path)){$added+=$path}}
    return [pscustomobject]@{added=@($added);removed=@($removed);changed=@($changed)}
}
function New-AimSnapshot($Context,[string]$Destination,[string]$Label) {
    Assert-AimSeparate $Destination $Context.GameRoot;Assert-AimClosed
    $before=@(Get-AimInventory $Context);New-AimDirectory $Destination
    foreach($file in $before){Copy-AimSnapshotFile $file.source (Join-Path $Destination ('files/'+$file.path)) $file.sha256 $file.bytes}
    Assert-AimClosed
    $after=@(Get-AimInventory $Context);$diff=Get-AimDiff $before $after
    if($diff.added.Count -or $diff.removed.Count -or $diff.changed.Count){Throw-AimTest 'SOURCE_CHANGED' '采集期间游戏文件发生变化，快照未完成'}
    $snapshot=[pscustomobject]@{schemaVersion=1;createdAt=[DateTimeOffset]::Now.ToString('o');label=$Label;kitId=$Context.KitId;gameRoot=$Context.GameRoot;
        files=@($before|ForEach-Object {[pscustomobject]@{path=$_.path;bytes=$_.bytes;sha256=$_.sha256}})}
    Write-AimJson (Join-Path $Destination 'snapshot.json') $snapshot
    return $snapshot
}
function Get-AimTestCheck($Context) {
    $fresh=New-AimTestContext $Context.KitRoot $Context.GameRoot $Context.OutputRoot
    $exeVersion=$null
    foreach($relative in @('FPSAimTrainer.exe','FPSAimTrainer/Binaries/Win64/FPSAimTrainer-Win64-Shipping.exe')){
        $path=Join-Path $fresh.GameRoot $relative
        if([IO.File]::Exists($path)){Assert-AimNoLinks $path;$exeVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion;break}
    }
    $steamBuild=$null
    $steamApps=[IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($fresh.GameRoot))
    $acf=Join-Path $steamApps 'appmanifest_824270.acf'
    if([IO.File]::Exists($acf)){
        Assert-AimNoLinks $acf
        if(([IO.FileInfo]$acf).Length -le 1MB -and [IO.File]::ReadAllText($acf) -match '"buildid"\s+"(\d+)"'){$steamBuild=$Matches[1]}
    }
    New-AimDirectory $fresh.OutputRoot
    $reportPath=Join-Path $fresh.OutputRoot ('check-'+[Guid]::NewGuid().ToString('N')+'.json')
    $result=[pscustomobject]@{schemaVersion=1;createdAt=[DateTimeOffset]::Now.ToString('o');kitId=$fresh.KitId;kitFilesVerified=$fresh.Cases.Count;
        gameRoot=$fresh.GameRoot;gameState=(Get-AimGameState);os=[Environment]::OSVersion.VersionString;powerShell=$PSVersionTable.PSVersion.ToString();
        executableVersion=$exeVersion;steamBuildId=$steamBuild;visualChecks='not_run';reportPath=$reportPath}
    Write-AimJson $reportPath $result;return $result
}
function New-AimTestBaseline($Context) {
    $fresh=New-AimTestContext $Context.KitRoot $Context.GameRoot $Context.OutputRoot;Assert-AimClosed
    foreach($file in @(Get-AimInventory $fresh)){
        if($file.path -match '^crosshairs/aimloom_test_[0-9a-f]+_'){Throw-AimTest 'TEST_ASSETS_PRESENT' '请先恢复已有测试包，再建立原始基线'}
    }
    $id=[Guid]::NewGuid().ToString('N');$session=Join-Path $fresh.OutputRoot ('session-'+$id)
    if(Test-Path -LiteralPath $session){Throw-AimTest 'SESSION_INVALID' '会话目录已存在'}
    New-AimDirectory $session
    $snapshot=New-AimSnapshot $fresh (Join-Path $session 'baseline') 'baseline'
    $record=[pscustomobject]@{schemaVersion=1;sessionId=$id;kitId=$fresh.KitId;kitHash=$fresh.KitHash;gameRoot=$fresh.GameRoot;
        createdAt=[DateTimeOffset]::Now.ToString('o');baselineHash=(Get-AimHash (Join-Path $session 'baseline/snapshot.json'))}
    Write-AimJson (Join-Path $session 'session.json') $record
    return [pscustomobject]@{sessionRoot=$session;sessionId=$id;files=$snapshot.files.Count;visualChecks='not_run'}
}
function Read-AimSession($Context,[string]$SessionRoot) {
    $session=Get-AimPath $SessionRoot;Assert-AimSeparate $session $Context.GameRoot
    $record=Read-AimJson (Join-Path $session 'session.json') 'SESSION_INVALID'
    if(-not (Test-AimSchema $record) -or $record.kitId -cne $Context.KitId -or $record.kitHash -cne $Context.KitHash -or
        $record.gameRoot -ine $Context.GameRoot -or $record.baselineHash -cnotmatch '^[0-9a-f]{64}$'){
        Throw-AimTest 'SESSION_INVALID' '会话不属于当前测试包或游戏目录'
    }
    $snapshotPath=Join-Path $session 'baseline/snapshot.json'
    if((Get-AimHash $snapshotPath) -cne $record.baselineHash){Throw-AimTest 'BASELINE_INVALID' '基线清单已变化'}
    $snapshot=Read-AimJson $snapshotPath 'BASELINE_INVALID'
    if(-not (Test-AimSchema $snapshot) -or $snapshot.kitId -cne $Context.KitId -or $snapshot.gameRoot -ine $Context.GameRoot -or
        $snapshot.files -isnot [array] -or $snapshot.files.Count -lt 1 -or $snapshot.files.Count -gt 5000){Throw-AimTest 'BASELINE_INVALID' '基线格式无效'}
    $seen=@{};[long]$total=0
    foreach($file in $snapshot.files){
        if($file.path -cnotmatch '^(settings|crosshairs)/[^\\:]+$' -or @($file.path.Split('/')|Where-Object {$_ -in @('','..','.')}).Count -or
            $seen.ContainsKey($file.path) -or $file.sha256 -cnotmatch '^[0-9a-f]{64}$'){Throw-AimTest 'BASELINE_INVALID' '基线路径或哈希无效'}
        if(($file.bytes -isnot [int] -and $file.bytes -isnot [long]) -or $file.bytes -lt 0 -or $file.bytes -gt 64MB){Throw-AimTest 'BASELINE_INVALID' '基线文件大小无效'}
        $total+=$file.bytes;if($total -gt 512MB){Throw-AimTest 'BASELINE_INVALID' '基线超过采集上限'}
        $seen[$file.path]=$true;$path=Join-Path $session ('baseline/files/'+$file.path)
        if(-not [IO.File]::Exists($path) -or ([IO.FileInfo]$path).Length -ne $file.bytes -or (Get-AimHash $path) -cne $file.sha256){Throw-AimTest 'BASELINE_INVALID' '基线备份缺失或损坏'}
    }
    return [pscustomobject]@{root=$session;snapshot=$snapshot;record=$record}
}
function New-AimTestCapture($Context,[string]$SessionRoot,[string]$Label='capture') {
    if($Label -notmatch '^[a-zA-Z0-9_-]{1,48}$'){Throw-AimTest 'INVALID_LABEL' '标签请使用 1–48 个英文字母、数字、连字符或下划线'}
    $fresh=New-AimTestContext $Context.KitRoot $Context.GameRoot $Context.OutputRoot -AllowMissing
    $session=Read-AimSession $fresh $SessionRoot;Assert-AimClosed
    $folder=Join-Path $session.root ('capture-'+[Guid]::NewGuid().ToString('N'))
    $snapshot=New-AimSnapshot $fresh $folder $Label
    $diff=Get-AimDiff $session.snapshot.files $snapshot.files
    $current=@{};foreach($file in $snapshot.files){$current[$file.path]=$file.sha256}
    $assets=@(foreach($case in $fresh.Cases){
        $key=$case.png.file;$state=if(-not $current.ContainsKey($key)){'absent'}elseif($current[$key] -ceq $case.png.sha256){'matches_kit'}else{'different'}
        [pscustomobject]@{id=$case.id;file=$key;state=$state}
    })
    $restored=($diff.added.Count -eq 0 -and $diff.removed.Count -eq 0 -and $diff.changed.Count -eq 0)
    $report=[pscustomobject]@{schemaVersion=1;createdAt=[DateTimeOffset]::Now.ToString('o');label=$Label;kitId=$fresh.KitId;sessionRoot=$session.root;captureRoot=$folder;
        diff=$diff;testAssets=@($assets);fileRestoration=$(if($restored){'matches_baseline'}else{'needs_review'});visualChecks='not_run';selectionInterpretation='not_inferred';
        reportPath=(Join-Path $folder 'report.json')}
    Write-AimJson $report.reportPath $report
    $summary="文件新增 $($diff.added.Count)，缺失 $($diff.removed.Count)，内容变化 $($diff.changed.Count)。`n文件核对：$($report.fileRestoration)`n视觉、缩放和游戏选中状态仍需人工观察，未自动判定通过。`n报告：$($report.reportPath)`n"
    [IO.File]::WriteAllText((Join-Path $folder 'summary.txt'),$summary,[Text.UTF8Encoding]::new($true))
    return $report
}
function Compare-AimTestRestoration($Context,[string]$SessionRoot) {return New-AimTestCapture $Context $SessionRoot 'restoration'}
