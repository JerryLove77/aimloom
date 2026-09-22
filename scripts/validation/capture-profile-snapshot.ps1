#Requires -Version 7.0
param(
 [string]$GameRoot = 'D:\SteamLibrary\steamapps\common\FPSAimTrainer',
 [string]$OutputRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AimloomProfileValidation'),
 [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$')][string]$Label,
 [string]$CompareTo,
 [string]$Scenario = 'not-recorded',
 [ValidateRange(1,16777216)][int]$MaxFileBytes = 4194304
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FullPath([string]$Path) {
 $full=[IO.Path]::GetFullPath($Path)
 if($full -eq [IO.Path]::GetPathRoot($full)){return $full}
 return $full.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
}
function Test-Within([string]$Path, [string]$Parent) {
 $prefix=$Parent.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
 return $Path.Equals($Parent,[StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
}
function Get-PathIdentity([string]$Path) {
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){return $Path}
 if(-not ('AimloomSnapshot.NativePath' -as [type])){
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
namespace AimloomSnapshot {
 public static class NativePath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
  private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
  private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder name, uint length, uint flags);
  public static string Resolve(string path) {
   // Metadata-only OPEN_EXISTING; NT volume identity also resolves SUBST aliases.
   using(var handle=CreateFileW(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
    if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
    var name=new StringBuilder(32768);
    uint length=GetFinalPathNameByHandleW(handle,name,(uint)name.Capacity,2);
    if(length==0) throw new Win32Exception(Marshal.GetLastWin32Error());
    if(length>=name.Capacity) throw new IOException("Resolved path is too long");
    return name.ToString();
   }
  }
 }
}
'@
 }
 $cursor=$Path;$suffix=[Collections.Generic.List[string]]::new()
 while(-not [IO.Directory]::Exists($cursor) -and -not [IO.File]::Exists($cursor)){
  $parent=[IO.Directory]::GetParent($cursor)
  if($null -eq $parent){throw "无法确认路径的真实位置：$Path"}
  $suffix.Insert(0,[IO.Path]::GetFileName($cursor));$cursor=$parent.FullName
 }
 $identity=[AimloomSnapshot.NativePath]::Resolve($cursor).TrimEnd('\')
 foreach($part in $suffix){$identity+='\'+$part}
 return $identity
}
function Assert-NoLinks([string]$Path) {
 $cursor = [IO.Path]::GetFullPath($Path)
 while ($cursor) {
  try {
   $attributes = [IO.File]::GetAttributes($cursor)
   if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "不支持链接或联接路径：$cursor" }
  } catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
  $parent = [IO.Directory]::GetParent($cursor)
  $cursor = if ($null -eq $parent) { $null } else { $parent.FullName }
 }
}
function Get-Hash([byte[]]$Bytes) {
 $sha = [Security.Cryptography.SHA256]::Create()
 try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant() }
 finally { $sha.Dispose() }
}
function Read-Bounded([string]$Path) {
 Assert-NoLinks $Path
 $stream = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
 $reader = [IO.BinaryReader]::new($stream)
 try {
  $bytes = $reader.ReadBytes($MaxFileBytes+1)
  if ($bytes.Length -gt $MaxFileBytes) { throw "文件超过采集大小上限：$Path" }
  return ,$bytes
 } finally { $reader.Dispose() }
}
function Get-EncodingName([byte[]]$Bytes) {
 if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 239 -and $Bytes[1] -eq 187 -and $Bytes[2] -eq 191) { return 'utf-8-bom' }
 if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 255 -and $Bytes[1] -eq 254) { return 'utf-16le' }
 if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 254 -and $Bytes[1] -eq 255) { return 'utf-16be' }
 return 'utf-8'
}
function Decode-Text([byte[]]$Bytes, [string]$EncodingName) {
 switch ($EncodingName) {
  'utf-16le' { return [Text.UnicodeEncoding]::new($false,$false,$true).GetString($Bytes,2,$Bytes.Length-2) }
  'utf-16be' { return [Text.UnicodeEncoding]::new($true,$false,$true).GetString($Bytes,2,$Bytes.Length-2) }
  'utf-8-bom' { return [Text.UTF8Encoding]::new($false,$true).GetString($Bytes,3,$Bytes.Length-3) }
  default { return [Text.UTF8Encoding]::new($false,$true).GetString($Bytes) }
 }
}
function Canonical-Value($Value) {
 if ($Value -is [Collections.IDictionary]) {
  $ordered = [Collections.Specialized.OrderedDictionary]::new([StringComparer]::Ordinal)
  $keys = [string[]]@($Value.Keys); [Array]::Sort($keys,[StringComparer]::Ordinal)
  foreach ($key in $keys) { $ordered[$key] = Canonical-Value $Value[$key] }
  return $ordered
 }
 if ($Value -is [array]) {
  $items = [Collections.Generic.List[object]]::new()
  foreach ($item in $Value) { $items.Add((Canonical-Value $item)) }
  return ,$items.ToArray()
 }
 return $Value
}
function Escape-Key([string]$Value) { return $Value.Replace('~','~0').Replace('/','~1') }
function Read-Fields([string]$RelativePath, [string]$Text) {
 $fields = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
 $pattern = '(?i)Theme|Enemy|Crosshair|Sound|Floor|Wall|Ceiling|Sky|Sun|Fog|Material|FullBright|Metallic|Metalic|Roughness|Glow'
 if ($RelativePath.EndsWith('.json',[StringComparison]::OrdinalIgnoreCase)) {
  $document = ConvertFrom-Json -InputObject $Text -AsHashtable -ErrorAction Stop
  if ($document -isnot [Collections.IDictionary]) { throw 'JSON 根节点不是对象' }
  if ($RelativePath.StartsWith('Themes/',[StringComparison]::Ordinal)) {
   foreach ($key in $document.Keys) {
    if ($key -match $pattern) { $fields[(Escape-Key $RelativePath)+'/'+(Escape-Key $key)] = ConvertTo-Json -InputObject (Canonical-Value $document[$key]) -Depth 64 -Compress }
   }
  } else {
   foreach ($group in $document.Keys) {
    if ($document[$group] -isnot [Collections.IDictionary]) { continue }
    foreach ($key in $document[$group].Keys) {
     if ($key -match $pattern) { $fields[(Escape-Key $RelativePath)+'/'+(Escape-Key $group)+'/'+(Escape-Key $key)] = ConvertTo-Json -InputObject (Canonical-Value $document[$group][$key]) -Depth 64 -Compress }
    }
   }
  }
 } else {
  $section = ''; $counts = @{}
  foreach ($line in ($Text -split '\r?\n')) {
   if ($line -match '^\s*\[([^\]]+)\]\s*$') { $section=$Matches[1]; continue }
   if ($line -match '^\s*([^#;][^=]*?)\s*=(.*)$') {
    $key=$Matches[1].Trim(); $value=$Matches[2]
    if ($key -notmatch $pattern) { continue }
    $base=(Escape-Key $RelativePath)+'/'+(Escape-Key $section)+'/'+(Escape-Key $key)
    if (-not $counts.ContainsKey($base)) { $counts[$base]=0 }
    $counts[$base]++
    $fields[$base+'/'+$counts[$base]] = ConvertTo-Json -InputObject $value -Compress
   }
  }
 }
 return $fields
}
function Get-SourceNames([string]$SaveRoot) {
 $names = [Collections.Generic.List[string]]::new()
 foreach ($name in @('PrimaryUserSettings.json','weaponsettings.ini','UI.json')) { $names.Add($name) }
 $themes = Join-Path $SaveRoot 'Themes'; Assert-NoLinks $themes
 if ([IO.Directory]::Exists($themes)) {
  foreach ($file in [IO.Directory]::EnumerateFiles($themes,'*.json',[IO.SearchOption]::TopDirectoryOnly)) {
   $names.Add('Themes/'+[IO.Path]::GetFileName($file))
   if ($names.Count -gt 512) { throw '采集文件数量超过 512 个，请停止采集并报告此结果' }
  }
 }
 return @($names | Sort-Object)
}

