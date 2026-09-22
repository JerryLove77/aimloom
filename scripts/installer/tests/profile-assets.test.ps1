param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../kvk-engine.ps1')
. (Join-Path $PSScriptRoot '../gui/kvk-gui-service.ps1')
function Assert($condition,$message){if(-not $condition){throw $message}}
$root=Join-Path ([IO.Path]::GetTempPath()) ('profile-assets-'+[guid]::NewGuid().ToString('N'))
if($root.StartsWith('/var/')){$root='/private'+$root}
$null=[IO.Directory]::CreateDirectory($root)
$session=New-KvkGuiSession $root (Join-Path $root 'local')
$session.Plan=@{sentinel=1};$plan=$session.Plan
function Request($op,$a){Invoke-KvkGuiRequest $session @{v=1;requestId='assets';op=$op;args=$a}}
try{
 $path=Join-Path $root '中文.JSON';[IO.File]::WriteAllText($path,'{"hello":true}')
 $before=[IO.File]::ReadAllText($path)
 $game=Join-Path $root 'game.ini';[IO.File]::WriteAllText($game,'game sentinel')
 $list=Request 'profileAssetList' @{kind='scheme';directory=$root}
 Assert $list.ok 'list must succeed';Assert ($list.data.files.Count -eq 1) 'one asset';Assert ($list.data.files[0].path -ceq $path) 'full path'
 $read=Request 'profileAssetRead' @{kind='enemy';path=$path};Assert $read.ok 'read must succeed'
 Assert ($read.data.mimeType -ceq 'application/json') 'mime';Assert ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($read.data.base64)) -ceq $before) 'exact bytes'
 foreach($bad in @(@{kind='wrong';path=$path},@{kind='audio';path=$path},@{kind='enemy';path=$path;extra=1},@{kind='enemy';path='relative.json'},@{kind='enemy';path=($root+'/../bad.json')})){Assert (-not (Request 'profileAssetRead' $bad).ok) 'unsafe request accepted'}
 $empty=Join-Path $root 'empty.json';[IO.File]::WriteAllBytes($empty,[byte[]]@());Assert (-not (Request 'profileAssetRead' @{kind='enemy';path=$empty}).ok) 'empty accepted'
 $large=Join-Path $root 'large.json';$s=[IO.File]::Create($large);$s.SetLength(8388609);$s.Dispose();Assert (-not (Request 'profileAssetRead' @{kind='enemy';path=$large}).ok) 'oversize accepted'
 $nested=Join-Path $root 'nested';$null=[IO.Directory]::CreateDirectory($nested);[IO.File]::WriteAllText((Join-Path $nested 'nested.json'),'{}')
 $link=Join-Path $root 'link.json';$null=New-Item -ItemType SymbolicLink -Path $link -Target $path
 Assert (-not (Request 'profileAssetRead' @{kind='enemy';path=$link}).ok) 'link accepted'
 $dirLink=Join-Path $root 'linked';$null=New-Item -ItemType SymbolicLink -Path $dirLink -Target $nested
 Assert (-not (Request 'profileAssetRead' @{kind='enemy';path=(Join-Path $dirLink 'nested.json')}).ok) 'ancestor link accepted'
 $list=Request 'profileAssetList' @{kind='enemy';directory=$root};Assert ($list.ok -and $list.data.files.Count -eq 1 -and $list.data.errors.Count -eq 3) 'per-file errors/nonrecursive'
 # Every per-file error carries an English twin, so an English player never reads the Chinese one.
 foreach($row in $list.data.errors){Assert (-not [string]::IsNullOrWhiteSpace($row.messageEn)) 'asset error row without English';Assert (-not (Test-KvkCjk $row.messageEn)) 'asset error English contains CJK'}
 $missing=Join-Path $root 'missing';Assert (-not (Request 'profileAssetList' @{kind='audio';directory=$missing}).ok) 'missing accepted';Assert (-not [IO.Directory]::Exists($missing)) 'created missing'
 Assert ([object]::ReferenceEquals($plan,$session.Plan)) 'plan changed';Assert ([IO.File]::ReadAllText($path) -ceq $before) 'asset changed'
 for($i=0;$i -lt 1001;$i++){[IO.File]::WriteAllText((Join-Path $nested "$i.json"),'{}')}
 Assert (-not (Request 'profileAssetList' @{kind='enemy';directory=$nested}).ok) 'directory silently truncated'
 Assert ([IO.File]::ReadAllText($game) -ceq 'game sentinel') 'game file changed'
 foreach($case in @(@('crosshair','image/png','a.png'),@('audio','audio/wav','a.wav'),@('audio','audio/ogg','a.ogg'))){
  $p=Join-Path $root $case[2];[IO.File]::WriteAllBytes($p,[byte[]]@(1,2,3));$r=Request 'profileAssetRead' @{kind=$case[0];path=$p};Assert ($r.ok -and $r.data.mimeType -ceq $case[1] -and $r.data.base64 -ceq 'AQID') 'binary mime/bytes'
 }
 $s=[IO.File]::OpenWrite($large);$s.SetLength(8388608);$s.Dispose();Assert (Request 'profileAssetRead' @{kind='enemy';path=$large}).ok '8 MiB boundary rejected'
 'Profile asset tests passed'
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
