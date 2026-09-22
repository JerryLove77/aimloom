#Requires -Version 7.0
# Every failure carries both languages: $Message is what a Chinese player reads, $MessageEn
# what an English player reads. Get-KvkEnglishText decides which one an English page shows:
# English is text with no CJK outside double-quoted spans, so a quoted file or theme name may
# be Chinese (game content is never translated) while an untranslated sentence is refused.
function Throw-KvkFailure([string]$Code,[string]$Message,[string]$MessageEn) {
    $exception=[InvalidOperationException]::new($Message)
    $exception.Data['KvkCode']=$Code
    $exception.Data['KvkMessageEn']=$MessageEn
    throw $exception
}
# Dot-source this file. It declares functions only; no writes or process checks run on import.
# PowerShell 7 or newer. All persisted hashes describe original bytes.
function Send-KvkObservation([scriptblock]$Observer, $Event) {
    if ($null -eq $Observer) { return }
    try { & $Observer $Event } catch {
        try { [Console]::Error.WriteLine("KVK observer error: $($_.Exception.Message)") } catch { }
    }
}
function Get-KvkFullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Path is empty.' }
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}
function Assert-KvkSafePath([string]$Path) {
    $p = Get-KvkFullPath $Path
    while (-not [string]::IsNullOrEmpty($p)) {
        # GetAttributes reads the entry itself, never a link's target. It is the same check
        # Test-Path + Get-Item made, about a hundred times faster: those two cost ~3 ms per
        # ancestor, and reading the backups ran this for every record, so Apply waited ~25 s.
        $attributes = $null
        try { $attributes = [IO.File]::GetAttributes($p) }
        catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
        if ($null -ne $attributes -and ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links and junctions are not allowed: `"$p`"" }
        $parent = [IO.Path]::GetDirectoryName($p)
        if ($parent -eq $p) { break }; $p = $parent
    }
}
# The data folder under %LOCALAPPDATA%: backups, first-protection records, Profiles, locks, logs
# and staging. It was named KovaaKConfigInstaller before the product became Aimloom. The
# first-protection records are permanent, so one rule governs the rename: data is never split
# across the two names. Every path under the data folder must come from Get-KvkDataRoot.
$script:KvkDataFolder='Aimloom'
$script:KvkLegacyDataFolder='KovaaKConfigInstaller'
# Each adapter dot-sources this file again, so the memo must survive being loaded twice.
if ($null -eq (Get-Variable -Scope Script -Name KvkDataRoots -ErrorAction Ignore)) { $script:KvkDataRoots=@{}; $script:KvkDataRootHolds=@{} }
function Get-KvkDataRoot([string]$LocalDataRoot) {
    $local=Get-KvkFullPath $LocalDataRoot
    $key=$local.ToLowerInvariant()
    # A session keeps the folder it started with, even if the other name becomes possible later.
    if ($script:KvkDataRoots.ContainsKey($key)) { return $script:KvkDataRoots[$key] }
    $current=Join-Path $local $script:KvkDataFolder
    $legacy=Join-Path $local $script:KvkLegacyDataFolder
    $chosen=$current
    if (-not [IO.Directory]::Exists($current) -and [IO.Directory]::Exists($legacy)) {
        try {
            Assert-KvkSafePath $legacy; Assert-KvkSafePath $current
            # Same volume, so this is one atomic rename: the data is wholly under one name or the other.
            [IO.Directory]::Move($legacy,$current)
        } catch {
            # Something is in the way or holds the folder open (another running instance, an older
            # build). Stay with the existing data for this session; a later session renames it.
            $chosen=$legacy
            # Windows refuses to rename a folder with an open file inside, so holding one open keeps
            # any other process from renaming the folder away while this session still writes to it.
            try {
                $locks=Join-Path $legacy 'locks'; $null=[IO.Directory]::CreateDirectory($locks)
                $script:KvkDataRootHolds[$key]=[IO.File]::Open((Join-Path $locks 'data-root.hold'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
            } catch { }
        }
    }
    $script:KvkDataRoots[$key]=$chosen
    return $chosen
}
# Forgets the session's choice and releases its hold. A new process starts this way; tests call it.
function Clear-KvkDataRootMemo {
    foreach ($hold in @($script:KvkDataRootHolds.Values)) { try { $hold.Dispose() } catch { } }
    $script:KvkDataRootHolds.Clear(); $script:KvkDataRoots.Clear()
}
function New-KvkDirectory([string]$Path) { Assert-KvkSafePath $Path; $null = [IO.Directory]::CreateDirectory($Path); Assert-KvkSafePath $Path }
function Get-KvkHash([string]$Path) {
    Assert-KvkSafePath $Path
    if ([IO.Directory]::Exists($Path)) { throw "Expected a file: `"$Path`"" }
    if (-not [IO.File]::Exists($Path)) { return $null }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose(); $stream.Dispose() }
}
function Get-KvkTextHash([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Assert-KvkGameClosed {
    # An enumeration failure must throw. A test may substitute this low-level function.
    $running = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -in @('FPSAimTrainer','FPSAimTrainer-Win64-Shipping') })
    if ($running.Count -gt 0) { Throw-KvkFailure 'GAME_RUNNING' '请先退出 KovaaK 再修改文件（FPSAimTrainer 正在运行）。' 'Exit KovaaK before changing files (FPSAimTrainer is running).' }
}
function Get-KvkGameRoot([string]$Path, [string]$LocalDataRoot = [Environment]::GetFolderPath('LocalApplicationData')) {
    $root = Get-KvkFullPath $Path
    foreach ($candidate in @($root, [IO.Path]::GetDirectoryName($root))) {
        if ([string]::IsNullOrEmpty($candidate)) { continue }
        $data = Join-Path $candidate 'FPSAimTrainer'
        $primary = Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json'
        $sounds = Join-Path $data 'sounds'
        Assert-KvkSafePath $primary; Assert-KvkSafePath $sounds
        if ([IO.File]::Exists($primary) -and [IO.Directory]::Exists($sounds)) { return $candidate }
    }
    # Recovery must remain possible after Primary was deleted. Accept only the exact root
    # identified by a complete, hash-validated first-touch manifest, never a lookalike folder.
    if (-not [string]::IsNullOrWhiteSpace($LocalDataRoot)) {
        $local=Get-KvkFullPath $LocalDataRoot
        foreach ($candidate in @($root,[IO.Path]::GetDirectoryName($root))) {
            if ([string]::IsNullOrEmpty($candidate)) {continue}
            $base=Get-KvkDataRoot $local
            $recovery=[pscustomobject]@{GameRoot=$candidate;LocalDataRoot=$local;BackupRoot=(Join-Path $base ('backups/'+(Get-KvkTextHash $candidate.ToLowerInvariant())));LockRoot=(Join-Path $base 'locks')}
            $manifest=Join-Path $recovery.BackupRoot 'pristine/manifest.json'
            if ([IO.File]::Exists($manifest) -and [IO.Directory]::Exists((Join-Path $candidate 'FPSAimTrainer/sounds'))) {
                Assert-KvkSafePath (Join-Path $candidate 'FPSAimTrainer/sounds')
                $null=Read-KvkManifest $recovery 'pristine'
                return $candidate
            }
        }
    }
    throw "Cannot validate game directory: `"$Path`". Run the game once and exit normally first."
}
# KovaaK's Steam application id. Steam records which apps live in which library, so this is how
# a library that actually holds the game is told apart from one that merely exists.
$script:KvkSteamAppId = '824270'
# Steam's own library list, which is the only authority on where its libraries are. Guessing
# folder shapes misses ordinary installs: the client need not be under Program Files, and the
# default library lives inside the client's own folder, wherever the player put it. Libraries
# whose "apps" block names the game come back first. Never throws -- a player without Steam, an
# absent file or a corrupt one all mean "no libraries", and the guesses below still run.
function Get-KvkSteamLibraries([string]$SteamRoot, [string]$AppId = $script:KvkSteamAppId) {
    if ([string]::IsNullOrWhiteSpace($SteamRoot)) { return @() }
    try {
        $vdf = Join-Path ($SteamRoot -replace '/','\') 'steamapps/libraryfolders.vdf'
        if (-not [IO.File]::Exists($vdf)) { return @() }
        $text = (Get-KvkTextFile $vdf).Text
    } catch { return @() }
    $withGame = [Collections.Generic.List[string]]::new()
    $others = [Collections.Generic.List[string]]::new()
    $pending = $null
    foreach ($line in ($text -split "`r?`n")) {
        if ($line -match '^\s*"path"\s+"(.*)"\s*$') {
            if ($null -ne $pending) { $null = $others.Add($pending) }
            # VDF escapes a backslash as two. Nothing else in a path needs unescaping.
            $pending = $Matches[1] -replace '\\\\','\'
        } elseif ($null -ne $pending -and $line -match ('^\s*"' + [Regex]::Escape($AppId) + '"\s+"')) {
            $null = $withGame.Add($pending); $pending = $null
        }
    }
    if ($null -ne $pending) { $null = $others.Add($pending) }
    return @(@($withGame) + @($others))
}
# Where Steam itself says it is installed. Windows-only and never fatal: off Windows there is no
# registry provider at all, and discovery must still fall back to the folder guesses.
function Get-KvkSteamRoots {
    $roots = [Collections.Generic.List[string]]::new()
    foreach ($key in @('HKCU:\Software\Valve\Steam','HKLM:\SOFTWARE\WOW6432Node\Valve\Steam','HKLM:\SOFTWARE\Valve\Steam')) {
        foreach ($name in @('SteamPath','InstallPath')) {
            try {
                $value = (Get-ItemProperty -LiteralPath $key -Name $name -ErrorAction Stop).$name
                if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) {
                    # The same install is normally named by all three keys; reading its library
                    # list once is enough.
                    $normalized = ($value -replace '/','\').TrimEnd('\')
                    if (-not ($roots -icontains $normalized)) { $null = $roots.Add($normalized) }
                }
            } catch { }
        }
    }
    return @($roots)
}
function Get-KvkCandidates {
    $bases = @()
    # Ask Steam first; a library it names is still validated like any other candidate below.
    foreach ($root in (Get-KvkSteamRoots)) {
        foreach ($library in (Get-KvkSteamLibraries $root)) { $bases += (Join-Path $library 'steamapps/common/FPSAimTrainer') }
    }
    foreach ($name in @('ProgramFiles(x86)','ProgramFiles')) { $value = [Environment]::GetEnvironmentVariable($name); if ($value) { $bases += (Join-Path $value 'Steam/steamapps/common/FPSAimTrainer') } }
    foreach ($drive in @(Get-PSDrive -PSProvider FileSystem -ErrorAction Stop)) { $bases += (Join-Path $drive.Root 'SteamLibrary/steamapps/common/FPSAimTrainer') }
    $found = @{}
    foreach ($path in $bases) { try { $root = Get-KvkGameRoot $path; if (-not $found.ContainsKey($root)) { $found[$root] = $true; $root } } catch { } }
}
function New-KvkContext([string]$GameRoot, [string]$LocalDataRoot) {
    $game = Get-KvkGameRoot $GameRoot $LocalDataRoot
    $local = Get-KvkFullPath $LocalDataRoot; Assert-KvkSafePath $local
    $base = Get-KvkDataRoot $local
    return [pscustomobject]@{ GameRoot=$game; LocalDataRoot=$local; BackupRoot=(Join-Path $base ('backups/' + (Get-KvkTextHash $game.ToLowerInvariant()))); LockRoot=(Join-Path $base 'locks') }
}
function Assert-KvkContext($Context) {
    $valid = New-KvkContext $Context.GameRoot $Context.LocalDataRoot
    if ($valid.BackupRoot -ine $Context.BackupRoot -or $valid.LockRoot -ine $Context.LockRoot) { throw 'Invalid backup context.' }
    Assert-KvkSafePath $Context.BackupRoot
}
function Assert-KvkFileName([string]$Name) {
    if ([string]::IsNullOrEmpty($Name) -or $Name -match '[<>:"/\\|?*\x00-\x1f]' -or $Name.EndsWith('.') -or $Name.EndsWith(' ') -or $Name -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' -or $Name -in @('.','..')) { throw "Unsafe filename: `"$Name`"" }
}
function Get-KvkTarget($Context, [string]$Key) {
    $parts = @($Key.Split('/'))
    if ($parts.Count -ne 2) { throw "Invalid managed key: `"$Key`"" }
    $category=$parts[0]; $name=$parts[1]; Assert-KvkFileName $name
    $data = Join-Path $Context.GameRoot 'FPSAimTrainer'
    switch -CaseSensitive ($category) {
        'themes' { if (-not $name.EndsWith('.json',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid theme extension.' }; $target=Join-Path (Join-Path $data 'Saved/SaveGames/Themes') $name }
        'sounds' { if ([IO.Path]::GetExtension($name) -notin @('.ogg','.wav')) { throw 'Invalid sound extension.' }; $target=Join-Path (Join-Path $data 'sounds') $name }
        'crosshairs' { if ([IO.Path]::GetExtension($name) -ine '.png') { throw 'Invalid crosshair extension.' }; $target=Join-Path (Join-Path $data 'crosshairs') $name }
        'ui' { if ($name -cne 'UI.json') { throw 'Invalid UI key.' }; $target=Join-Path $data 'Saved/SaveGames/UI.json' }
        'primary' { if ($name -cne 'PrimaryUserSettings.json') { throw 'Invalid Primary key.' }; $target=Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json' }
        'palette' { if ($name -cne 'Palette.ini') { throw 'Invalid Palette key.' }; $target=Join-Path $Context.LocalDataRoot 'FPSAimTrainer/Saved/Config/WindowsNoEditor/Palette.ini' }
        default { throw "Unknown category: $category" }
    }
    Assert-KvkSafePath $target
    # Fail on pre-existing Windows-insensitive aliases even on a case-sensitive fixture host.
    $parent=[IO.Path]::GetDirectoryName($target)
    if ([IO.Directory]::Exists($parent)) {
        # Filter natively instead of materializing every directory entry in PowerShell
        # for every file. No cache: concurrent changes and case aliases stay visible.
        $options=[IO.EnumerationOptions]::new()
        $options.MatchCasing=[IO.MatchCasing]::CaseInsensitive
        $options.MatchType=[IO.MatchType]::Simple
        $options.AttributesToSkip=0
        $options.IgnoreInaccessible=$false
        $matches=@([IO.Directory]::EnumerateFileSystemEntries($parent,$name,$options))
        if ($matches.Count -gt 1) { throw "Case collision at target: `"$target`"" }
        if ($matches.Count -eq 1) { $target=$matches[0] }
    }
    return (Get-KvkFullPath $target)
}
function Get-KvkPackFiles([string]$PackRoot) {
    $root=Get-KvkFullPath $PackRoot; Assert-KvkSafePath $root
    if (-not [IO.Directory]::Exists($root)) { throw "Pack directory is missing: `"$root`"" }
    $items=@(); $skipped=@(); $names=@{}
    foreach ($entry in @(Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop | Sort-Object Name)) {
        if ($names.ContainsKey($entry.Name)) { throw "Case collision in pack: `"$($entry.Name)`"" }; $names[$entry.Name]=$true
        Assert-KvkSafePath $entry.FullName
        $category=$null
        if ($entry.PSIsContainer -and $entry.Name -in @('Themes','sounds','crosshairs')) {
            $category=$entry.Name.ToLowerInvariant(); $seen=@{}
            foreach ($file in @(Get-ChildItem -LiteralPath $entry.FullName -Force -ErrorAction Stop | Sort-Object Name)) {
                Assert-KvkSafePath $file.FullName
                if ($seen.ContainsKey($file.Name)) { throw "Case collision in pack: `"$($file.FullName)`"" }; $seen[$file.Name]=$true
                $ext=[IO.Path]::GetExtension($file.Name).ToLowerInvariant()
                $allowed=($category -eq 'themes' -and $file.Name.EndsWith('.json',[StringComparison]::OrdinalIgnoreCase)) -or ($category -eq 'sounds' -and $ext -in @('.wav','.ogg')) -or ($category -eq 'crosshairs' -and $ext -eq '.png')
                if (-not $file.PSIsContainer -and $allowed) { Assert-KvkFileName $file.Name; $items += [pscustomobject]@{Category=$category;Key=($category+'/'+$file.Name);Source=$file.FullName} } else { $skipped += $file.FullName }
            }
        } elseif (-not $entry.PSIsContainer -and $entry.Name -in @('UI.json','PrimaryUserSettings.json','Palette.ini')) {
            switch ($entry.Name) { 'UI.json' {$category='ui';$name='UI.json'} 'PrimaryUserSettings.json' {$category='primary';$name='PrimaryUserSettings.json'} 'Palette.ini' {$category='palette';$name='Palette.ini'} }
            $items += [pscustomobject]@{Category=$category;Key=($category+'/'+$name);Source=$entry.FullName}
        } else { $skipped += $entry.FullName }
    }
    return [pscustomobject]@{Root=$root;Items=@($items);Skipped=@($skipped)}
}
function Get-KvkCatalog([string]$PackRoot) {
    $files=Get-KvkPackFiles $PackRoot
    return [pscustomobject]@{Categories=@($files.Items | Select-Object -ExpandProperty Category -Unique);Skipped=@($files.Skipped)}
}
# Shared JSON/text helpers used by the component adapters. Every write in this file is
# byte-surgical: only the addressed value changes, the rest of the file is preserved.
function Get-KvkTextFile([string]$Path) {
    $bytes=[IO.File]::ReadAllBytes($Path)
    $encoding=if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { [Text.UTF8Encoding]::new($true) }
        elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { [Text.UnicodeEncoding]::new($false,$true) }
        elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) { [Text.UnicodeEncoding]::new($true,$true,$true) }
        else { [Text.UTF8Encoding]::new($false) }
    $offset=$encoding.GetPreamble().Length
    if ($bytes.Length -lt $offset) { $offset=0 }
    return [pscustomobject]@{Bytes=$bytes;Encoding=$encoding;Offset=$offset;Text=$encoding.GetString($bytes,$offset,$bytes.Length-$offset)}
}
function Get-KvkJsonStringEnd([string]$Text,[int]$Start) {
    $index=$Start+1
    while ($index -lt $Text.Length) {
        if ($Text[$index] -eq '\') { $index+=2;continue }
        if ($Text[$index] -eq '"') { return $index+1 }
        $index++
    }
    Throw-KvkFailure 'ENGINE_ERROR' '设置文件中的字符串没有结束引号。' 'A string in the settings file has no closing quote.'
}
function Get-KvkJsonValueEnd([string]$Text,[int]$Start) {
    if ($Start -ge $Text.Length) { Throw-KvkFailure 'ENGINE_ERROR' '设置文件意外结束。' 'The settings file ended unexpectedly.' }
    $char=$Text[$Start]
    if ($char -eq '"') { return (Get-KvkJsonStringEnd $Text $Start) }
    if ($char -eq '{' -or $char -eq '[') {
        $open=$char;$close=if ($char -eq '{') { '}' } else { ']' }
        $depth=0;$index=$Start
        while ($index -lt $Text.Length) {
            $c=$Text[$index]
            if ($c -eq '"') { $index=Get-KvkJsonStringEnd $Text $index;continue }
            if ($c -eq $open) { $depth++ }
            elseif ($c -eq $close) { $depth--;if ($depth -eq 0) { return $index+1 } }
            $index++
        }
        Throw-KvkFailure 'ENGINE_ERROR' '设置文件中的对象没有结束括号。' 'An object in the settings file has no closing brace.'
    }
    $index=$Start
    while ($index -lt $Text.Length -and -not [char]::IsWhiteSpace($Text[$index]) -and $Text[$index] -notin @(',','}',']')) { $index++ }
    return $index
}
function Find-KvkJsonValue([string]$Text,[string]$Key) {
    $needle='"'+$Key+'"'
    $from=0
    while ($true) {
        $index=$Text.IndexOf($needle,$from,[StringComparison]::Ordinal)
        if ($index -lt 0) { return $null }
        $cursor=$index+$needle.Length
        while ($cursor -lt $Text.Length -and [char]::IsWhiteSpace($Text[$cursor])) { $cursor++ }
        if ($cursor -lt $Text.Length -and $Text[$cursor] -eq ':') {
            $valueStart=$cursor+1
            while ($valueStart -lt $Text.Length -and [char]::IsWhiteSpace($Text[$valueStart])) { $valueStart++ }
            return [pscustomobject]@{KeyStart=$index;ValueStart=$valueStart;ValueEnd=(Get-KvkJsonValueEnd $Text $valueStart)}
        }
        $from=$index+$needle.Length
    }
}
function ConvertTo-KvkJsonScalar($Value) {
    if ($Value -is [bool]) { return $(if ($Value) { 'true' } else { 'false' }) }
    if ($Value -is [string]) {
        $escaped=$Value.Replace('\','\\').Replace('"','\"').Replace("`b",'\b').Replace("`f",'\f').Replace("`n",'\n').Replace("`r",'\r').Replace("`t",'\t')
        return '"'+$escaped+'"'
    }
    if ($Value -is [int] -or $Value -is [long]) { return [string]([long]$Value) }
    return ([double]$Value).ToString('R',[Globalization.CultureInfo]::InvariantCulture)
}
function Set-KvkJsonSetting([string]$Text,[string]$Key,[object]$Value,[string[]]$Channels) {
    $span=Find-KvkJsonValue $Text $Key
    if ($null -eq $span) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少所需的键 (missing key): $Key" "The current settings are missing a required key: $Key." }
    if ($null -eq $Channels) { return $Text.Substring(0,$span.ValueStart)+(ConvertTo-KvkJsonScalar $Value)+$Text.Substring($span.ValueEnd) }
    $region=$Text.Substring($span.ValueStart,$span.ValueEnd-$span.ValueStart)
    foreach ($channel in $Channels) {
        if ($null -eq $Value[$channel]) { Throw-KvkFailure 'ENGINE_ERROR' "主题缺少 $Key.$channel" "The theme is missing $Key.$channel." }
        $inner=Find-KvkJsonValue $region $channel
        if ($null -eq $inner) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少所需的键 (missing key): $Key.$channel" "The current settings are missing a required key: $Key.$channel." }
        $region=$region.Substring(0,$inner.ValueStart)+(ConvertTo-KvkJsonScalar $Value[$channel])+$region.Substring($inner.ValueEnd)
    }
    return $Text.Substring(0,$span.ValueStart)+$region+$Text.Substring($span.ValueEnd)
}
function Get-KvkJsonSettingValue([string]$Text,[string]$Key,[string[]]$Channels) {
    $span=Find-KvkJsonValue $Text $Key
    if ($null -eq $span) { return $null }
    $region=$Text.Substring($span.ValueStart,$span.ValueEnd-$span.ValueStart)
    if ($null -eq $Channels) {
        try { return ($region | ConvertFrom-Json -Depth 8) } catch { return $region }
    }
    $value=@{}
    foreach ($channel in $Channels) {
        $inner=Find-KvkJsonValue $region $channel
        $value[$channel]=if ($null -eq $inner) { $null } else { $region.Substring($inner.ValueStart,$inner.ValueEnd-$inner.ValueStart) }
    }
    return $value
}

function Export-KvkFile([string]$Directory,[string]$FileName,[byte[]]$Bytes,[string]$GameRoot,[int]$MaxBytes=2097152) {
    # Writing a file outside the game tree is the one non-plan write this tool performs.
    # It never overwrites, never lands inside the game directory, and is verified on read-back.
    if ([string]::IsNullOrWhiteSpace($FileName) -or $FileName.Length -gt 200 -or
        $FileName -match '[\\/:*?"<>|\x00-\x1f]' -or $FileName -match '^[. ]' -or $FileName -match '[. ]$' -or
        $FileName.Contains('..') -or ($FileName.Split('.')[0] -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])$')) {
        Throw-KvkFailure 'ENGINE_ERROR' "另存的文件名无效 (unsafe file name): $FileName" "The file name for saving a copy is not safe: `"$FileName`"."
    }
    if ([string]::IsNullOrWhiteSpace($Directory) -or -not [IO.Path]::IsPathFullyQualified($Directory)) { Throw-KvkFailure 'ENGINE_ERROR' '另存的文件夹必须是完整路径 (absolute path required)。' 'The folder for saving a copy must be a full path.' }
    # Where it would land is judged before whether the folder exists: the game tree is refused
    # as a location, even for a subfolder that is not there yet.
    $full=Get-KvkFullPath (Join-Path $Directory $FileName)
    if (-not [string]::IsNullOrWhiteSpace($GameRoot)) {
        $game=Get-KvkFullPath $GameRoot
        $prefix=$game.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
        if ($full.Equals($game,[StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
            Throw-KvkFailure 'ENGINE_ERROR' '不能另存到游戏目录里；要放进游戏，请用「添加到游戏」 (refusing to export inside the game directory)。' 'A copy cannot be saved inside the game directory. Use Add to game to put a file in the game.'
        }
    }
    if (-not [IO.Directory]::Exists($Directory)) { Throw-KvkFailure 'ENGINE_ERROR' '另存的文件夹不存在 (directory does not exist)。' 'The folder for saving a copy does not exist.' }
    if ($null -eq $Bytes -or $Bytes.Length -le 0 -or $Bytes.Length -gt $MaxBytes) { Throw-KvkFailure 'ENGINE_ERROR' '另存内容的大小必须在 1 字节到大小上限之间 (size out of range)。' 'The size of the saved copy must be between 1 byte and the size limit.' }
    Assert-KvkSafePath $full
    # CreateNew is the overwrite guard: a file that appears between the check and the open loses.
    if ([IO.File]::Exists($full)) { Throw-KvkFailure 'ENGINE_ERROR' "这个文件夹里已经有「$FileName」，另存不会覆盖它；请换一个文件名 (already exists)。" "This folder already has `"$FileName`", and saving a copy never overwrites it. Choose another file name." }
    $stream=[IO.File]::Open($full,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($Bytes,0,$Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    $sha=Get-KvkHash $full
    if ($null -eq $sha) { Throw-KvkFailure 'ENGINE_ERROR' '另存后读回校验失败 (read-back failed)。' 'Reading the saved copy back for verification failed.' }
    return [pscustomobject]@{Path=$full;Bytes=$Bytes.Length;Sha256=$sha}
}

function Assert-KvkJsonObject([string]$Path) {
    $text=[IO.File]::ReadAllText($Path)
    # Windows PowerShell 5.1 can classify wrapped arrays/scalars as [pscustomobject].
    # Check the JSON root before parsing, then compare the actual CLR type.
    if (-not $text.TrimStart().StartsWith('{')) { throw "JSON must be an object: `"$Path`"" }
    try { $value=ConvertFrom-Json -InputObject $text -ErrorAction Stop } catch { throw "Invalid JSON at `"$Path`" : $($_.Exception.Message)" }
    if ($null -eq $value -or $value.GetType() -ne [System.Management.Automation.PSCustomObject]) { throw "JSON must be an object: `"$Path`"" }
}
function New-KvkPlan($Context, [string]$PackRoot, [string[]]$Categories) {
    Assert-KvkContext $Context
    $pack=Get-KvkPackFiles $PackRoot
    if (@($Categories).Count -eq 0) { throw 'Select at least one category.' }
    foreach ($c in $Categories) { if ($c -cnotin @('themes','sounds','crosshairs','ui','palette','primary')) { throw "Unknown category: $c" }; if ($c -notin @($pack.Items | Select-Object -ExpandProperty Category)) { throw "Category is not available: $c" } }
    $items=@()
    foreach ($item in @($pack.Items | Where-Object { $_.Category -in $Categories })) {
        if ($item.Category -in @('themes','ui','primary')) { Assert-KvkJsonObject $item.Source }
        $target=Get-KvkTarget $Context $item.Key; $before=Get-KvkHash $target; $after=Get-KvkHash $item.Source
        if ($null -eq $after) { throw "Source missing: `"$($item.Source)`"" }
        $action='replace'; if ($null -eq $before) {$action='create'} elseif ($before -eq $after) {$action='skip'}
        $items += [pscustomobject]@{Key=$item.Key;Source=$item.Source;Target=$target;Category=$item.Category;BeforeHash=$before;AfterHash=$after;Action=$action}
    }
    return [pscustomobject]@{GameRoot=$Context.GameRoot;LocalDataRoot=$Context.LocalDataRoot;PackRoot=$pack.Root;Categories=@($Categories);Items=@($items);Skipped=@($pack.Skipped)}
}
function Enter-KvkLock($Context) {
    Assert-KvkContext $Context; New-KvkDirectory $Context.LockRoot
    $locks=@()
    try {
        # Palette is shared by game installations. Always lock it first to avoid lock inversion.
        foreach ($name in @('palette.lock', ((Get-KvkTextHash $Context.GameRoot.ToLowerInvariant())+'.lock'))) {
            $path=Join-Path $Context.LockRoot $name; Assert-KvkSafePath $path
            $locks += [IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        }
        return ,$locks
    } catch { foreach ($lock in $locks) {$lock.Dispose()}; Throw-KvkFailure 'BUSY' "另一个 Aimloom 可能正在运行，或者无法使用锁文件：「$($_.Exception.Message)」" "Another Aimloom may be running, or the lock files could not be used: `"$($_.Exception.Message)`"" }
}
function Exit-KvkLock($Locks) { foreach ($lock in $Locks) { $lock.Dispose() } }
function Write-KvkDurableFile([string]$Path, [byte[]]$Bytes) {
    Assert-KvkSafePath $Path
    $s=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
    try { $s.Write($Bytes,0,$Bytes.Length); $s.Flush($true) } finally { $s.Dispose() }
}
function Write-KvkAtomicJson([string]$Path, $Value) {
    New-KvkDirectory ([IO.Path]::GetDirectoryName($Path))
    $before=Get-KvkHash $Path; $temp=$Path+'.tmp-'+[Guid]::NewGuid().ToString('N')
    try {
        $json=ConvertTo-Json -InputObject $Value -Depth 30 -Compress
        Write-KvkDurableFile $temp ([Text.Encoding]::UTF8.GetBytes($json))
        if ((Get-KvkHash $Path) -ne $before) { throw "Manifest changed concurrently: `"$Path`"" }
        if ($null -eq $before) { [IO.File]::Move($temp,$Path) } else { [IO.File]::Replace($temp,$Path,[NullString]::Value) }
        if ((Get-KvkHash $Path) -ne (Get-KvkTextHash $json)) { throw "Manifest read-back verification failed: `"$Path`"" }
        $null=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Path)) -ErrorAction Stop
    } finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
}
function Copy-KvkSnapshot([string]$Source, [string]$Destination, [string]$ExpectedHash) {
    if ((Get-KvkHash $Source) -ne $ExpectedHash -or [string]::IsNullOrEmpty($ExpectedHash)) { throw "File changed before backup: `"$Source`"" }
    $bytes=[IO.File]::ReadAllBytes($Source)
    New-KvkDirectory ([IO.Path]::GetDirectoryName($Destination)); Write-KvkDurableFile $Destination $bytes
    if ((Get-KvkHash $Destination) -ne $ExpectedHash -or (Get-KvkHash $Source) -ne $ExpectedHash) { throw "Backup verification failed: `"$Source`"" }
}
function Assert-KvkHashValue($Hash) { if ($null -ne $Hash -and ($Hash -isnot [string] -or $Hash -cnotmatch '^[a-f0-9]{64}$')) { throw 'Invalid persisted hash.' } }
function Assert-KvkFields($Object, [string[]]$Names) { foreach ($n in $Names) { if ($null -eq $Object -or $null -eq $Object.PSObject.Properties[$n]) { throw "Incomplete manifest: missing $n" } } }
function Get-KvkManifestPath($Context,[string]$Id) {
    if ($Id -cne 'pristine' -and $Id -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid backup identifier.' }
    return (Join-Path (Join-Path $Context.BackupRoot $Id) 'manifest.json')
}
function Read-KvkManifest($Context,[string]$Id) {
    $path=Get-KvkManifestPath $Context $Id; Assert-KvkSafePath $path
    if (-not [IO.File]::Exists($path)) { throw "Missing backup manifest: `"$path`"" }
    try { $m=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($path)) -ErrorAction Stop } catch { throw "Corrupt manifest: `"$path`"" }
    Assert-KvkFields $m @('Version','Id','Kind','CreatedAt','GameRoot','LocalDataRoot','Status','PackRoot','Categories','Items','SourceId')
    if ($m.Version -ne 1 -or $m.Id -cne $Id -or $m.GameRoot -ine $Context.GameRoot -or $m.LocalDataRoot -ine $Context.LocalDataRoot) { throw "Manifest identity mismatch: `"$path`"" }
    if ($m.Kind -cnotin @('install','restore','pristine') -or ($Id -ceq 'pristine') -ne ($m.Kind -ceq 'pristine')) { throw 'Invalid manifest kind.' }
    if ($m.Status -cnotin @('prepared','applying','completed','rolled-back','recovery-required','protected')) { throw 'Invalid manifest status.' }
    if ($m.Kind -eq 'pristine' -and $m.Status -ne 'protected') { throw 'Invalid first-touch status.' }
    if ($m.Kind -ne 'pristine' -and $m.Status -eq 'protected') { throw 'Invalid operation status.' }
    if ($m.Kind -eq 'restore') { $null=Get-KvkManifestPath $Context $m.SourceId } elseif ($null -ne $m.SourceId) { throw 'Unexpected source operation.' }
    # ConvertFrom-Json can promote ISO timestamps to DateTime. Casting them back to
    # strings changes the date format, so never reparse a valid date using user culture.
    if ($m.CreatedAt -isnot [datetime]) {
        $date=[datetime]::MinValue
        if ($m.CreatedAt -isnot [string] -or -not [datetime]::TryParse($m.CreatedAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$date)) { throw 'Invalid manifest timestamp.' }
    }
    if ($null -eq $m.Items -or $m.Items -isnot [array] -or $m.Items.Count -eq 0) { throw 'Manifest has no file records.' }
    $seen=@{}
    foreach ($item in $m.Items) {
        Assert-KvkFields $item @('Key','Target','BeforeHash','AfterHash','Backup','DesiredBackup','State','TempPath')
        $target=Get-KvkTarget $Context $item.Key
        if ($item.Target -ine $target -or $seen.ContainsKey($item.Target)) { throw 'Invalid or duplicate manifest target.' }; $seen[$item.Target]=$true
        Assert-KvkHashValue $item.BeforeHash; Assert-KvkHashValue $item.AfterHash
        if ($m.Kind -ne 'restore' -and $null -eq $item.AfterHash) { throw 'Missing installed hash.' }
        if ($item.State -cnotin @('pending','writing','applied','restored','protected')) { throw 'Invalid file execution state.' }
        if (($m.Kind -eq 'pristine') -ne ($item.State -eq 'protected')) { throw 'Invalid first-touch record state.' }
        if (($m.Status -eq 'completed' -and $item.State -ne 'applied') -or ($m.Status -eq 'rolled-back' -and $item.State -ne 'restored') -or ($m.Status -eq 'prepared' -and $item.State -ne 'pending')) { throw 'Inconsistent operation progress.' }
        $directory=Split-Path $path -Parent
        foreach ($pair in @(@('Backup','BeforeHash'),@('DesiredBackup','AfterHash'))) {
            $name=$pair[0];$hashName=$pair[1];$rel=$item.$name
            if ($name -eq 'DesiredBackup' -and $m.Kind -ne 'restore') { if ($null -ne $rel) {throw 'Unexpected desired backup.'}; continue }
            if ($null -eq $item.$hashName) { if ($null -ne $rel) {throw 'Unexpected snapshot path.'}; continue }
            if ($rel -isnot [string] -or $rel -cnotmatch '^(files|desired)/[a-f0-9]{64}\.bin$') { throw 'Unsafe snapshot path.' }
            $file=Join-Path $directory $rel
            if ((Get-KvkHash $file) -ne $item.$hashName) { throw "Missing or corrupt backup: `"$file`"" }
        }
        if ($null -ne $item.TempPath) {
            $expectedPrefix=$item.Target+'.kvk-'+$Id+'-'
            if (-not $item.TempPath.StartsWith($expectedPrefix,[StringComparison]::Ordinal) -or $item.TempPath.Substring($expectedPrefix.Length) -cnotmatch '^[a-f0-9]{32}\.tmp$') { throw 'Unsafe operation temporary path.' }
            Assert-KvkSafePath $item.TempPath
        }
        if ($item.State -eq 'writing' -and $null -ne $item.AfterHash -and $null -eq $item.TempPath) { throw 'Missing write intent.' }
    }
    return $m
}
function Save-KvkManifest($Context,$Manifest) { Write-KvkAtomicJson (Get-KvkManifestPath $Context $Manifest.Id) $Manifest }
function Get-KvkManifests($Context) {
    Assert-KvkContext $Context
    if (-not [IO.Directory]::Exists($Context.BackupRoot)) { return }
    foreach ($dir in @(Get-ChildItem -LiteralPath $Context.BackupRoot -Force -ErrorAction Stop)) {
        Assert-KvkSafePath $dir.FullName
        if ($dir.Name -match '^\.stage-[a-f0-9]{32}$') { continue } # No game writes are possible until this directory is published.
        if (-not $dir.PSIsContainer) { throw "Unexpected backup entry: `"$($dir.FullName)`"" }
        Read-KvkManifest $Context $dir.Name
    }
}
function Get-KvkBackupList($Context) {
    return @(Get-KvkManifests $Context | Where-Object {$_.Kind -ne 'pristine'} | Sort-Object CreatedAt -Descending | Select-Object Id,CreatedAt,Status,Kind)
}
function New-KvkManifest($Context,[string]$Kind,[string]$Id,$Items,[string]$PackRoot,[string[]]$Categories,$SourceId) {
    return [pscustomobject]@{Version=1;Id=$Id;Kind=$Kind;CreatedAt=[datetime]::UtcNow.ToString('o');GameRoot=$Context.GameRoot;LocalDataRoot=$Context.LocalDataRoot;PackRoot=$PackRoot;Categories=@($Categories);Status='prepared';SourceId=$SourceId;Items=@($Items)}
}
function New-KvkRecord([string]$Key,[string]$Target,$BeforeHash,$AfterHash) {
    return [pscustomobject]@{Key=$Key;Target=$Target;BeforeHash=$BeforeHash;AfterHash=$AfterHash;Backup=$null;DesiredBackup=$null;State='pending';TempPath=$null}
}
function Add-KvkPristine($Context,$InstallManifest,[string]$InstallDirectory,[scriptblock]$Observer=$null) {
    $originalPath=Get-KvkManifestPath $Context 'pristine'
    $old=$null; if ([IO.File]::Exists($originalPath)) { $old=Read-KvkManifest $Context 'pristine' }
    $workingDirectory=Split-Path $originalPath -Parent
    if ($null -eq $old) { $workingDirectory=Join-Path $Context.BackupRoot ('.stage-'+[Guid]::NewGuid().ToString('N'));New-KvkDirectory $workingDirectory }
    $all=@();$keys=@{}
    if ($null -ne $old) { foreach ($x in $old.Items) { $all += $x; $keys[$x.Key]=$true } }
    foreach ($x in $InstallManifest.Items) {
        if ($keys.ContainsKey($x.Key)) { continue }
        $r=New-KvkRecord $x.Key $x.Target $x.BeforeHash $x.AfterHash; $r.State='protected'
        if ($null -ne $x.BeforeHash) {
            $r.Backup='files/'+(Get-KvkTextHash ($x.Key.ToLowerInvariant()+'/'+[Guid]::NewGuid().ToString('N')))+'.bin'
            $dest=Join-Path $workingDirectory $r.Backup
            # Unindexed snapshots from an interrupted append are harmless; indexed files are immutable.
            Copy-KvkSnapshot (Join-Path $InstallDirectory $x.Backup) $dest $x.BeforeHash
        }
        $all += $r; $keys[$x.Key]=$true
    }
    if ($null -eq $old) { $old=New-KvkManifest $Context 'pristine' 'pristine' $all '' @() $null; $old.Status='protected' } else { $old.Items=@($all) }
    if ($workingDirectory -ne (Split-Path $originalPath -Parent)) {
        Write-KvkAtomicJson (Join-Path $workingDirectory 'manifest.json') $old
        [IO.Directory]::Move($workingDirectory,(Split-Path $originalPath -Parent))
    } else { Save-KvkManifest $Context $old }
    $null=Read-KvkManifest $Context 'pristine'
    Send-KvkObservation $Observer ([pscustomobject]@{Name='pristine-protected';Phase='protecting';Completed=$InstallManifest.Items.Count;Total=$InstallManifest.Items.Count;CurrentFile=$null;BatchId=$InstallManifest.Id})
}
function Test-KvkOwned($Item) {
    if ($Item.State -eq 'applied') { return $true }
    if ($Item.State -eq 'writing') {
        if ($null -eq $Item.AfterHash) { return $true }
        # Rename consumes the uniquely journaled temporary file. A failed exclusive create leaves it present.
        return ($null -ne $Item.TempPath -and -not [IO.File]::Exists($Item.TempPath))
    }
    return $false
}
# -AllowRunningGame is an explicit opt-in used only by the user-approved scheme flow.
# Every other caller keeps the game-closed requirement.
function Assert-KvkGameClosedUnless([bool]$Allowed) { if (-not $Allowed) { Assert-KvkGameClosed } }
function Invoke-KvkFileChange($Context,$Manifest,$Item,[string]$Source,[switch]$AllowRunningGame) {
    Assert-KvkGameClosedUnless $AllowRunningGame
    Assert-KvkSafePath $Item.Target
    if ((Get-KvkHash $Item.Target) -ne $Item.BeforeHash) { throw "Target changed before write: `"$($Item.Target)`"" }
    if ($null -eq $Item.AfterHash) {
        $Item.State='writing'; Save-KvkManifest $Context $Manifest
        Assert-KvkGameClosedUnless $AllowRunningGame
        if ((Get-KvkHash $Item.Target) -ne $Item.BeforeHash) { throw "Target changed before deletion: `"$($Item.Target)`"" }
        if ($null -ne $Item.BeforeHash) { [IO.File]::Delete($Item.Target) }
    } else {
        New-KvkDirectory ([IO.Path]::GetDirectoryName($Item.Target))
        $Item.TempPath=$Item.Target+'.kvk-'+$Manifest.Id+'-'+[Guid]::NewGuid().ToString('N')+'.tmp'
        Copy-KvkSnapshot $Source $Item.TempPath $Item.AfterHash
        $Item.State='writing'; Save-KvkManifest $Context $Manifest
        Assert-KvkGameClosedUnless $AllowRunningGame
        if ((Get-KvkHash $Item.Target) -ne $Item.BeforeHash) { throw "Target changed before replacement: `"$($Item.Target)`"" }
        if ($null -eq $Item.BeforeHash) { [IO.File]::Move($Item.TempPath,$Item.Target) } else { [IO.File]::Replace($Item.TempPath,$Item.Target,[NullString]::Value) }
    }
    if ((Get-KvkHash $Item.Target) -ne $Item.AfterHash) { throw "Read-back verification failed: `"$($Item.Target)`"" }
    $Item.State='applied'; Save-KvkManifest $Context $Manifest
}
# The UI's CJK guard uses the same ranges: CJK punctuation, ideographs and full-width forms.
function Test-KvkCjk([string]$Text) { return ($Text -cmatch '[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]') }
# English a player may be shown: not blank, and no CJK OUTSIDE double-quoted spans. A span is
# "…" (ASCII double quotes, no nesting) and holds game content — a file name, a theme name, a
# Profile name or a path — which is never translated and may well be Chinese. An odd number of
# quotes leaves the unclosed tail outside, so a broken message cannot smuggle an untranslated
# sentence through. is_english (Rust protocol.rs) and isEnglishText (src/i18n/index.ts) do the
# same; a shared ten-case parity table pins the three together.
function Test-KvkEnglishSafe([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    $parts=$Text.Split([char]'"')
    $last=$parts.Length-1
    for ($i=0;$i -le $last;$i++) {
        if (($i % 2 -eq 0 -or $i -eq $last) -and (Test-KvkCjk $parts[$i])) { return $false }
    }
    return $true
}
# Written to stderr, which the native layer copies into worker.log, and only there: the GUI
# worker sets $global:KvkStderrDetails, while the console wizard shares this engine and must
# keep its terminal clean.
function Write-KvkDetail([string]$Text) {
    $enabled=Get-Variable -Name 'KvkStderrDetails' -Scope Global -ValueOnly -ErrorAction SilentlyContinue
    if (-not $enabled) { return }
    try { [Console]::Error.WriteLine($Text) } catch { }
}
# English for one error line: the given English when it is English-safe, otherwise the line
# itself when it is, otherwise a fixed line. That line promises the details are in worker.log,
# so the original text is written to the worker's stderr here — otherwise the promise is empty.
# Naming a log is not help unless it also says where to take it, so the line names both ways
# out. Both still work when the engine is the thing that failed: a report is built and sent by
# the native layer, never by PowerShell.
function Get-KvkEnglishText([string]$Message,[string]$English=$null) {
    if (Test-KvkEnglishSafe $English) { return $English }
    if (Test-KvkEnglishSafe $Message) { return $Message }
    $detail=$Message
    if (-not [string]::IsNullOrWhiteSpace($English) -and $English -cne $Message) { $detail="$Message | $English" }
    Write-KvkDetail "KVK untranslated message: $detail"
    return 'The engine reported an error. Details are in worker.log; send a report from Settings, or write to feedback@aimloom.dev.'
}
function Get-KvkErrorEnglish([Exception]$Exception) {
    $english=$null
    if ($Exception.Data.Contains('KvkMessageEn')) { $english=[string]$Exception.Data['KvkMessageEn'] }
    return (Get-KvkEnglishText $Exception.Message $english)
}
# ErrorsEn holds the English for each line of Errors, in the same order. A caller that has no
# English of its own gets it derived line by line.
function New-KvkReport([string]$Status,$Id,$Items,[string[]]$Errors,[string[]]$ErrorsEn=$null) {
    $lines=@($Errors)
    if ($null -eq $ErrorsEn -or @($ErrorsEn).Count -ne $lines.Count) { $ErrorsEn=@($lines | ForEach-Object { Get-KvkEnglishText $_ }) }
    else { $given=@($ErrorsEn); $ErrorsEn=@(for ($i=0;$i -lt $lines.Count;$i++) { Get-KvkEnglishText $lines[$i] $given[$i] }) }
    return [pscustomobject]@{Status=$Status;Id=$Id;Items=@($Items);Errors=@($lines);ErrorsEn=@($ErrorsEn)}
}
function Invoke-KvkInstall($Context,$Plan,[scriptblock]$Observer=$null,[switch]$AllowRunningGame) {
    $locks=Enter-KvkLock $Context
    try {
        Assert-KvkGameClosedUnless $AllowRunningGame
        $manifests=@(Get-KvkManifests $Context)
        if (@($manifests | Where-Object {$_.Status -in @('prepared','applying','recovery-required')}).Count -gt 0) { Throw-KvkFailure 'RECOVERY_REQUIRED' '上一次操作还没有完成，请先恢复再安装。' 'An unfinished operation must be recovered before installing.' }
        $fresh=New-KvkPlan $Context $Plan.PackRoot $Plan.Categories
        if ($Plan.GameRoot -ine $Context.GameRoot -or $Plan.LocalDataRoot -ine $Context.LocalDataRoot -or $Plan.Items.Count -ne $fresh.Items.Count) { Throw-KvkFailure 'PLAN_STALE' '安装预览与当前文件不一致。' 'Install preview no longer matches.' }
        for ($i=0;$i -lt $fresh.Items.Count;$i++) { foreach ($field in @('Key','Source','Target','Category','BeforeHash','AfterHash','Action')) { if ($fresh.Items[$i].$field -cne $Plan.Items[$i].$field) {Throw-KvkFailure 'PLAN_STALE' '预览之后来源或目标文件发生了变化。' 'Install source or target changed after preview.'} } }
        $todo=@($fresh.Items | Where-Object {$_.Action -ne 'skip'})
        if ($todo.Count -eq 0) {
            $report=New-KvkReport 'no-change' $null $fresh.Items @()
            Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='verifying';Completed=0;Total=0;CurrentFile=$null;BatchId=$null;Report=$report})
            return $report
        }
        $id=[Guid]::NewGuid().ToString('N'); $stage=Join-Path $Context.BackupRoot ('.stage-'+$id); New-KvkDirectory $stage
        $records=@()
        $staged=0
        foreach ($x in $todo) {
            Send-KvkObservation $Observer ([pscustomobject]@{Name='source-staging';Phase='preparing';Completed=$staged;Total=$todo.Count;CurrentFile=$x.Key;BatchId=$id})
            $r=New-KvkRecord $x.Key $x.Target $x.BeforeHash $x.AfterHash
            if ($null -ne $r.BeforeHash) { $r.Backup='files/'+(Get-KvkTextHash $r.Key.ToLowerInvariant())+'.bin'; Copy-KvkSnapshot $r.Target (Join-Path $stage $r.Backup) $r.BeforeHash }
            # Stage source bytes too: all source reads complete before any game write.
            Copy-KvkSnapshot $x.Source (Join-Path $stage ('source/'+(Get-KvkTextHash $r.Key.ToLowerInvariant())+'.bin')) $r.AfterHash
            $records += $r
            $staged++
        }
        $m=New-KvkManifest $Context 'install' $id $records $fresh.PackRoot $fresh.Categories $null
        Write-KvkAtomicJson (Join-Path $stage 'manifest.json') $m
        # Publish a validated backup before extending immutable first-touch state or touching targets.
        [IO.Directory]::Move($stage,(Join-Path $Context.BackupRoot $id))
        $m=Read-KvkManifest $Context $id
        try {
            Add-KvkPristine $Context $m (Join-Path $Context.BackupRoot $id) $Observer
            $m.Status='applying'; Save-KvkManifest $Context $m
            Send-KvkObservation $Observer ([pscustomobject]@{Name='installing';Phase='installing';Completed=0;Total=$m.Items.Count;CurrentFile=$null;BatchId=$id})
            $completed=0
            foreach ($r in $m.Items) {
                Invoke-KvkFileChange $Context $m $r (Join-Path (Join-Path $Context.BackupRoot $id) ('source/'+(Get-KvkTextHash $r.Key.ToLowerInvariant())+'.bin')) -AllowRunningGame:$AllowRunningGame
                $completed++
                Send-KvkObservation $Observer ([pscustomobject]@{Name='file-verified';Phase='verifying';Completed=$completed;Total=$m.Items.Count;CurrentFile=$r.Key;BatchId=$id})
            }
            $m.Status='completed'; Save-KvkManifest $Context $m
            $report=New-KvkReport 'completed' $id $m.Items @()
            Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='verifying';Completed=$m.Items.Count;Total=$m.Items.Count;CurrentFile=$null;BatchId=$id;Report=$report})
            return $report
        } catch {
            $errors=@($_.Exception.Message); $errorsEn=@(Get-KvkErrorEnglish $_.Exception)
            try {
                $rollback=Undo-KvkFailedInstall $Context $m $Observer -AllowRunningGame:$AllowRunningGame; $errors += @($rollback.Errors); $errorsEn += @($rollback.ErrorsEn)
                $report=New-KvkReport $rollback.Status $id $m.Items $errors $errorsEn
                Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='rolling-back';Completed=$m.Items.Count;Total=$m.Items.Count;CurrentFile=$null;BatchId=$id;Report=$report})
                return $report
            } catch {
                $errors += $_.Exception.Message; $errorsEn += Get-KvkErrorEnglish $_.Exception; $m.Status='recovery-required'
                try { Save-KvkManifest $Context $m } catch { $errors += $_.Exception.Message; $errorsEn += Get-KvkErrorEnglish $_.Exception }
                $report=New-KvkReport 'recovery-required' $id $m.Items $errors $errorsEn
                Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='rolling-back';Completed=$null;Total=$m.Items.Count;CurrentFile=$null;BatchId=$id;Report=$report})
                return $report
            }
        }
    } finally { Exit-KvkLock $locks }
}
function Undo-KvkFailedInstall($Context,$Manifest,[scriptblock]$Observer=$null,[switch]$AllowRunningGame) {
    # Validation and planning happen for every affected file before automatic rollback begins.
    $null=Read-KvkManifest $Context $Manifest.Id
    Assert-KvkGameClosedUnless $AllowRunningGame
    $Manifest.Status='recovery-required'; Save-KvkManifest $Context $Manifest
    Send-KvkObservation $Observer ([pscustomobject]@{Name='rollback-started';Phase='rolling-back';Completed=0;Total=$Manifest.Items.Count;CurrentFile=$null;BatchId=$Manifest.Id})
    $errors=@()
    foreach ($x in $Manifest.Items) {
        $current=Get-KvkHash $x.Target
        if ($current -eq $x.BeforeHash) { continue }
        if (-not (Test-KvkOwned $x) -or $current -ne $x.AfterHash) { throw "Automatic rollback conflict: `"$($x.Target)`"" }
    }
    $completed=0
    foreach ($x in $Manifest.Items) {
        if ((Get-KvkHash $x.Target) -eq $x.BeforeHash) {
            $x.State='restored'; Save-KvkManifest $Context $Manifest; $completed++
            Send-KvkObservation $Observer ([pscustomobject]@{Name='file-verified';Phase='rolling-back';Completed=$completed;Total=$Manifest.Items.Count;CurrentFile=$x.Key;BatchId=$Manifest.Id})
            continue
        }
        Assert-KvkGameClosedUnless $AllowRunningGame
        if ((Get-KvkHash $x.Target) -ne $x.AfterHash) { throw "Target changed during rollback: `"$($x.Target)`"" }
        if ($null -eq $x.BeforeHash) { [IO.File]::Delete($x.Target) }
        else {
            $temp=$x.Target+'.rollback-'+[Guid]::NewGuid().ToString('N')+'.tmp'
            Copy-KvkSnapshot (Join-Path (Join-Path $Context.BackupRoot $Manifest.Id) $x.Backup) $temp $x.BeforeHash
            try { Assert-KvkGameClosedUnless $AllowRunningGame; if ((Get-KvkHash $x.Target) -ne $x.AfterHash) {throw 'Target changed during rollback.'}; [IO.File]::Replace($temp,$x.Target,[NullString]::Value) } finally { if ([IO.File]::Exists($temp)) {[IO.File]::Delete($temp)} }
        }
        if ((Get-KvkHash $x.Target) -ne $x.BeforeHash) { throw "Rollback verification failed: `"$($x.Target)`"" }
        $x.State='restored'; Save-KvkManifest $Context $Manifest
        $completed++
        Send-KvkObservation $Observer ([pscustomobject]@{Name='file-verified';Phase='rolling-back';Completed=$completed;Total=$Manifest.Items.Count;CurrentFile=$x.Key;BatchId=$Manifest.Id})
    }
    $Manifest.Status='rolled-back'; Save-KvkManifest $Context $Manifest
    return (New-KvkReport 'rolled-back' $Manifest.Id $Manifest.Items $errors)
}
function New-KvkRestorePlan($Context,[string]$Id) {
    Assert-KvkContext $Context
    $all=@(Get-KvkManifests $Context)
    $m=Read-KvkManifest $Context $Id
    $items=@(); $conflicts=@()
    foreach ($x in $m.Items) {
        $current=Get-KvkHash $x.Target; $desired=$x.BeforeHash; $backup=$x.Backup; $sourceId=$Id; $expected=$x.AfterHash; $owned=Test-KvkOwned $x
        if ($m.Kind -eq 'restore') { $desired=$x.AfterHash; $backup=$x.DesiredBackup; $expected=$x.BeforeHash; $owned=$true }
        if ($m.Kind -eq 'pristine') {
            $owned=$false; $expected=$x.BeforeHash
            foreach ($history in @($all | Where-Object {$_.Kind -ne 'pristine'} | Sort-Object CreatedAt)) {
                foreach ($h in @($history.Items | Where-Object {$_.Key -ieq $x.Key})) {
                    if ($h.State -eq 'restored') { $expected=$h.BeforeHash; $owned=$true }
                    elseif (Test-KvkOwned $h) { $expected=$h.AfterHash; $owned=$true }
                }
            }
        }
        $action='restore'; if ($null -eq $desired) {$action='delete'}; if ($current -eq $desired) {$action='skip'}
        $conflict=($action -ne 'skip' -and ($current -ne $expected -or -not $owned))
        $unowned=($action -ne 'skip' -and $null -eq $desired -and -not $owned)
        if ($conflict) { $conflicts += $x.Target }
        $items += [pscustomobject]@{Key=$x.Key;Target=$x.Target;Action=$action;CurrentHash=$current;DesiredHash=$desired;DesiredBackup=$backup;SourceId=$sourceId;Conflict=$conflict;Unowned=$unowned}
    }
    return [pscustomobject]@{Id=$Id;Kind=$m.Kind;GameRoot=$Context.GameRoot;LocalDataRoot=$Context.LocalDataRoot;Items=@($items);Conflicts=@($conflicts)}
}
function Complete-KvkRestore($Context,$Manifest) {
    $Manifest.Status='completed'; Save-KvkManifest $Context $Manifest
    if ($Manifest.SourceId -ne 'pristine') {
        $source=Read-KvkManifest $Context $Manifest.SourceId
        if ($source.Kind -eq 'install') { $source.Status='rolled-back'; foreach ($x in $source.Items) {$x.State='restored'}; Save-KvkManifest $Context $source }
    } else {
        # A successful pristine recovery settles older pending install operations covering these same paths.
        foreach ($source in @(Get-KvkManifests $Context | Where-Object {$_.Kind -eq 'install' -and $_.Status -in @('prepared','applying','recovery-required')})) {
            $source.Status='rolled-back'; foreach ($x in $source.Items) {$x.State='restored'}; Save-KvkManifest $Context $source
        }
    }
}
function Invoke-KvkRestore($Context,$Plan,[switch]$AllowConflicts,[scriptblock]$Observer=$null) {
    $locks=Enter-KvkLock $Context
    try {
        Assert-KvkGameClosed
        $fresh=New-KvkRestorePlan $Context $Plan.Id
        if ($fresh.GameRoot -ine $Plan.GameRoot -or $fresh.LocalDataRoot -ine $Plan.LocalDataRoot -or $fresh.Items.Count -ne $Plan.Items.Count) { Throw-KvkFailure 'PLAN_STALE' '恢复预览已改变。' 'Restore preview changed.' }
        for ($i=0;$i -lt $fresh.Items.Count;$i++) { foreach ($field in @('Key','Target','Action','CurrentHash','DesiredHash','DesiredBackup','SourceId','Conflict','Unowned')) { if ($fresh.Items[$i].$field -cne $Plan.Items[$i].$field) {Throw-KvkFailure 'PLAN_STALE' '恢复预览之后目标文件或备份发生了变化。' 'Target or backup changed after restore preview.'} } }
        if (@($fresh.Items | Where-Object {$_.Unowned}).Count -gt 0) { Throw-KvkFailure 'UNOWNED_FILE' '没有证据证明这个文件是本程序写入的，因此不会删除它。' 'Cannot delete a file without proof that this installer created it.' }
        if ($fresh.Conflicts.Count -gt 0 -and -not $AllowConflicts) { throw ('Restore conflicts require explicit confirmation: '+($fresh.Conflicts -join ', ')) }
        $source=Read-KvkManifest $Context $Plan.Id
        if ($source.Kind -eq 'restore' -and $source.Status -in @('prepared','applying','recovery-required')) {
            $m=$source; $m.Status='applying'
            # Preserve newly changed retry conflicts before accepting their previewed state.
            foreach ($x in $m.Items) {
                $p=@($fresh.Items | Where-Object {$_.Key -ceq $x.Key})[0]
                if ($p.Action -eq 'skip') {$x.State='applied';continue}
                if ($x.BeforeHash -ne $p.CurrentHash) {
                    if ($null -ne $p.CurrentHash) {
                        $rel='files/'+(Get-KvkTextHash ($x.Key+'/'+[Guid]::NewGuid().ToString('N')))+'.bin'
                        Copy-KvkSnapshot $x.Target (Join-Path (Join-Path $Context.BackupRoot $m.Id) $rel) $p.CurrentHash; $x.Backup=$rel
                    } else {$x.Backup=$null}
                    $x.BeforeHash=$p.CurrentHash
                }
                $x.State='pending';$x.TempPath=$null
            }
            Save-KvkManifest $Context $m
        } else {
            $todo=@($fresh.Items | Where-Object {$_.Action -ne 'skip'})
            if ($todo.Count -eq 0) {
                if ($source.Kind -eq 'install' -and $source.Status -in @('prepared','applying','recovery-required')) { $source.Status='rolled-back';foreach($x in $source.Items){$x.State='restored'};Save-KvkManifest $Context $source }
                $report=New-KvkReport 'restored' $Plan.Id $fresh.Items @()
                Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='restoring';Completed=0;Total=0;CurrentFile=$null;BatchId=$Plan.Id;Report=$report})
                return $report
            }
            $id=[Guid]::NewGuid().ToString('N');$stage=Join-Path $Context.BackupRoot ('.stage-'+$id);New-KvkDirectory $stage
            $records=@()
            $staged=0
            foreach ($p in $todo) {
                Send-KvkObservation $Observer ([pscustomobject]@{Name='restore-preparing';Phase='preparing';Completed=$staged;Total=$todo.Count;CurrentFile=$p.Key;BatchId=$id})
                $x=New-KvkRecord $p.Key $p.Target $p.CurrentHash $p.DesiredHash
                $keyHash=Get-KvkTextHash $p.Key.ToLowerInvariant()
                if ($null -ne $p.CurrentHash) {$x.Backup='files/'+$keyHash+'.bin';Copy-KvkSnapshot $p.Target (Join-Path $stage $x.Backup) $p.CurrentHash}
                if ($null -ne $p.DesiredHash) {$x.DesiredBackup='desired/'+$keyHash+'.bin';Copy-KvkSnapshot (Join-Path (Join-Path $Context.BackupRoot $p.SourceId) $p.DesiredBackup) (Join-Path $stage $x.DesiredBackup) $p.DesiredHash}
                $records += $x
                $staged++
            }
            $m=New-KvkManifest $Context 'restore' $id $records '' @() $Plan.Id
            Write-KvkAtomicJson (Join-Path $stage 'manifest.json') $m
            [IO.Directory]::Move($stage,(Join-Path $Context.BackupRoot $id))
            $m=Read-KvkManifest $Context $id
        }
        try {
            $m.Status='applying';Save-KvkManifest $Context $m
            Send-KvkObservation $Observer ([pscustomobject]@{Name='restoring';Phase='restoring';Completed=0;Total=$m.Items.Count;CurrentFile=$null;BatchId=$m.Id})
            $completed=0
            foreach ($x in $m.Items) {
                if ($x.State -eq 'applied') { $completed++; continue }
                $desiredPath='';if ($null -ne $x.DesiredBackup) {$desiredPath=Join-Path (Join-Path $Context.BackupRoot $m.Id) $x.DesiredBackup}
                Invoke-KvkFileChange $Context $m $x $desiredPath
                $completed++
                Send-KvkObservation $Observer ([pscustomobject]@{Name='file-verified';Phase='verifying';Completed=$completed;Total=$m.Items.Count;CurrentFile=$x.Key;BatchId=$m.Id})
            }
            Complete-KvkRestore $Context $m
            $report=New-KvkReport 'restored' $m.Id $m.Items @()
            Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='verifying';Completed=$m.Items.Count;Total=$m.Items.Count;CurrentFile=$null;BatchId=$m.Id;Report=$report})
            return $report
        } catch {
            $errors=@($_.Exception.Message);$errorsEn=@(Get-KvkErrorEnglish $_.Exception);$m.Status='recovery-required'
            try {Save-KvkManifest $Context $m} catch {$errors += $_.Exception.Message;$errorsEn += Get-KvkErrorEnglish $_.Exception}
            $report=New-KvkReport 'recovery-required' $m.Id $m.Items $errors $errorsEn
            Send-KvkObservation $Observer ([pscustomobject]@{Name='report';Phase='restoring';Completed=$null;Total=$m.Items.Count;CurrentFile=$null;BatchId=$m.Id;Report=$report})
            return $report
        }
    } finally { Exit-KvkLock $locks }
}

# Profiles are editor documents only. These helpers never inspect or mutate the game.
function Assert-KvkProfileId($Id) {
    if ($Id -isnot [string] -or $Id -cnotmatch '^[a-z0-9][a-z0-9_-]{0,63}\z' -or $Id -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])$') {
        Throw-KvkFailure 'INVALID_PATH' 'Profile 标识无效。' 'The Profile id is not valid.'
    }
}
function Assert-KvkProfileObject($Value,[string[]]$Required,[string[]]$Optional=@()) {
    if ($null -eq $Value -or ($Value -isnot [Collections.IDictionary] -and $Value.GetType() -ne [Management.Automation.PSCustomObject])) { Throw-KvkFailure 'ENGINE_ERROR' 'Profile 字段必须是 JSON 对象。' 'A Profile field must be a JSON object.' }
    $keys=if($Value -is [Collections.IDictionary]){@($Value.Keys)}else{@($Value.PSObject.Properties.Name)}
    foreach($key in $Required){if($key -cnotin $keys){Throw-KvkFailure 'ENGINE_ERROR' "Profile 缺少字段：$key" "The Profile is missing the field: $key."}}
    foreach($key in $keys){if($key -cnotin ($Required+$Optional)){Throw-KvkFailure 'ENGINE_ERROR' "Profile 含未知字段：$key" "The Profile has an unknown field: $key."}}
}
function Assert-KvkProfileText($Value,[int]$Limit,[string]$Label,[string]$LabelEn) {
    if($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt $Limit -or $Value.IndexOfAny([char[]]@([char]0,[char]10,[char]13)) -ge 0){Throw-KvkFailure 'ENGINE_ERROR' "Profile $Label 文本无效。" "The Profile $LabelEn text is not valid."}
}
function Assert-KvkProfileFile($Value,[string[]]$Extensions) {
    Assert-KvkProfileText $Value 4096 '文件引用' 'file reference'
    if($Value -match '^[\\/]{2}[?.][\\/]'){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 文件引用不允许设备命名空间。' 'A Profile file reference may not use the device namespace.'}
    if(($Value -match '^[a-zA-Z][a-zA-Z0-9+.-]*:' -and $Value -notmatch '^[a-zA-Z]:[\\/]') -or [IO.Path]::GetExtension($Value) -inotmatch ('^(?:'+(($Extensions | ForEach-Object {[regex]::Escape($_)}) -join '|')+')$')){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 文件引用格式或扩展名无效。' 'A Profile file reference has an invalid format or extension.'}
}
function Test-KvkProfileNumber($Value) {
    return ($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [short] -or $Value -is [ushort] -or $Value -is [int] -or $Value -is [uint] -or $Value -is [long] -or $Value -is [ulong] -or $Value -is [float] -or $Value -is [double] -or $Value -is [decimal])
}
function Assert-KvkProfileReference($Value,[string[]]$Extensions) {
    Assert-KvkProfileObject $Value @('name','path')
    Assert-KvkProfileText $Value.name 4096 '名称' 'name'
    Assert-KvkProfileFile $Value.path $Extensions
}
# v0.1.3 removed the crosshair slot from a Profile: a crosshair cannot be switched from outside the
# game, so recording one promised something the App could not keep. 2026-09-21 removed the enemy
# slot the same way: a Profile no longer manages the enemy. Neither key is written any more, but a
# Profile saved before either removal still carries the key and must keep opening. So `crosshair`
# and `enemy` are both OPTIONAL, neither value is looked at, and Remove-KvkProfileLegacy takes both
# off every Profile this engine returns or writes -- an unvalidated value can therefore never reach
# the disk. The same rule lives in profiles/model.ts and in Rust's profiles.rs; the fixtures in
# tests/installer/profiles/ hold all three layers to it.
function Remove-KvkProfileLegacy($Profile) {
    # Remove is safe on a missing key for both a Hashtable and a generic Dictionary; `Contains` is not
    # callable on the latter from PowerShell (it is an explicit interface member).
    foreach($legacyKey in @('crosshair','enemy')){
        if($Profile -is [Collections.IDictionary]){ $null=$Profile.Remove($legacyKey) }
        elseif($null -ne $Profile -and $null -ne $Profile.PSObject.Properties[$legacyKey]){ $Profile.PSObject.Properties.Remove($legacyKey) }
    }
}
function Assert-KvkProfile($Profile) {
    Assert-KvkProfileObject $Profile @('schemaVersion','id','name','scheme','audio') @('crosshair','enemy')
    if(-not (Test-KvkProfileNumber $Profile.schemaVersion) -or $Profile.schemaVersion -ne 1){Throw-KvkFailure 'ENGINE_ERROR' '不支持此 Profile 版本。' 'This Profile version is not supported.'}
    Assert-KvkProfileId $Profile.id
    Assert-KvkProfileText $Profile.name 128 '名称' 'name'
    if($null -ne $Profile.scheme){Assert-KvkProfileReference $Profile.scheme @('.json')}
    if($null -ne $Profile.audio){
        Assert-KvkProfileObject $Profile.audio @() @('kill','spawn','mbsGood','mbsOkay','mbsBad','mbsChangeNow')
        $keys=if($Profile.audio -is [Collections.IDictionary]){@($Profile.audio.Keys)}else{@($Profile.audio.PSObject.Properties.Name)}
        foreach($key in $keys){
            $files=$Profile.audio.$key
            if($files -isnot [array] -or $files.Count -gt 64){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 音效必须是最多 64 项的数组。' 'Profile sounds must be an array of at most 64 entries.'}
            foreach($file in $files){Assert-KvkProfileReference $file @('.wav','.ogg')}
        }
    }
    $json=ConvertTo-Json -InputObject $Profile -Depth 10 -Compress -ErrorAction Stop
    if([Text.Encoding]::UTF8.GetByteCount($json) -gt 262144){Throw-KvkFailure 'ENGINE_ERROR' 'Profile JSON 超过 256 KiB。' 'The Profile JSON is larger than 256 KiB.'}
}
function ConvertFrom-KvkProfileElement($Element) {
    switch([string]$Element.ValueKind){
        'Object' {
            $map=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
            foreach($property in $Element.EnumerateObject()){
                if($map.ContainsKey($property.Name)){Throw-KvkFailure 'ENGINE_ERROR' 'Profile JSON 含重复字段。' 'The Profile JSON has a duplicate field.'}
                $map.Add($property.Name,(ConvertFrom-KvkProfileElement $property.Value))
            }
            return ,$map
        }
        'Array' {$items=@(foreach($item in $Element.EnumerateArray()){ConvertFrom-KvkProfileElement $item});return ,$items}
        'String' {return $Element.GetString()}
        'Number' {
            $integer=[long]0
            if($Element.TryGetInt64([ref]$integer)){return $integer}
            return $Element.GetDouble()
        }
        'True' {return $true}
        'False' {return $false}
        'Null' {return $null}
        default {Throw-KvkFailure 'ENGINE_ERROR' 'Profile JSON 值无效。' 'A Profile JSON value is not valid.'}
    }
}
function Read-KvkProfileFile([string]$Path,[string]$Id) {
    Assert-KvkProfileSafePath $Path
    if([IO.Directory]::Exists($Path)){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 路径不是文件。' 'The Profile path is not a file.'}
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if($stream.Length -gt 262144){Throw-KvkFailure 'ENGINE_ERROR' 'Profile JSON 超过 256 KiB。' 'The Profile JSON is larger than 256 KiB.'}
        $reader=[IO.StreamReader]::new($stream,[Text.UTF8Encoding]::new($false,$true),$false)
        try{$json=$reader.ReadToEnd()}finally{$reader.Dispose()}
    }finally{$stream.Dispose()}
    $document=$null
    try{
        $document=[Text.Json.JsonDocument]::Parse($json)
        $profile=ConvertFrom-KvkProfileElement $document.RootElement
        Assert-KvkProfile $profile
        Remove-KvkProfileLegacy $profile
        if($profile.id -cne $Id){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 标识与文件名不一致。' 'The Profile id does not match its file name.'}
        return $profile
    }catch{
        if($_.Exception.Data.Contains('KvkCode')){throw}
        Throw-KvkFailure 'ENGINE_ERROR' 'Profile JSON 已损坏或无法读取。' 'The Profile JSON is damaged or could not be read.'
    }finally{if($null -ne $document){$document.Dispose()}}
}
function Assert-KvkProfileSafePath([string]$Path) {
    try{Assert-KvkSafePath $Path}catch{Throw-KvkFailure 'INVALID_PATH' 'Profile 路径不安全，不允许链接或重解析点。' 'The Profile path is not safe; links and reparse points are not allowed.'}
}
function Get-KvkProfileDirectory([string]$LocalDataRoot) {
    try{$directory=Join-Path (Get-KvkDataRoot ([IO.Path]::GetFullPath($LocalDataRoot))) 'profiles'}catch{Throw-KvkFailure 'INVALID_PATH' 'Profile 存储目录无效。' 'The Profile store folder is not valid.'}
    Assert-KvkProfileSafePath $directory
    $ancestor=$directory
    while(-not [string]::IsNullOrEmpty($ancestor)){
        if([IO.File]::Exists($ancestor)){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 存储目录被文件占用。' 'A file is in the way of the Profile store folder.'}
        $ancestor=[IO.Path]::GetDirectoryName($ancestor)
    }
    return $directory
}
function Get-KvkProfilePath([string]$LocalDataRoot,$Id) {
    Assert-KvkProfileId $Id
    $path=Join-Path (Get-KvkProfileDirectory $LocalDataRoot) ($Id+'.json')
    Assert-KvkProfileSafePath $path
    return $path
}
function Get-KvkProfiles([string]$LocalDataRoot) {
    $directory=Get-KvkProfileDirectory $LocalDataRoot
    $profiles=@();$errors=@()
    if([IO.File]::Exists($directory)){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 存储目录被文件占用。' 'A file is in the way of the Profile store folder.'}
    if([IO.Directory]::Exists($directory)){
        foreach($entry in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop | Where-Object {$_.Name.EndsWith('.json',[StringComparison]::OrdinalIgnoreCase)} | Sort-Object Name)){
            try{
                $id=[IO.Path]::GetFileNameWithoutExtension($entry.Name);Assert-KvkProfileId $id
                if($entry.Name -cne ($id+'.json')){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 文件名无效。' 'The Profile file name is not valid.'}
                $profiles+=Read-KvkProfileFile $entry.FullName $id
            }catch{$errors+=@{fileName=$entry.Name;message=$_.Exception.Message;messageEn=(Get-KvkErrorEnglish $_.Exception)}}
        }
    }
    return @{directory=$directory;profiles=@($profiles);errors=@($errors)}
}
function Get-KvkProfile([string]$LocalDataRoot,$Id) {
    $path=Get-KvkProfilePath $LocalDataRoot $Id
    $profile=$null
    if([IO.Directory]::Exists($path)){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 路径不是文件。' 'The Profile path is not a file.'}
    if([IO.File]::Exists($path)){$profile=Read-KvkProfileFile $path $Id}
    return @{filePath=$path;profile=$profile}
}
function Move-KvkProfileAtomic([string]$TemporaryPath,[string]$Path) {
    [IO.File]::Move($TemporaryPath,$Path,$true)
}
function Save-KvkProfile([string]$LocalDataRoot,$Profile) {
    Assert-KvkProfile $Profile
    Remove-KvkProfileLegacy $Profile
    $path=Get-KvkProfilePath $LocalDataRoot $Profile.id
    # An existing malformed document must be explicitly deleted, never silently replaced.
    $null=Get-KvkProfile $LocalDataRoot $Profile.id
    $json=ConvertTo-Json -InputObject $Profile -Depth 10 -Compress -ErrorAction Stop
    $directory=[IO.Path]::GetDirectoryName($path)
    $temporary=Join-Path $directory ('.'+$Profile.id+'.'+[guid]::NewGuid().ToString('N')+'.tmp')
    try{
        New-KvkDirectory $directory
        Assert-KvkProfileSafePath $temporary
        $bytes=[Text.UTF8Encoding]::new($false,$true).GetBytes($json)
        $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
        $validated=Read-KvkProfileFile $temporary $Profile.id
        Assert-KvkProfileSafePath $path
        $null=Get-KvkProfile $LocalDataRoot $Profile.id
        Move-KvkProfileAtomic $temporary $path
        return @{filePath=$path;profile=$validated}
    }catch{
        if($_.Exception.Data.Contains('KvkCode')){throw}
        Throw-KvkFailure 'ENGINE_ERROR' '无法保存 Profile，原有文件已保留。' 'The Profile could not be saved; the existing file is unchanged.'
    }finally{
        if([IO.File]::Exists($temporary)){Assert-KvkProfileSafePath $temporary;[IO.File]::Delete($temporary)}
    }
}
function Remove-KvkProfile([string]$LocalDataRoot,$Id) {
    $path=Get-KvkProfilePath $LocalDataRoot $Id
    if([IO.Directory]::Exists($path)){Throw-KvkFailure 'ENGINE_ERROR' 'Profile 路径不是文件。' 'The Profile path is not a file.'}
    $exists=[IO.File]::Exists($path)
    if($exists){Assert-KvkProfileSafePath $path;[IO.File]::Delete($path)}
    return @{deleted=$exists}
}

# Read-only Profile asset access. No context creation, game state or plan mutation.
function Get-KvkProfileAssetExtensions($Kind) {
    if($Kind -isnot [string] -or $Kind -cnotin @('scheme','enemy','crosshair','audio')){Throw-KvkFailure 'ENGINE_ERROR' '资源类型无效。' 'The asset kind is not valid.'}
    switch -CaseSensitive ($Kind) {'audio' {return @('.wav','.ogg')} 'crosshair' {return @('.png')} default {return @('.json')}}
}
function Get-KvkProfileAssetPath($Path) {
    Assert-KvkProfileText $Path 4096 '资源路径' 'asset path'
    if(-not [IO.Path]::IsPathFullyQualified($Path) -or $Path -match '^[\\/]{2}[?.][\\/]' -or $Path -match '[\x00-\x1f<>"|?*]' -or $Path -match '(?<!^[a-zA-Z]):') {Throw-KvkFailure 'INVALID_PATH' '请选择普通文件的完整路径。' 'Choose the full path of an ordinary file.'}
    foreach($part in ($Path -split '[\\/]')){
        if($part -in @('.','..') -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'){Throw-KvkFailure 'INVALID_PATH' '资源路径含不安全的文件名。' 'The asset path contains an unsafe file name.'}
    }
    $full=[IO.Path]::GetFullPath($Path)
    Assert-KvkProfileSafePath $full
    return $full
}
function Get-KvkProfileAssetInfo($Kind,$Path) {
    $extensions=@(Get-KvkProfileAssetExtensions $Kind)
    $full=Get-KvkProfileAssetPath $Path
    if([IO.Path]::GetExtension($full) -inotin $extensions){Throw-KvkFailure 'INVALID_PATH' '资源扩展名与类型不匹配。' 'The asset extension does not match its kind.'}
    $item=Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if($item -isnot [IO.FileInfo] -or ($item.Attributes -band [IO.FileAttributes]::Device) -ne 0){Throw-KvkFailure 'INVALID_PATH' '资源必须是普通文件。' 'The asset must be an ordinary file.'}
    if($item.Length -le 0 -or $item.Length -gt 8388608){Throw-KvkFailure 'ENGINE_ERROR' '资源文件必须非空且不超过 8 MiB。' 'The asset file must not be empty and must be 8 MiB or smaller.'}
    return $item
}
function Get-KvkProfileAssets($Kind,$Directory) {
    $extensions=@(Get-KvkProfileAssetExtensions $Kind)
    $full=Get-KvkProfileAssetPath $Directory
    if(-not [IO.Directory]::Exists($full)){Throw-KvkFailure 'INVALID_PATH' '资源目录不存在。' 'The asset folder does not exist.'}
    $files=[Collections.Generic.List[object]]::new();$errors=[Collections.Generic.List[object]]::new();$count=0
    foreach($path in [IO.Directory]::EnumerateFileSystemEntries($full)){
        if([IO.Path]::GetExtension($path) -inotin $extensions){continue}
        $count++;if($count -gt 1000){Throw-KvkFailure 'ENGINE_ERROR' '资源目录超过 1000 个候选文件，请选择更小的目录。' 'The asset folder has more than 1000 candidate files. Choose a smaller folder.'}
        $name=[IO.Path]::GetFileName($path)
        try{$item=Get-KvkProfileAssetInfo $Kind $path;$files.Add(@{name=$item.Name;path=$item.FullName})}
        catch{$errors.Add(@{fileName=$name;message=$_.Exception.Message;messageEn=(Get-KvkErrorEnglish $_.Exception)})}
    }
    return @{directory=$full;files=@($files.ToArray() | Sort-Object { $_.name });errors=@($errors.ToArray())}
}
# The guarded read shared by previews and imports: a plain local file of the kind's type,
# at most 8 MiB, with no link in its path, that does not change while it is read.
function Read-KvkProfileAssetBytes($Kind,$Path) {
    $item=Get-KvkProfileAssetInfo $Kind $Path
    $stream=[IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try{
        Assert-KvkProfileSafePath $item.FullName
        $length=$stream.Length
        if($length -le 0 -or $length -gt 8388608){Throw-KvkFailure 'ENGINE_ERROR' '资源文件必须非空且不超过 8 MiB。' 'The asset file must not be empty and must be 8 MiB or smaller.'}
        $bytes=[byte[]]::new([int]$length);$offset=0
        while($offset -lt $bytes.Length){$read=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($read -eq 0){Throw-KvkFailure 'ENGINE_ERROR' '资源文件读取不完整。' 'The asset file could not be read completely.'};$offset+=$read}
        if($stream.ReadByte() -ne -1){Throw-KvkFailure 'ENGINE_ERROR' '资源文件在读取期间发生变化。' 'The asset file changed while it was being read.'}
    }finally{$stream.Dispose()}
    return @{Item=$item;Bytes=$bytes}
}
function Read-KvkProfileAsset($Kind,$Path) {
    $read=Read-KvkProfileAssetBytes $Kind $Path
    $item=$read.Item;$bytes=$read.Bytes
    $mime=switch($item.Extension.ToLowerInvariant()){'.json' {'application/json'} '.png' {'image/png'} '.wav' {'audio/wav'} '.ogg' {'audio/ogg'}}
    return @{path=$item.FullName;mimeType=$mime;base64=[Convert]::ToBase64String($bytes)}
}