$GameRoot = Get-FullPath $GameRoot
$OutputRoot = Get-FullPath $OutputRoot
Assert-NoLinks $GameRoot; Assert-NoLinks $OutputRoot
$gameIdentity=Get-PathIdentity $GameRoot;$outputIdentity=Get-PathIdentity $OutputRoot
if ((Test-Within $outputIdentity $gameIdentity) -or (Test-Within $gameIdentity $outputIdentity)) { throw '证据目录必须与游戏目录分离，不能互相包含' }
$saveRoot = Join-Path $GameRoot 'FPSAimTrainer/Saved/SaveGames'
Assert-NoLinks $saveRoot
if (-not [IO.File]::Exists((Join-Path $saveRoot 'PrimaryUserSettings.json'))) { throw '找不到 PrimaryUserSettings.json，请确认游戏路径并先通过游戏生成配置' }
$previous = $null
if ($CompareTo) {
 $CompareTo = Get-FullPath $CompareTo
 if (-not (Test-Within $CompareTo $OutputRoot) -or [IO.Path]::GetFileName($CompareTo) -cne 'snapshot.json') { throw '比较基线必须是证据目录中的 snapshot.json' }
 $oldBytes = Read-Bounded $CompareTo
 $previous = ConvertFrom-Json -InputObject (Decode-Text $oldBytes (Get-EncodingName $oldBytes)) -AsHashtable
 if ($previous.version -ne 1 -or -not ([string]$previous.gameRoot).Equals($GameRoot,[StringComparison]::OrdinalIgnoreCase) -or -not $previous.ContainsKey('files') -or -not $previous.ContainsKey('fields')) { throw '比较基线版本或游戏路径不匹配' }
}

