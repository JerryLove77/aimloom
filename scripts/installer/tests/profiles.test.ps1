param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version 3.0
. (Join-Path $PSScriptRoot '../kvk-engine.ps1')
. (Join-Path $PSScriptRoot '../gui/kvk-gui-service.ps1')
function Get-ProfileTestBytes([string]$Path) { return [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) }
function Assert($Condition,[string]$Message) { if(-not $Condition){throw $Message} }
function Request([string]$Op,$ArgsValue) { Invoke-KvkGuiRequest $session @{v=1;requestId='profiles-test';op=$Op;args=$ArgsValue} }
function Info([string]$Path){return @{name=[IO.Path]::GetFileName($Path.Replace('\','/'));path=$Path}}
function Profile([string]$Id='alpha') { return @{schemaVersion=1;id=$Id;name='训练 Profile';scheme=(Info '../方案.JSON');audio=@{kill=@((Info 'C:\sounds\a.WAV'),(Info 'C:\sounds\a.WAV'));spawn=@();mbsGood=@((Info 'good.ogg'));mbsOkay=@();mbsBad=@((Info 'bad.wav'));mbsChangeNow=@((Info 'now.wav'))};crosshair=(Info '\\server\share\a.png');enemy=(Info '../enemy/blue.json')} }
$root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-profiles-'+[guid]::NewGuid().ToString('N'))
if($root.StartsWith('/var/')){$root='/private'+$root}
$session=New-KvkGuiSession $root (Join-Path $root 'local')
function Assert-KvkGameClosed { throw 'Profile storage checked game process' }
function Get-KvkGuiGameState { throw 'Profile storage checked game state' }
$session.Plan=@{sentinel='unchanged'};$plan=$session.Plan
$directory=Join-Path $session.LocalDataRoot 'Aimloom/profiles'
function Assert-Failure($Reply,[string]$Message){Assert (-not $Reply.ok) $Message}
try {
 $list=Request 'profileList' @{};Assert $list.ok 'missing list failed';Assert ($list.data.profiles.Count -eq 0) 'missing list not empty';Assert (-not [IO.Directory]::Exists($directory)) 'read created directory'
 Assert ((Request 'profileRead' @{id='alpha'}).data.profile -eq $null) 'missing read';Assert (-not (Request 'profileDelete' @{id='alpha'}).data.deleted) 'missing delete'
 $null=[IO.Directory]::CreateDirectory($root);$asset=Join-Path $root 'asset.wav';$game=Join-Path $root 'game.json';[IO.File]::WriteAllText($asset,'asset');[IO.File]::WriteAllText($game,'game');$ah=Get-ProfileTestBytes $asset;$gh=Get-ProfileTestBytes $game
 $p=Profile;$p.audio.spawn=@((Info $asset));$p.scheme=Info $game;$saved=Request 'profileSave' @{profile=$p};if(-not $saved.ok){throw ('save failed: '+$saved.error.message)};$path=$saved.data.filePath
 $reopened=(Request 'profileRead' @{id='alpha'}).data.profile
 foreach($event in $p.audio.Keys){
  Assert ($reopened.audio[$event].Count -eq $p.audio[$event].Count) ('event length changed: '+$event)
  for($i=0;$i -lt $p.audio[$event].Count;$i++){Assert ($reopened.audio[$event][$i].path -ceq $p.audio[$event][$i].path -and $reopened.audio[$event][$i].name -ceq $p.audio[$event][$i].name) ('event path changed: '+$event)}
 }
 Assert ($reopened.scheme.path -ceq $p.scheme.path -and $reopened.scheme.name -ceq $p.scheme.name) 'file reference changed: scheme'
 # v0.1.3 removed the crosshair slot and 2026-09-21 removed the enemy slot the same way: a Profile
 # no longer manages the enemy. The request above still carried both, as an older client would;
 # the engine reads past them, and neither returns nor writes either.
 foreach($legacyKey in @('crosshair','enemy')){
  Assert (-not $reopened.ContainsKey($legacyKey)) ('the engine returned a '+$legacyKey+' record')
  Assert (-not ([IO.File]::ReadAllText($path)).Contains($legacyKey)) ('the engine wrote a '+$legacyKey+' record to disk')
 }
 $p.name='changed';Assert (Request 'profileSave' @{profile=$p}).ok 'replace failed'
 $p2=Profile 'beta';$p2.scheme=$null;$p2.audio=$null;$p2.crosshair=$null;$p2.enemy=$null;Assert (Request 'profileSave' @{profile=$p2}).ok 'null profile failed';Assert ((Request 'profileList' @{}).data.profiles.Count -eq 2) 'two profiles missing'
 $dated=Profile 'dated';$dated.name='2026-09-15T10:30:00Z'
 Assert (Request 'profileSave' @{profile=$dated}).ok 'date-looking strings rejected'
 $datedRead=(Request 'profileRead' @{id='dated'}).data.profile;Assert ($datedRead.name -is [string] -and $datedRead.name -ceq $dated.name) 'date-looking strings changed'
 $null=Request 'profileDelete' @{id='dated'}
 $hash=Get-ProfileTestBytes $path
 foreach($id in @('../evil','CON','con','com1','bad.name','A','',"alpha`n",('a'*65))){Assert-Failure (Request 'profileRead' @{id=$id}) ('accepted id '+$id)}
 foreach($mutation in @({param($v)$v.schemaVersion=2},{param($v)$v.name=' '},{param($v)$v.extra=1},{param($v)$v.audio.kill=@('https://host/a.wav')},{param($v)$v.scheme=@{}},{param($v)$v.audio.kill=@('a.wav')*65},{param($v)$v.audio.kill=@(('a'*4092)+'.wav')*64})){ $bad=Profile;& $mutation $bad;Assert-Failure (Request 'profileSave' @{profile=$bad}) 'invalid profile accepted';Assert ((Get-ProfileTestBytes $path) -eq $hash) 'invalid save changed bytes' }
 foreach($reference in @('\\?\C:\audio.wav','\\.\C:\audio.wav','//?/C:/audio.wav','//./C:/audio.wav')){$bad=Profile;$bad.audio.kill=@((Info $reference));Assert-Failure (Request 'profileSave' @{profile=$bad}) 'device namespace accepted'}
 foreach($audioJson in @('[null]','[["a.wav"]]')){
  $raw='{"schemaVersion":1,"id":"alpha","name":"x","scheme":null,"audio":{"kill":'+$audioJson+'},"crosshair":null,"enemy":null}'
  $document=[Text.Json.JsonDocument]::Parse($raw);try{$bad=ConvertFrom-KvkProfileElement $document.RootElement}finally{$document.Dispose()}
  Assert ($bad.audio.kill.Count -eq 1) 'parser lost invalid array entry';Assert-Failure (Request 'profileSave' @{profile=$bad}) 'null/nested audio accepted'
 }
 $bad=Profile;$bad.scheme.document=@{name='embedded'}
 Assert-Failure (Request 'profileSave' @{profile=$bad}) 'embedded settings accepted: scheme'
 # crosshair and enemy are both read past rather than refused (v0.1.3, 2026-09-21), so the thing
 # this loop protects -- settings are never silently STORED inside a Profile -- is checked
 # directly: nothing of either may reach the disk.
 foreach($legacyKey in @('crosshair','enemy')){
  $smuggled=Profile ('smuggle-'+$legacyKey);$smuggled[$legacyKey].document=@{name=('embedded-in-'+$legacyKey)}
  $r=Request 'profileSave' @{profile=$smuggled};if(-not $r.ok){throw ('a Profile with a leftover '+$legacyKey+' was refused: '+$r.error.messageEn)}
  Assert (-not ([IO.File]::ReadAllText($r.data.filePath)).Contains('embedded-in-'+$legacyKey)) ('settings embedded in a '+$legacyKey+' record were written to disk')
  Assert (Request 'profileDelete' @{id=('smuggle-'+$legacyKey)}).data.deleted 'could not remove the probe Profile'
 }
 $bad=Profile;$bad.scheme.sourceCode='code';Assert-Failure (Request 'profileSave' @{profile=$bad}) 'inline metadata accepted in a reference'
 $bad=Profile;$bad.scheme.name='' ;Assert-Failure (Request 'profileSave' @{profile=$bad}) 'empty resource name accepted'
 Assert-Failure (Request 'profileList' @{extra=1}) 'unknown args accepted'
 $corrupt=Join-Path $directory 'broken.json';[IO.File]::WriteAllText($corrupt,'{broken');$ch=Get-ProfileTestBytes $corrupt
 $list=Request 'profileList' @{};Assert ($list.data.profiles.Count -eq 2 -and $list.data.errors.Count -eq 1) 'corrupt list not isolated'
 # Every unreadable file carries an English twin beside its Chinese message.
 foreach($row in $list.data.errors){Assert (-not [string]::IsNullOrWhiteSpace($row.messageEn)) 'Profile error row without English';Assert (-not (Test-KvkCjk $row.messageEn)) 'Profile error English contains CJK'}
 Assert-Failure (Request 'profileRead' @{id='broken'}) 'corrupt read succeeded'
 Assert-Failure (Request 'profileSave' @{profile=(Profile 'broken')}) 'corrupt overwrite accepted';Assert ((Get-ProfileTestBytes $corrupt) -eq $ch) 'corrupt bytes changed'
 [IO.File]::WriteAllText((Join-Path $directory 'mismatch.json'),(ConvertTo-Json -Depth 20 $p));Assert-Failure (Request 'profileRead' @{id='mismatch'}) 'id mismatch accepted'
 $duplicate=Join-Path $directory 'duplicate.json';[IO.File]::WriteAllText($duplicate,'{"schemaVersion":1,"id":"duplicate","id":"duplicate","name":"x","scheme":null,"audio":null,"crosshair":null,"enemy":null}')
 Assert-Failure (Request 'profileRead' @{id='duplicate'}) 'duplicate property accepted'
 $oversized=Join-Path $directory 'oversized.json';[IO.File]::WriteAllText($oversized,(' '*262145));Assert-Failure (Request 'profileRead' @{id='oversized'}) 'oversized file accepted'
 $encoding=Join-Path $directory 'encoding.json';[IO.File]::WriteAllBytes($encoding,[byte[]]@(255,254,255));Assert-Failure (Request 'profileRead' @{id='encoding'}) 'invalid UTF8 accepted'
 # Force the atomic commit seam to fail after the temporary file has been written.
 $commit=(Get-Command Move-KvkProfileAtomic).ScriptBlock
 function Move-KvkProfileAtomic { param($TemporaryPath,$Path) throw 'injected atomic replacement failure' }
 Assert-Failure (Request 'profileSave' @{profile=$p}) 'injected failure succeeded';Assert ((Get-ProfileTestBytes $path) -eq $hash) 'failed commit changed bytes'
 Set-Item Function:Move-KvkProfileAtomic $commit
 Assert ((@(Get-ChildItem -LiteralPath $directory -Force -Filter '*.tmp')).Count -eq 0) 'temporary file leaked'
 $link=Join-Path $directory 'linked.json';$null=New-Item -ItemType SymbolicLink -Path $link -Target $game
 Assert-Failure (Request 'profileRead' @{id='linked'}) 'link read accepted';Assert-Failure (Request 'profileSave' @{profile=(Profile 'linked')}) 'link save accepted';Assert-Failure (Request 'profileDelete' @{id='linked'}) 'link delete accepted'
 $dangling=Join-Path $directory 'dangling.json';$null=New-Item -ItemType SymbolicLink -Path $dangling -Target (Join-Path $root 'missing-target.json')
 Assert-Failure (Request 'profileSave' @{profile=(Profile 'dangling')}) 'dangling link save accepted';Assert-Failure (Request 'profileDelete' @{id='dangling'}) 'dangling link delete accepted'
 $outside=Join-Path $root 'outside';$null=[IO.Directory]::CreateDirectory($outside)
 $linkedLocal=Join-Path $root 'linked-local';$null=New-Item -ItemType SymbolicLink -Path $linkedLocal -Target $outside
 $linkedSession=New-KvkGuiSession $root $linkedLocal
 $linkedReply=Invoke-KvkGuiRequest $linkedSession @{v=1;requestId='linked-root';op='profileSave';args=@{profile=(Profile)}}
 Assert-Failure $linkedReply 'linked ancestor accepted';Assert (-not [IO.Directory]::Exists((Join-Path $outside 'Aimloom')) -and -not [IO.Directory]::Exists((Join-Path $outside 'KovaaKConfigInstaller'))) 'linked ancestor was written'
 Assert (Request 'profileDelete' @{id='broken'}).data.deleted 'corrupt delete failed';Assert (Request 'profileDelete' @{id='alpha'}).data.deleted 'delete failed'
 Assert ((Get-ProfileTestBytes $asset) -eq $ah -and (Get-ProfileTestBytes $game) -eq $gh) 'asset or game changed';Assert ([object]::ReferenceEquals($session.Plan,$plan)) 'session plan changed'
 & {
  $worker=Join-Path $PSScriptRoot '../gui/kvk-gui-worker.ps1';$runtime=Split-Path $PSScriptRoot -Parent
  $wrapper=Join-Path $root 'worker-fixture.ps1';$workerLocal=Join-Path $root 'worker-local'
  $scriptText=". '"+$worker.Replace("'","''")+"'`nStart-KvkGuiWorker -RuntimeRoot '"+$runtime.Replace("'","''")+"' -LocalDataRoot '"+$workerLocal.Replace("'","''")+"'"
  [IO.File]::WriteAllText($wrapper,$scriptText,[Text.UTF8Encoding]::new($true))
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=Join-Path $PSHOME $(if($IsWindows){'pwsh.exe'}else{'pwsh'});$start.UseShellExecute=$false;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  # The worker's pipes are strict UTF-8, as the Rust host writes them. Left unset, .NET uses the console
  # code page, which on a Chinese Windows is GBK and turns 训练 into bytes the worker rightly rejects.
  $utf8=[Text.UTF8Encoding]::new($false);$start.StandardInputEncoding=$utf8;$start.StandardOutputEncoding=$utf8;$start.StandardErrorEncoding=$utf8
  $start.ArgumentList.Add('-NoProfile');$start.ArgumentList.Add('-File');$start.ArgumentList.Add($wrapper)
  $child=[Diagnostics.Process]::Start($start)
  try{
   $child.StandardInput.WriteLine((ConvertTo-Json -Depth 20 -Compress @{v=1;requestId='worker-save';op='profileSave';args=@{profile=$dated}}))
   $child.StandardInput.WriteLine((ConvertTo-Json -Depth 20 -Compress @{v=1;requestId='worker-read';op='profileRead';args=@{id='dated'}}));$child.StandardInput.Close()
   $output=$child.StandardOutput.ReadToEndAsync();$errorOutput=$child.StandardError.ReadToEndAsync()
   if(-not $child.WaitForExit(15000)){$child.Kill();throw 'Profile worker timeout'}
   $lines=@($output.GetAwaiter().GetResult() -split '\r?\n' | Where-Object {$_})
   Assert ($child.ExitCode -eq 0 -and $lines.Count -eq 2) ('Profile worker failed: '+$errorOutput.GetAwaiter().GetResult())
   foreach($line in $lines){$document=[Text.Json.JsonDocument]::Parse($line);try{$reply=ConvertFrom-KvkProfileElement $document.RootElement}finally{$document.Dispose()};Assert $reply.ok 'worker reply failed';Assert ($reply.data.profile.name -ceq $dated.name) 'worker changed literal strings';Assert ($reply.data.profile.scheme.path -ceq $dated.scheme.path -and $reply.data.profile.scheme.name -ceq $dated.scheme.name -and $reply.data.profile.audio.mbsGood[0].path -ceq $dated.audio.mbsGood[0].path -and $reply.data.profile.audio.mbsOkay.Count -eq 0 -and $reply.data.profile.audio.mbsChangeNow[0].path -ceq $dated.audio.mbsChangeNow[0].path) 'worker changed component references';Assert ($reply.data.profile.audio.kill.Count -eq 2 -and $reply.data.profile.audio.kill[0].path -ceq $dated.audio.kill[0].path -and $reply.data.profile.audio.kill[1].path -ceq $dated.audio.kill[1].path) 'worker changed ordered audio array'}
  }finally{if(-not $child.HasExited){$child.Kill()};$child.Dispose()}
 }
 # The Profile that TypeScript REALLY saves. profile.saved.fixture.json is pinned to the serialiser by
 # saved-shape.test.ts and to Rust by profiles.rs; this is the engine's third. Earlier branches removed
 # crosshair, then enemy, from what TypeScript writes while Rust and this engine still required one or
 # the other, so every save on Windows would have failed -- and every suite passed, because each layer's
 # fixtures were hand-written.
 $fixturePath=Join-Path $PSScriptRoot '../../../packages/app/tests/installer/profiles/profile.saved.fixture.json'
 $fromTypeScript=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($fixturePath)) -AsHashtable
 Assert (-not $fromTypeScript.ContainsKey('crosshair') -and -not $fromTypeScript.ContainsKey('enemy')) 'the fixture must be what TypeScript writes today'
 $r=Request 'profileSave' @{profile=$fromTypeScript};if(-not $r.ok){throw ('the Profile the App saves was refused: '+$r.error.messageEn)}
 Assert ((Request 'profileRead' @{id=$fromTypeScript.id}).data.profile.name -ceq $fromTypeScript.name) 'the App-saved Profile did not read back'
 # A file written before 2026-09-21 still carries a crosshair and/or an enemy record; each must
 # keep opening, including one whose record is junk.
 foreach($legacy in @(@{id='legacy-good';crosshair=@{name='dot.png';path='C:/x/dot.png'};enemy=@{name='blue.json';path='C:/x/blue.json'}},@{id='legacy-junk';crosshair='not a reference';enemy=42})){
  $doc=@{schemaVersion=1;id=$legacy.id;name='from v0.1.2';scheme=$null;audio=$null;crosshair=$legacy.crosshair;enemy=$legacy.enemy}
  [IO.File]::WriteAllText((Join-Path $directory ($legacy.id+'.json')),(ConvertTo-Json -InputObject $doc -Depth 10 -Compress),[Text.UTF8Encoding]::new($false))
  $read=Request 'profileRead' @{id=$legacy.id};if(-not $read.ok){throw ('a legacy Profile no longer opens ('+$legacy.id+'): '+$read.error.messageEn)}
  Assert (-not $read.data.profile.ContainsKey('crosshair') -and -not $read.data.profile.ContainsKey('enemy')) ('a legacy crosshair or enemy record was returned: '+$legacy.id)
 }
 # profile.legacy.fixture.json carries both legacy slots with real values; it must keep opening
 # here too, with both dropped, the same way saved-shape.test.ts and profiles.rs check it.
 $legacyFixturePath=Join-Path $PSScriptRoot '../../../packages/app/tests/installer/profiles/profile.legacy.fixture.json'
 $legacyFromTypeScript=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($legacyFixturePath)) -AsHashtable
 Assert ($legacyFromTypeScript.ContainsKey('crosshair') -and $null -ne $legacyFromTypeScript.crosshair -and $legacyFromTypeScript.ContainsKey('enemy') -and $null -ne $legacyFromTypeScript.enemy) 'the legacy fixture must actually carry both legacy slots'
 $legacySaved=Request 'profileSave' @{profile=$legacyFromTypeScript};if(-not $legacySaved.ok){throw ('the legacy fixture was refused: '+$legacySaved.error.messageEn)}
 Assert (-not $legacySaved.data.profile.ContainsKey('crosshair') -and -not $legacySaved.data.profile.ContainsKey('enemy')) 'the legacy fixture kept a legacy slot after save'
 Write-Host 'PASS Profile validation, storage, corruption, atomic failure, links, game isolation and GUI routes'
} finally {if([IO.Directory]::Exists($root)){Remove-Item -LiteralPath $root -Recurse -Force}}
