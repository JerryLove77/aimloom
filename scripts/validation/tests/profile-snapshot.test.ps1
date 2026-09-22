param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$capture = Join-Path (Split-Path $PSScriptRoot -Parent) 'capture-profile-snapshot.ps1'
if (-not (Test-Path -LiteralPath $capture)) { throw 'MISSING FEATURE: read-only Profile snapshot script' }
$root = Join-Path ([IO.Path]::GetTempPath()) ('profile-snapshot-test-' + [guid]::NewGuid().ToString('N'))
$game = Join-Path $root 'Game with spaces'
$save = Join-Path $game 'FPSAimTrainer/Saved/SaveGames'
$output = Join-Path $root 'evidence'
$null = [IO.Directory]::CreateDirectory((Join-Path $save 'Themes'))
$primary = Join-Path $save 'PrimaryUserSettings.json'
$weapon = Join-Path $save 'weaponsettings.ini'
$theme = Join-Path $save 'Themes/theme.json'
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
function Reject([scriptblock]$action, [string]$message) {
 $failed = $false
 try { $null = & $action } catch { $failed = $true }
 Assert $failed $message
}
function Save-Primary([string]$name, [double]$red) {
 $json = '{"stringSettings":{"EStringSettingId::CurrentThemeName":"' + $name + '"},"floatSettings":{"Sensitivity":0.91},"colorSettings":{"EnemyColor":{"R":' + $red.ToString([Globalization.CultureInfo]::InvariantCulture) + ',"G":0,"B":0}}}'
 [IO.File]::WriteAllText($primary, $json, [Text.UnicodeEncoding]::new($false, $true))
}
try {
 Save-Primary 'theme-a' 1
 [IO.File]::WriteAllText($weapon, "ShootSound=first;first;second`r`n", [Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText($theme, '{"themeName":"theme-a","EnemyColor":{"R":1,"G":0,"B":0}}')
 $sourceHash = (Get-FileHash -LiteralPath $primary).Hash
 $first = & $capture -GameRoot $game -OutputRoot $output -Label 'baseline' -Scenario 'fixture'
 $a = Get-Content -LiteralPath $first.snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
 Assert ($a.version -eq 1 -and $a.files.Count -eq 4) 'Baseline omitted required file records'
 Assert ($a.scriptSha256 -ceq (Get-FileHash -LiteralPath $capture).Hash.ToLowerInvariant()) 'Snapshot did not identify its capture script version'
 $p = @($a.files | Where-Object relativePath -eq 'PrimaryUserSettings.json')[0]
 Assert ($p.encoding -eq 'utf-16le' -and $p.parseStatus -eq 'parsed') 'UTF16 input was not recognized'
 Assert ((Get-FileHash -LiteralPath (Join-Path (Split-Path $first.snapshotPath -Parent) 'raw/PrimaryUserSettings.json')).Hash -eq $sourceHash) 'Raw copy changed the original bytes'
 Assert ((Get-FileHash -LiteralPath $primary).Hash -eq $sourceHash) 'Capture changed game settings'
 Assert (-not ($a.fields.Keys -match 'Sensitivity')) 'Unrelated personal field exposed in field summary'
 Assert (($a.fields.Values -contains '"first;first;second"')) 'Sound ordering or duplicates were lost'
 Assert ($a.gameState -in @('closed','running','unknown')) 'Process observation has no truthful state'
 Write-Host 'PASS stable capture preserves bytes, encoding, ordered sound values and field scope'

 Save-Primary 'theme-b' 0.5
 $second = & $capture -GameRoot $game -OutputRoot $output -Label 'changed' -CompareTo $first.snapshotPath
 $b = Get-Content -LiteralPath $second.snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
 Assert ($b.comparison.changedFiles.Count -eq 1) 'Incorrect changed-file count'
 Assert ($b.comparison.changedFields.Count -eq 2) 'Theme and enemy changes were not both identified'
 Assert ($b.comparison.changedFields[0].ContainsKey('before') -and $b.comparison.changedFields[0].ContainsKey('after')) 'Field comparison lost before/after values'
 Assert ((Get-FileHash -LiteralPath (Join-Path (Split-Path $first.snapshotPath -Parent) 'raw/PrimaryUserSettings.json')).Hash -eq $sourceHash) 'Second snapshot overwrote the baseline'
 Write-Host 'PASS comparison identifies theme and enemy changes without overwriting baseline'

 $third = & $capture -GameRoot $game -OutputRoot $output -Label 'unchanged' -CompareTo $second.snapshotPath
 $c = Get-Content -LiteralPath $third.snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
 Assert ($c.comparison.changedFiles.Count -eq 0 -and $c.comparison.changedFields.Count -eq 0) 'Unchanged capture reported changes'
 Write-Host 'PASS unchanged state reports no file or field changes'

 $reordered=[IO.File]::ReadAllText($primary).Replace('"R":0.5,"G":0,"B":0','"B":0,"G":0,"R":0.5')
 [IO.File]::WriteAllText($primary,$reordered,[Text.UnicodeEncoding]::new($false,$true))
 $ordered=& $capture -GameRoot $game -OutputRoot $output -Label 'reordered' -CompareTo $third.snapshotPath
 $e=Get-Content -LiteralPath $ordered.snapshotPath -Raw -Encoding utf8|ConvertFrom-Json -AsHashtable
 Assert ($e.comparison.changedFiles.Count -eq 1 -and $e.comparison.changedFields.Count -eq 0) 'JSON property order was mistaken for a field-value change'
 Write-Host 'PASS object property reordering changes raw bytes without false field changes'

 Reject { & $capture -GameRoot $game -OutputRoot (Join-Path $game 'evidence') -Label 'bad' } 'Output inside game accepted'
 Reject { & $capture -GameRoot $game -OutputRoot $output -Label '../escape' } 'Unsafe label accepted'
 Reject { & $capture -GameRoot $game -OutputRoot $output -Label 'bad-baseline' -CompareTo $primary } 'Non-evidence comparison file accepted'
 Assert (-not (Test-Path -LiteralPath (Join-Path $game 'evidence'))) 'Rejected output created a game directory'
 Write-Host 'PASS output containment, labels and baseline validation fail closed'

 [IO.File]::WriteAllText($primary, '{broken json')
 $broken = & $capture -GameRoot $game -OutputRoot $output -Label 'malformed' -CompareTo $second.snapshotPath
 $d = Get-Content -LiteralPath $broken.snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
 Assert (@($d.files | Where-Object parseStatus -eq 'error').Count -eq 1) 'Malformed JSON was reported as parsed'
 Assert (-not $d.comparison.fieldComparisonComplete) 'Malformed JSON allowed a complete semantic comparison'
 Assert ($d.comparison.changedFields.Count -eq 0) 'Parse failure falsely reported removed fields'
 Write-Host 'PASS malformed input retains raw evidence and marks field comparison incomplete'

 Remove-Item -LiteralPath $primary
 Reject { & $capture -GameRoot $game -OutputRoot $output -Label 'missing' } 'Missing Primary settings accepted as complete baseline'
 Save-Primary 'theme-a' 1
 Reject { & $capture -GameRoot $game -OutputRoot $output -Label 'oversized' -MaxFileBytes 8 } 'Size limit not enforced'
 Write-Host 'PASS missing required file and oversized input are rejected'

 $locked=[IO.File]::Open($primary,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try { Reject { & $capture -GameRoot $game -OutputRoot $output -Label 'locked' } 'Unreadable settings accepted as a stable capture' }
 finally { $locked.Dispose() }
 Write-Host 'PASS locked source fails instead of publishing an incomplete snapshot'

 if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
  $link = Join-Path $root 'linked-output'
  $null = New-Item -ItemType Junction -Path $link -Target $game
  try { Reject { & $capture -GameRoot $game -OutputRoot $link -Label 'junction' } 'Linked output into game accepted' }
  finally { [IO.Directory]::Delete($link) }
  Write-Host 'PASS junction output is rejected'

  $fso=New-Object -ComObject Scripting.FileSystemObject
  $folder=$fso.GetFolder($game)
  try { $shortGame=$folder.ShortPath }
  finally { $null=[Runtime.InteropServices.Marshal]::ReleaseComObject($folder);$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($fso) }
  Assert (-not $shortGame.Equals($game,[StringComparison]::OrdinalIgnoreCase)) 'Short-path alias unavailable; this containment case has not been verified'
  Reject { & $capture -GameRoot $game -OutputRoot (Join-Path $shortGame 'alias-evidence') -Label 'alias' } 'Short-path alias bypassed game containment'
  Assert (-not (Test-Path -LiteralPath (Join-Path $game 'alias-evidence'))) 'Alias rejection wrote inside game'
  Write-Host 'PASS equivalent short-path output cannot bypass game containment'

  $usedDrives=@([IO.DriveInfo]::GetDrives()|ForEach-Object{$_.Name.Substring(0,1)})
  $snapshotDriveLetter=@('Z','Y','X','W','V','U','T'|Where-Object{$_ -notin $usedDrives})[0]
  Assert ($null -ne $snapshotDriveLetter) 'No free drive letter for isolated alias test'
  $snapshotDriveName=$snapshotDriveLetter+':'
  & subst.exe $snapshotDriveName $game
  Assert ($LASTEXITCODE -eq 0) 'Could not create temporary drive alias'
  try { Reject { & $capture -GameRoot $game -OutputRoot ($snapshotDriveName+'\drive-evidence') -Label 'drive-alias' } 'Drive alias bypassed game containment' }
  finally { & subst.exe $snapshotDriveName /D }
  Assert (-not (Test-Path -LiteralPath (Join-Path $game 'drive-evidence'))) 'Drive alias rejection wrote inside game'
  Write-Host 'PASS temporary drive alias cannot bypass game containment'
 }
 Write-Host 'PASS all 11 snapshot validation groups on Windows'
} finally {
 if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