$startedAt = [datetime]::UtcNow.ToString('o')
$names = @(Get-SourceNames $saveRoot)
$raw = [Collections.Generic.Dictionary[string,byte[]]]::new([StringComparer]::Ordinal)
$fields = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
$records = @(); $warnings = @(); $totalBytes = 0L
foreach ($name in $names) {
 $path = Join-Path $saveRoot $name; Assert-NoLinks $path
 $entry = [ordered]@{relativePath=$name;exists=$false;sha256=$null;bytes=0;encoding=$null;parseStatus='missing'}
 if ([IO.File]::Exists($path)) {
  $bytes = Read-Bounded $path
  $totalBytes += $bytes.Length
  if ($totalBytes -gt 67108864) { throw '采集总量超过 64 MiB' }
  $raw[$name]=$bytes; $entry.exists=$true; $entry.sha256=Get-Hash $bytes; $entry.bytes=$bytes.Length; $entry.encoding=Get-EncodingName $bytes
  try {
   $parsed = Read-Fields $name (Decode-Text $bytes $entry.encoding)
   foreach ($key in $parsed.Keys) { $fields[$key]=$parsed[$key] }
   $entry.parseStatus='parsed'
  } catch { $entry.parseStatus='error'; $warnings += "$name 无法解析，仅保留原始字节与哈希：$($_.Exception.Message)" }
 }
 $records += [pscustomobject]$entry
}
# A second inventory and bounded read detects observed changes during capture.
if ((@(Get-SourceNames $saveRoot) -join "`n") -cne ($names -join "`n")) { throw '采集期间文件列表发生变化，请等待游戏保存结束后重试' }
foreach ($entry in $records) {
 $path=Join-Path $saveRoot $entry.relativePath; Assert-NoLinks $path
 $nowHash=if ([IO.File]::Exists($path)) { Get-Hash (Read-Bounded $path) } else { $null }
 if ($nowHash -cne $entry.sha256) { throw "采集期间文件发生变化，请重试：$($entry.relativePath)" }
}
$gameState='unknown';$processes=@()
try {
 $processes=@(Get-Process -ErrorAction Stop | Where-Object ProcessName -in @('FPSAimTrainer','FPSAimTrainer-Win64-Shipping') | Select-Object Id,ProcessName,SessionId)
 $gameState=if ($processes.Count -eq 0) {'closed'} else {'running'}
} catch { $warnings += '无法确认游戏进程状态，状态记为 unknown' }

