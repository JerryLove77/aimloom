param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$engine = Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-engine.ps1'
if (-not (Test-Path -LiteralPath $engine)) { throw 'MISSING FEATURE: transaction engine does not exist' }
. $engine
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Fixture([string]$Path, [string]$Text) { $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)); [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false))) }
function Expect-Throw([scriptblock]$Action, [string]$Message) { $threw = $false; try { $null = & $Action } catch { $threw = $true }; Assert $threw $Message }
# Expect-Throw only proves a throw. This one also checks the wording the player will read.
function Expect-ThrowLike([scriptblock]$Action, [string]$Pattern) { $text = $null; try { $null = & $Action } catch { $text = $_.Exception.Message }; Assert ($null -ne $text) "Expected a refusal matching $Pattern"; Assert ($text -match $Pattern) "Wrong refusal wording: $text" }
# Expect-Throw proves a refusal happened; this proves WHICH one. A plain `throw` carries no code
# and reaches the GUI as `unknown`, so a refusal that must be actionable is asserted by its code.
function Expect-ThrowCode([scriptblock]$Action, [string]$Code, [string]$Message) { $seen = $null; $threw = $false; try { $null = & $Action } catch { $threw = $true; $seen = $_.Exception.Data['KvkCode'] }; Assert $threw $Message; Assert ($seen -ceq $Code) "$Message -- expected code $Code, got '$seen'" }
$script:Tests = 0
function Test-Case([string]$Name, [scriptblock]$Body) {
 if ($CaseFilter -and $Name -notlike ('*'+$CaseFilter+'*')) { return }
 $script:Root = Join-Path ([IO.Path]::GetTempPath()) ('kvk-engine-' + [Guid]::NewGuid().ToString('N'))
 if ($script:Root.StartsWith('/var/')) { $script:Root = '/private' + $script:Root }
 $script:Game = Join-Path $Root 'Game with spaces'
 $script:Data = Join-Path $Game 'FPSAimTrainer'
 $script:Pack = Join-Path $Root '素材 pack'
 $script:Local = Join-Path $Root 'local'
 Write-Fixture (Join-Path $Data 'Saved/SaveGames/PrimaryUserSettings.json') '{"sensitivity":0.91}'
 Write-Fixture (Join-Path $Data 'Saved/SaveGames/UI.json') '{"original":true}'
 Write-Fixture (Join-Path $Local 'FPSAimTrainer/Saved/Config/WindowsNoEditor/Palette.ini') 'old palette'
 $null = [IO.Directory]::CreateDirectory((Join-Path $Data 'sounds'))
 Write-Fixture (Join-Path $Pack 'sounds/音效 space.wav') 'new sound'
 Write-Fixture (Join-Path $Pack 'Themes/theme.json') '{"themeName":"Internal identity"}'
 Write-Fixture (Join-Path $Pack 'crosshairs/cross.png') 'new cross'
 Write-Fixture (Join-Path $Pack 'PrimaryUserSettings.json') '{"sensitivity":4}'
 Write-Fixture (Join-Path $Pack 'UI.json') '{"new":true}'
 Write-Fixture (Join-Path $Pack 'Palette.ini') 'new palette'
 $script:Target = Join-Path $Data 'sounds/音效 space.wav'
 $script:Ctx = New-KvkContext -GameRoot $Game -LocalDataRoot $Local
 try { & $Body; $script:Tests++; Write-Host ('PASS ' + $Name) } finally { Remove-Item -LiteralPath $Root -Recurse -Force }
}
Test-Case 'manifest timestamps preserve instants across regional date formats' {
 $culture=[Globalization.CultureInfo]::CurrentCulture
 try {
  $record=New-KvkRecord 'sounds/tone.wav' (Join-Path $Data 'sounds/tone.wav') $null ('a'*64)
  $manifest=New-KvkManifest $Ctx 'install' ([Guid]::NewGuid().ToString('N')) @($record) $Pack @('sounds') $null
  $samples=@(
   @{Text='2026-09-13T12:34:56.1234567Z';Utc='2026-09-13T12:34:56.1234567Z'},
   @{Text='2026-02-03T12:34:56.0000000Z';Utc='2026-02-03T12:34:56.0000000Z'},
   @{Text='2026-09-13T20:34:56.0000000+08:00';Utc='2026-09-13T12:34:56.0000000Z'},
   @{Text='2026-09-13 12:34:56Z';Utc='2026-09-13T12:34:56.0000000Z'}
  )
  foreach ($sample in $samples) {
   $manifest.CreatedAt=$sample.Text;Save-KvkManifest $Ctx $manifest
   $manifestPath=Get-KvkManifestPath $Ctx $manifest.Id;$beforeHash=Get-KvkHash $manifestPath
   foreach ($name in @('zh-Hans-HK','en-GB','en-US','zh-CN')) {
    [Globalization.CultureInfo]::CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($name)
    $read=Read-KvkManifest $Ctx $manifest.Id
    $instant=([datetimeoffset]$read.CreatedAt).UtcDateTime.ToString('o',[Globalization.CultureInfo]::InvariantCulture)
    Assert ($instant -ceq $sample.Utc) ("Timestamp changed under $name : $($sample.Text) became $instant")
    Assert ((Get-KvkHash $manifestPath) -ceq $beforeHash) 'Reading a timestamp rewrote the backup manifest'
   }
  }
 } finally {[Globalization.CultureInfo]::CurrentCulture=$culture}
}
Test-Case 'manifest timestamps reject invalid values without permitting game writes' {
 $culture=[Globalization.CultureInfo]::CurrentCulture
 try {
  $record=New-KvkRecord 'sounds/tone.wav' (Join-Path $Data 'sounds/tone.wav') $null ('a'*64)
  $manifest=New-KvkManifest $Ctx 'install' ([Guid]::NewGuid().ToString('N')) @($record) $Pack @('sounds') $null
  $invalids=@(
   @{Label='empty';Value=''},@{Label='null';Value=$null},
   @{Label='invalid date';Value='not-a-date'},@{Label='impossible date';Value='2026-02-30T12:34:56Z'},
   @{Label='number';Value=2026},@{Label='boolean';Value=$true},
   @{Label='array';Value=@('2026-09-13T12:34:56Z')},@{Label='object';Value=@{date='2026-09-13'}}
  )
  $settingsPath=Join-Path $Data 'Saved/SaveGames/PrimaryUserSettings.json';$beforeHash=Get-KvkHash $settingsPath
  foreach ($name in @('zh-Hans-HK','en-US')) {
   [Globalization.CultureInfo]::CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($name)
   foreach ($invalid in $invalids) {
    $manifest.CreatedAt=$invalid.Value;Save-KvkManifest $Ctx $manifest
    $message=$null
    try {$null=Read-KvkManifest $Ctx $manifest.Id} catch {$message=$_.Exception.Message}
    Assert ($message -ceq 'Invalid manifest timestamp.') ("Invalid timestamp accepted: $name / $($invalid.Label)")
    Expect-Throw {Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))} 'Invalid timestamp permitted installation'
    Assert (-not [IO.File]::Exists($Target)) 'Invalid timestamp caused a game asset write'
    Assert ((Get-KvkHash $settingsPath) -ceq $beforeHash) 'Invalid timestamp changed game settings'
   }
  }
 } finally {[Globalization.CultureInfo]::CurrentCulture=$culture}
}
Test-Case 'default assets preserve settings bytes and timestamps; restore owned additions' {
 $settings = @((Join-Path $Data 'Saved/SaveGames/PrimaryUserSettings.json'), (Join-Path $Data 'Saved/SaveGames/UI.json'), (Join-Path $Local 'FPSAimTrainer/Saved/Config/WindowsNoEditor/Palette.ini'))
 $before = @($settings | ForEach-Object { [IO.File]::ReadAllText($_) }); $times = @($settings | ForEach-Object { [IO.File]::GetLastWriteTimeUtc($_) })
 $plan = New-KvkPlan $Ctx $Pack @('themes','sounds','crosshairs')
 $r = Invoke-KvkInstall $Ctx $plan
 Assert ($r.Status -eq 'completed') ('install failed: ' + ($r.Errors -join ';'))
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'source bytes not copied'
 for ($i=0;$i -lt $settings.Count;$i++) { Assert ([IO.File]::ReadAllText($settings[$i]) -ceq $before[$i]) 'settings changed'; Assert ([IO.File]::GetLastWriteTimeUtc($settings[$i]) -eq $times[$i]) 'settings timestamp changed' }
 $nochange = Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('themes','sounds','crosshairs'))
 Assert ($nochange.Status -eq 'no-change') 'identical reinstall created batch'
 $rr = Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $r.Id)
 Assert ($rr.Status -eq 'restored') ('restore failed: ' + ($rr.Errors -join ';'))
 Assert (-not [IO.File]::Exists($Target)) 'owned addition remains'
}
Test-Case 'second undo and immutable expanding pristine snapshots' {
 Write-Fixture $Target 'first original'
 $one = Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 Write-Fixture (Join-Path $Pack 'sounds/音效 space.wav') 'second version'
 $two = Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds','ui'))
 Assert ($two.Status -eq 'completed') 'second install failed'
 $rr = Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $two.Id)
 Assert ($rr.Status -eq 'restored') 'second undo failed'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'second undo lost first installed bytes'
 Assert ([IO.File]::ReadAllText((Join-Path $Data 'Saved/SaveGames/UI.json')) -ceq '{"original":true}') 'ui before bytes lost'
 $rr = Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx 'pristine')
 Assert ($rr.Status -eq 'restored') 'pristine restore failed'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'first original') 'first-touch snapshot overwritten'
}
Test-Case 'preview changes reject all writes' {
 Write-Fixture $Target 'original'
 $p = New-KvkPlan $Ctx $Pack @('sounds')
 Write-Fixture $Target 'external'
 Expect-Throw { Invoke-KvkInstall $Ctx $p } 'stale target accepted'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'external') 'external bytes overwritten'
 $p = New-KvkPlan $Ctx $Pack @('sounds')
 Write-Fixture (Join-Path $Pack 'sounds/音效 space.wav') 'changed source'
 Expect-Throw { Invoke-KvkInstall $Ctx $p } 'stale source accepted'
}
Test-Case 'edited addition conflicts; explicit consent preserves bytes' {
 $r = Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 Write-Fixture $Target 'user edited sound'
 $p = New-KvkRestorePlan $Ctx $r.Id
 Assert ($p.Conflicts.Count -eq 1) 'edit not detected'
 Expect-Throw { Invoke-KvkRestore $Ctx $p } 'conflict overwritten without consent'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'user edited sound') 'conflicted bytes changed'
 $rr = Invoke-KvkRestore $Ctx $p -AllowConflicts
 Assert ($rr.Status -eq 'restored') 'consented restore failed'
 Assert (-not [IO.File]::Exists($Target)) 'addition not removed'
 $saved = @(Get-ChildItem -LiteralPath $Ctx.BackupRoot -Recurse -File | Where-Object { $_.Extension -eq '.bin' } | Where-Object { [IO.File]::ReadAllText($_.FullName) -ceq 'user edited sound' })
 Assert ($saved.Count -ge 1) 'conflict bytes not preserved'
}
Test-Case 'invalid selected JSON aborts preflight' {
 foreach ($invalid in @('[]','[{}]','[{},{}]','null','true','1','"text"','{broken')) {
  Write-Fixture (Join-Path $Pack 'Themes/theme.json') $invalid
  Expect-Throw { New-KvkPlan $Ctx $Pack @('themes','sounds') } ('Invalid JSON root accepted: ' + $invalid)
 }
 Assert (-not [IO.File]::Exists($Target)) 'invalid pack wrote target'
}
Test-Case 'corrupt backup blocks full restore' {
 Write-Fixture $Target 'original'
 $r = Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds','crosshairs'))
 $f = Get-ChildItem -LiteralPath (Join-Path (Join-Path $Ctx.BackupRoot $r.Id) 'files') -Recurse -File | Where-Object { $_.Extension -eq '.bin' } | Select-Object -First 1
 Write-Fixture $f.FullName 'damaged'
 Expect-Throw { New-KvkRestorePlan $Ctx $r.Id } 'damaged backup accepted'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'restore partially wrote before validation'
}
Test-Case 'game detection failure blocks writes; mid-install game start requires recovery' {
 $script:RealGuard = ${function:Assert-KvkGameClosed}
 try {
  function Assert-KvkGameClosed { throw 'simulated process enumeration error' }
  Expect-Throw { Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds')) } 'process failure allowed writes'
  Assert (-not [IO.File]::Exists($Target)) 'process failure wrote files'
  $script:GuardCalls=0
  function Assert-KvkGameClosed { $script:GuardCalls++; if ($script:GuardCalls -ge 4) { throw 'simulated game started' } }
  $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds','crosshairs'))
  Assert ($r.Status -eq 'recovery-required') 'game start not recorded as incomplete'
 } finally { Set-Item Function:Assert-KvkGameClosed $script:RealGuard }
 Expect-ThrowCode { Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds')) } 'RECOVERY_REQUIRED' 'pending recovery did not block install'
 $rr=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $r.Id)
 Assert ($rr.Status -eq 'restored') 'pending installation not recoverable'
 Assert (-not [IO.File]::Exists($Target)) 'unfinished addition remains'
}
Test-Case 'interrupted restore retries through restore batch Id' {
 Write-Fixture $Target 'original'
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds','crosshairs'))
 $p=New-KvkRestorePlan $Ctx $r.Id
 $script:RealGuard=${function:Assert-KvkGameClosed};$script:GuardCalls=0
 try {
  function Assert-KvkGameClosed { $script:GuardCalls++; if ($script:GuardCalls -ge 4) {throw 'simulated game started during restore'} }
  $rr=Invoke-KvkRestore $Ctx $p
  Assert ($rr.Status -eq 'recovery-required') 'interrupted restore not recorded'
 } finally { Set-Item Function:Assert-KvkGameClosed $script:RealGuard }
 $retry=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $rr.Id)
 Assert ($retry.Status -eq 'restored') 'restore retry failed'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'original') 'restore retry lost original'
 Assert (-not [IO.File]::Exists((Join-Path $Data 'crosshairs/cross.png'))) 'restore retry left addition'
}
Test-Case 'crash after rename is recoverable from durable intent' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $m=Read-KvkManifest $Ctx $r.Id;$m.Status='applying';$m.Items[0].State='writing'
 Save-KvkManifest $Ctx $m
 $rr=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $r.Id)
 Assert ($rr.Status -eq 'restored') 'crash after rename could not recover'
 Assert (-not [IO.File]::Exists($Target)) 'crash-owned addition remains'
}
Test-Case 'failed exclusive create never claims unrelated matching bytes' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $m=Read-KvkManifest $Ctx $r.Id;$m.Status='applying';$m.Items[0].State='writing'
 Write-Fixture $m.Items[0].TempPath 'new sound';Save-KvkManifest $Ctx $m
 $p=New-KvkRestorePlan $Ctx $r.Id
 Expect-ThrowCode { Invoke-KvkRestore $Ctx $p -AllowConflicts } 'UNOWNED_FILE' 'unowned matching file deleted'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'unowned bytes lost'
}
Test-Case 'backup failure happens before any target writes' {
 $script:RealCopy=${function:Copy-KvkSnapshot}
 try {
  function Copy-KvkSnapshot { param($Source,$Destination,$ExpectedHash);throw 'simulated backup disk failure' }
  Expect-Throw { Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds','crosshairs')) } 'backup failure ignored'
 } finally {Set-Item Function:Copy-KvkSnapshot $script:RealCopy}
 Assert (-not [IO.File]::Exists($Target)) 'backup failure partially installed'
 Assert (@(Get-KvkBackupList $Ctx).Count -eq 0) 'unpublished staging treated as installation'
}
Test-Case 'malformed manifest target fails closed' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $m=Read-KvkManifest $Ctx $r.Id;$m.Items[0].Target=Join-Path $Root 'unrelated.wav';Save-KvkManifest $Ctx $m
 Expect-Throw { New-KvkRestorePlan $Ctx $r.Id } 'outside target accepted'
 Expect-Throw { Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('crosshairs')) } 'corrupt manifest ignored during install'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'corrupt manifest caused writes'
}
Test-Case 'shared Palette lock blocks a second instance' {
 $locks=Enter-KvkLock $Ctx
 try {Expect-ThrowCode { Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds')) } 'BUSY' 'concurrent write accepted'} finally {Exit-KvkLock $locks}
 Assert (-not [IO.File]::Exists($Target)) 'locked install wrote target'
}
Test-Case 'restore preview freezes externally modified bytes' {
 Write-Fixture $Target 'original';$r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $p=New-KvkRestorePlan $Ctx $r.Id;Write-Fixture $Target 'external after preview'
 Expect-Throw {Invoke-KvkRestore $Ctx $p -AllowConflicts} 'restore stale preview accepted'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'external after preview') 'restore overwrote changed preview'
}
Test-Case 'deleted Primary can be restored using validated backup identity' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('primary'))
 $primary=Join-Path $Data 'Saved/SaveGames/PrimaryUserSettings.json'
 [IO.File]::Delete($primary)
 $recovered=New-KvkContext $Game $Local
 $p=New-KvkRestorePlan $recovered $r.Id
 $rr=Invoke-KvkRestore $recovered $p -AllowConflicts
 Assert ($rr.Status -eq 'restored') 'missing Primary recovery failed'
 Assert ([IO.File]::ReadAllText($primary) -ceq '{"sensitivity":0.91}') 'missing Primary not restored'
}
Test-Case 'write failure rolls back the complete batch without losing existing bytes' {
 Write-Fixture $Target 'original before failure'
 $script:RealChange=${function:Invoke-KvkFileChange};$script:ChangeCalls=0
 try {
  function Invoke-KvkFileChange { param($Context,$Manifest,$Item,$Source);$script:ChangeCalls++;if($script:ChangeCalls -eq 2){throw 'simulated target I/O failure'};& $script:RealChange $Context $Manifest $Item $Source }
  $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('crosshairs','sounds'))
  Assert ($r.Status -eq 'rolled-back') ('failed batch was not rolled back: '+($r.Errors -join ';'))
  Assert (@($r.ErrorsEn).Count -eq @($r.Errors).Count -and @($r.Errors).Count -gt 0) 'every error line needs its English twin'
  Assert ($r.ErrorsEn[0] -ceq 'simulated target I/O failure') 'an English error line is its own English'
 } finally {Set-Item Function:Invoke-KvkFileChange $script:RealChange}
 Assert ([IO.File]::ReadAllText($Target) -ceq 'original before failure') 'existing file lost during rollback'
 Assert (-not [IO.File]::Exists((Join-Path $Data 'crosshairs/cross.png'))) 'added file survived rollback'
}
Test-Case 'UTF16 BOM and UTF8 bytes remain exact on install and restore' {
 $old=[byte[]](255,254,123,0,125,0)
 $source=Join-Path $Pack 'Themes/.json'
 $new=[byte[]](239,187,191,123,34,116,104,101,109,101,78,97,109,101,34,58,34,34,125)
 $dest=Join-Path $Data 'Saved/SaveGames/Themes/.json'
 $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest));[IO.File]::WriteAllBytes($dest,$old);[IO.File]::WriteAllBytes($source,$new)
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('themes'))
 Assert ($r.Status -eq 'completed') 'encoded theme install failed'
 Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($dest)) -ceq '77u/eyJ0aGVtZU5hbWUiOiIifQ==') 'theme was reserialized'
 $rr=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $r.Id)
 Assert ($rr.Status -eq 'restored') 'encoded theme restore failed'
 Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($dest)) -ceq '//57AH0A') 'UTF16 original changed'
}
Test-Case 'linked source directory is rejected without writing outside scope' {
 $sounds=Join-Path $Pack 'sounds';$outside=Join-Path $Root 'outside sounds'
 [IO.Directory]::Move($sounds,$outside)
 $kind='SymbolicLink';if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){$kind='Junction'}
 $null=New-Item -ItemType $kind -Path $sounds -Target $outside -ErrorAction Stop
 try {Expect-Throw { New-KvkPlan $Ctx $Pack @('sounds') } 'linked pack accepted'} finally {
  # Remove the link itself; never recurse into its destination on Windows PowerShell 5.1.
  if($kind -eq 'Junction'){[IO.Directory]::Delete($sounds)}else{[IO.File]::Delete($sounds)}
 }
 Assert (-not [IO.File]::Exists($Target)) 'linked source wrote target'
}
Test-Case 'missing manifest is not treated as an empty backup directory' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 [IO.File]::Delete((Join-Path (Join-Path $Ctx.BackupRoot $r.Id) 'manifest.json'))
 Expect-Throw {Get-KvkBackupList $Ctx} 'missing manifest silently omitted'
 Expect-Throw {Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('crosshairs'))} 'incomplete backup allowed another install'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'incomplete manifest changed target'
}
Test-Case 'interruption publishing first-touch protection leaves recoverable backup history' {
 Write-Fixture $Target 'original before pristine'
 $script:RealJson=${function:Write-KvkAtomicJson}
 try {
  function Write-KvkAtomicJson { param($Path,$Value);if($Value.Id -eq 'pristine'){throw 'simulated first-touch publication failure'};& $script:RealJson $Path $Value }
  $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
  Assert ($r.Status -eq 'rolled-back') 'initial pristine failure did not roll back'
 } finally {Set-Item Function:Write-KvkAtomicJson $script:RealJson}
 Assert ([IO.File]::ReadAllText($Target) -ceq 'original before pristine') 'failed pristine publication changed original'
 $backups=@(Get-KvkBackupList $Ctx)
 Assert ($backups.Count -eq 1) 'first-touch interruption poisoned backup listing'
 $retry=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 Assert ($retry.Status -eq 'completed') 'first-touch publication cannot be retried'
 $rr=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx 'pristine')
 Assert ($rr.Status -eq 'restored') 'retried first-touch state cannot restore'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'original before pristine') 'retry lost original bytes'
}
Test-Case 'case aliases of the same Windows installation can access its backup' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $alias=$Game.ToUpperInvariant();$localAlias=$Local.ToUpperInvariant()
 if([IO.Directory]::Exists($alias) -and [IO.Directory]::Exists($localAlias)) {
  $other=New-KvkContext $alias $localAlias
  $rr=Invoke-KvkRestore $other (New-KvkRestorePlan $other $r.Id)
  Assert ($rr.Status -eq 'restored') 'same installation with different casing rejected'
  Assert (-not [IO.File]::Exists($Target)) 'case alias restore did not restore original'
 } else {Write-Host '  Case-sensitive host: alias branch unavailable.'}
}
Test-Case 'interrupted pristine expansion can retry after an untouched file changes' {
 Write-Fixture $Target 'first original'
 $first=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $script:RealJson=${function:Write-KvkAtomicJson}
 try {
  function Write-KvkAtomicJson { param($Path,$Value);if($Value.Id -eq 'pristine'){throw 'simulated index append failure'};& $script:RealJson $Path $Value }
  $failed=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('ui'))
  Assert ($failed.Status -eq 'rolled-back') 'pristine append failure not rolled back'
 } finally {Set-Item Function:Write-KvkAtomicJson $script:RealJson}
 $ui=Join-Path $Data 'Saved/SaveGames/UI.json';Write-Fixture $ui '{"editedBeforeFirstTouch":true}'
 $retry=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('ui'))
 Assert ($retry.Status -eq 'completed') 'unpublished original snapshot blocked retry'
 $rr=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx 'pristine')
 Assert ($rr.Status -eq 'restored') 'expanded pristine not restorable'
 Assert ([IO.File]::ReadAllText($ui) -ceq '{"editedBeforeFirstTouch":true}') 'unpublished snapshot was treated as first touch'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'first original') 'expansion rewrote earlier immutable snapshot'
}
Test-Case 'incomplete install receipt with absent installed hash is rejected' {
 $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
 $m=Read-KvkManifest $Ctx $r.Id;$m.Items[0].AfterHash=$null;Save-KvkManifest $Ctx $m
 Expect-Throw {New-KvkRestorePlan $Ctx $r.Id} 'incomplete install receipt accepted'
 Assert ([IO.File]::ReadAllText($Target) -ceq 'new sound') 'incomplete receipt changed target'
}
Test-Case 'manifest timestamp survives culture changes and rejects invalid values' {
 $originalCulture=[Threading.Thread]::CurrentThread.CurrentCulture
 try {
  foreach($culture in @('zh-Hans-HK','en-GB','en-US')) {
   [Threading.Thread]::CurrentThread.CurrentCulture=[cultureinfo]::GetCultureInfo($culture)
   $r=Invoke-KvkInstall $Ctx (New-KvkPlan $Ctx $Pack @('sounds'))
   Assert ($r.Status -eq 'completed') ('install failed in '+$culture)
   $m=Read-KvkManifest $Ctx $r.Id
   $m.CreatedAt='2026-09-13T17:00:00.0000000Z';Save-KvkManifest $Ctx $m
   $null=Read-KvkManifest $Ctx $r.Id
   $rr=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $r.Id)
   Assert ($rr.Status -eq 'restored') ('restore failed in '+$culture)
   foreach($bad in @('not-a-date',42,$null)) {
    $m.CreatedAt=$bad;Save-KvkManifest $Ctx $m
    Expect-Throw {Read-KvkManifest $Ctx $r.Id} 'invalid timestamp accepted'
   }
   $m.CreatedAt='2026-09-13T17:00:00.0000000Z';Save-KvkManifest $Ctx $m
  }
 } finally {[Threading.Thread]::CurrentThread.CurrentCulture=$originalCulture}
}
Test-Case 'exporting a file refuses to overwrite, refuses the game tree, and writes verifiable bytes' {
 $out=Join-Path $script:Root 'exports'
 $null=[IO.Directory]::CreateDirectory($out)
 $bytes=[byte[]](1,2,3,4,5)
 $written=Export-KvkFile $out 'shot.png' $bytes $Ctx.GameRoot
 Assert ($written.Path -ceq (Join-Path $out 'shot.png')) 'Export path is wrong'
 Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($written.Path)) -ceq [Convert]::ToBase64String($bytes)) 'Export wrote different bytes'
 Assert ($written.Sha256 -ceq (Get-KvkHash $written.Path)) 'Reported hash does not match the file'
 # Never overwrite an existing file.
 Expect-ThrowLike {Export-KvkFile $out 'shot.png' $bytes $Ctx.GameRoot} '已经有'
 Assert ((Get-KvkHash $written.Path) -ceq $written.Sha256) 'A refused export changed the file'
 # The game tree is off limits: game writes belong to the engine's plan/backup path.
 Expect-ThrowLike {Export-KvkFile (Join-Path $Ctx.GameRoot 'FPSAimTrainer/crosshairs') 'sneak.png' $bytes $Ctx.GameRoot} '游戏目录'
 foreach($bad in @('..','a/b','a\b','con','trailing.',' leading','')) {
  Expect-ThrowLike {Export-KvkFile $out ($bad+'.png') $bytes $Ctx.GameRoot} '无效'
 }
 Expect-ThrowLike {Export-KvkFile $out 'empty.png' ([byte[]]::new(0)) $Ctx.GameRoot} '大小'
 Expect-ThrowLike {Export-KvkFile $out 'huge.png' ([byte[]]::new(2MB+1)) $Ctx.GameRoot} '大小'
 Expect-ThrowLike {Export-KvkFile (Join-Path $script:Root 'missing-dir') 'shot.png' $bytes $Ctx.GameRoot} '文件夹不存在'
}
Test-Case 'the English-safe parity table matches Rust and the App' {
 # ROADMAP I18N-NAMES. "English-safe" means: no CJK outside double-quoted spans. A span is
 # "…" (ASCII double quotes, no nesting); an odd number of quotes leaves the unclosed tail
 # OUTSIDE, so a broken message cannot smuggle an untranslated sentence through.
 # The same ten cases, in the same order and with the same verdicts, are asserted in
 # packages/app/src-tauri/src/installer/protocol.rs (english_parity_table) and in
 # packages/app/tests/installer/i18n/english-text.test.ts. Changing one row means all three.
 $table=@(
  @{Name='plain English';Text='The source file was not found.';English=$true},
  @{Name='Chinese sentence';Text='找不到来源文件。';English=$false},
  @{Name='English with a quoted Chinese name';Text='The Themes folder already has "中文主题.json".';English=$true},
  @{Name='quoted Chinese plus Chinese outside';Text='The Themes folder already has "中文主题.json"，请换一个文件名。';English=$false},
  @{Name='unbalanced quote';Text='The Themes folder already has "中文主题.json';English=$false},
  @{Name='empty';Text='   ';English=$false},
  @{Name='full-width punctuation outside quotes';Text='The source file was not found！';English=$false},
  @{Name='only quotes';Text='""';English=$true},
  @{Name='a closed span then an unclosed one';Text='a "中" b "中';English=$false},
  @{Name='a newline inside a span';Text=('"中' + [char]10 + '文" ok');English=$true}
 )
 $fixed='The engine reported an error. Details are in worker.log; send a report from Settings, or write to feedback@aimloom.dev.'
 foreach ($row in $table) {
  Assert ((Test-KvkEnglishSafe $row.Text) -eq $row.English) ("Parity row '" + $row.Name + "' disagrees: " + $row.Text)
  # Get-KvkEnglishText must follow the same verdict for a candidate English text.
  $chosen=Get-KvkEnglishText '引擎失败。' $row.Text
  if ($row.English) { Assert ($chosen -ceq $row.Text) ("Row '" + $row.Name + "' should have been kept: " + $chosen) }
  else { Assert ($chosen -ceq $fixed) ("Row '" + $row.Name + "' should have fallen back: " + $chosen) }
 }
 # Test-KvkCjk stays the raw character test the quoting rule is built on.
 Assert (Test-KvkCjk 'The Themes folder already has "中文主题.json".') 'Test-KvkCjk must still see CJK inside quotes'
 Assert (-not (Test-KvkCjk 'plain English')) 'Test-KvkCjk must not see CJK in plain English'
}
Test-Case 'a message with no English reaches worker.log, and only from the worker' {
 # The fixed line promises "Details are in worker.log" and names the way out; Rust copies the worker's stderr there.
 # The console wizard shares the engine but writes to a terminal, so it stays quiet.
 $message='只有中文，没有英文。'
 $original=[Console]::Error
 $capture=[IO.StringWriter]::new()
 try {
  [Console]::SetError($capture)
  Remove-Variable -Name KvkStderrDetails -Scope Global -ErrorAction SilentlyContinue
  $quiet=Get-KvkEnglishText $message
  $afterQuiet=$capture.ToString()
  $global:KvkStderrDetails=$true
  $loud=Get-KvkEnglishText $message
  $afterLoud=$capture.ToString()
 } finally {
  [Console]::SetError($original)
  Remove-Variable -Name KvkStderrDetails -Scope Global -ErrorAction SilentlyContinue
 }
 $fixed='The engine reported an error. Details are in worker.log; send a report from Settings, or write to feedback@aimloom.dev.'
 Assert ($quiet -ceq $fixed) "Without English the fixed line must be returned: $quiet"
 Assert ($loud -ceq $fixed) 'Logging must not change the reply'
 Assert ($afterQuiet -eq '') "The console wizard must not write diagnostics to its terminal: $afterQuiet"
 Assert ($afterLoud.Contains($message)) "The original message must reach the worker log: $afterLoud"
}
# Steam is the only authority on where its libraries are. The two shapes the engine used to
# guess miss an ordinary install: on the tester's own PC Steam sits in C:\Users\<name>\steam,
# so the default library inside it is invisible to both guesses.
Test-Case 'Steam libraries come from libraryfolders.vdf, the one holding the game first' {
 $steam = Join-Path $script:Root 'steam'
 Write-Fixture (Join-Path $steam 'steamapps/libraryfolders.vdf') @'
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Users\\Tester\\steam"
		"apps"
		{
			"228980"		"157818239"
		}
	}
	"1"
	{
		"path"		"D:\\游戏库"
		"apps"
		{
			"431960"		"826275581"
			"824270"		"7415859777"
		}
	}
}
'@
 $libraries = @(Get-KvkSteamLibraries $steam)
 Assert ($libraries.Count -eq 2) "Expected both libraries, got $($libraries.Count)"
 Assert ($libraries[0] -ceq 'D:\游戏库') "The library holding 824270 comes first, and a non-ASCII path survives: $($libraries[0])"
 Assert ($libraries[1] -ceq 'C:\Users\Tester\steam') "Doubled backslashes must be unescaped: $($libraries[1])"
}
Test-Case 'A missing, empty or unparsable Steam root yields no libraries instead of throwing' {
 Assert (@(Get-KvkSteamLibraries (Join-Path $script:Root 'not-steam')).Count -eq 0) 'A missing libraryfolders.vdf must yield nothing'
 Assert (@(Get-KvkSteamLibraries '').Count -eq 0) 'An empty Steam root must yield nothing'
 Write-Fixture (Join-Path $script:Root 'broken/steamapps/libraryfolders.vdf') 'not a vdf at all'
 Assert (@(Get-KvkSteamLibraries (Join-Path $script:Root 'broken')).Count -eq 0) 'An unparsable file must yield nothing'
}
# A library path out of a vdf is never trusted on its own: Get-KvkGameRoot still has to find
# PrimaryUserSettings.json and sounds/ under it, so a junk entry can only fail to match.
Test-Case 'A Steam library only becomes a candidate when the game is really inside it' {
 $steam = Join-Path $script:Root 'steam2'
 $lib = Join-Path $script:Root 'library'
 $escaped = $lib -replace '\\','\\'
 Write-Fixture (Join-Path $steam 'steamapps/libraryfolders.vdf') ("`"libraryfolders`"`n{`n`t`"0`"`n`t{`n`t`t`"path`"`t`t`"$escaped`"`n`t`t`"apps`"`n`t`t{`n`t`t`t`"824270`"`t`t`"1`"`n`t`t}`n`t}`n}`n")
 $libraries = @(Get-KvkSteamLibraries $steam)
 Assert ($libraries.Count -eq 1) 'The library must be listed'
 $game = Join-Path $libraries[0] 'steamapps/common/FPSAimTrainer'
 Expect-Throw { Get-KvkGameRoot $game } 'An empty library folder must not validate as a game directory'
 Write-Fixture (Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json') '{"sensitivity":1}'
 $null = [IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/sounds'))
 Assert ((Get-KvkGameRoot $game) -eq (Get-KvkFullPath $game)) 'A real install under a vdf library must validate'
}
Write-Host ('PASS all ' + $script:Tests + ' engine fixtures')