$comparison=$null
if ($null -ne $previous) {
 $changedFiles=@();$changedFields=@();$complete=$true
 $oldFiles=@{};foreach($entry in $previous.files){$oldFiles[$entry.relativePath]=$entry}
 $newFiles=@{};foreach($entry in $records){$newFiles[$entry.relativePath]=$entry}
 $allNames=@(@($oldFiles.Keys)+@($newFiles.Keys)|Sort-Object -Unique)
 foreach($name in $allNames){
  $old=$oldFiles[$name];$new=$newFiles[$name]
  $oldHash=if($null -eq $old){$null}else{$old.sha256};$newHash=if($null -eq $new){$null}else{$new.sha256}
  if($oldHash -cne $newHash){$changedFiles += [pscustomobject]@{relativePath=$name;beforeHash=$oldHash;afterHash=$newHash}}
  if(($null -ne $old -and $old.parseStatus -eq 'error') -or ($null -ne $new -and $new.parseStatus -eq 'error')){$complete=$false}
 }
 if($complete){
  foreach($key in @(@($previous.fields.Keys)+@($fields.Keys)|Sort-Object -CaseSensitive -Unique)){
   $had=$previous.fields.ContainsKey($key);$has=$fields.ContainsKey($key)
   $before=if($had){$previous.fields[$key]}else{$null};$after=if($has){$fields[$key]}else{$null}
   if($had -ne $has -or $before -cne $after){$changedFields += [pscustomobject]@{path=$key;beforePresent=$had;afterPresent=$has;before=$before;after=$after}}
  }
 }
 $comparison=[ordered]@{baseline=$CompareTo;changedFiles=@($changedFiles);changedFields=@($changedFields);fieldComparisonComplete=$complete}
}

Assert-NoLinks $OutputRoot
if ((Get-PathIdentity $OutputRoot) -cne $outputIdentity -or (Get-PathIdentity $GameRoot) -cne $gameIdentity) { throw '采集期间目录位置发生变化，请重试' }
$id=[datetime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'-'+$Label+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$staging=Join-Path $OutputRoot ('.incomplete-'+$id);$destination=Join-Path $OutputRoot $id
$null=[IO.Directory]::CreateDirectory($staging)
foreach($name in $raw.Keys){
 $target=Join-Path (Join-Path $staging 'raw') $name
 $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
 [IO.File]::WriteAllBytes($target,$raw[$name])
}
$snapshot=[ordered]@{
 version=1;label=$Label;scenario=$Scenario;startedAt=$startedAt;capturedAt=[datetime]::UtcNow.ToString('o')
 gameRoot=$GameRoot;gameState=$gameState;processes=@($processes);powerShell=$PSVersionTable.PSVersion.ToString()
 captureMethod='two-pass-paths-and-hashes';scriptSha256=(Get-Hash ([IO.File]::ReadAllBytes($PSCommandPath)))
 files=@($records);fields=$fields;warnings=@($warnings);comparison=$comparison
}
$json=ConvertTo-Json -InputObject $snapshot -Depth 64
[IO.File]::WriteAllText((Join-Path $staging 'snapshot.json'),$json,[Text.UTF8Encoding]::new($false))
[IO.Directory]::Move($staging,$destination)
$snapshotPath=Join-Path $destination 'snapshot.json'
Write-Host "已保存只读快照：$snapshotPath"
Write-Host "游戏状态：$gameState；文件记录：$($records.Count)；解析警告：$($warnings.Count)"
if($null -ne $comparison){Write-Host "变化文件：$($comparison.changedFiles.Count)；变化字段：$($comparison.changedFields.Count)；字段比较完整：$($comparison.fieldComparisonComplete)"}
[pscustomobject]@{snapshotPath=$snapshotPath;gameState=$gameState;warningCount=$warnings.Count}
