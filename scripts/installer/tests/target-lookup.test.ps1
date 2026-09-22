#Requires -Version 7.0
$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-engine.ps1')
$temp=[IO.Path]::GetTempPath();if($temp.StartsWith('/var/')){$temp='/private'+$temp}
$root=Join-Path $temp ('kvk-target-lookup-'+[guid]::NewGuid().ToString('N'))
$game=Join-Path $root 'game';$data=Join-Path $game 'FPSAimTrainer';$sounds=Join-Path $data 'sounds'
try {
 [IO.Directory]::CreateDirectory((Join-Path $data 'Saved/SaveGames')) > $null
 [IO.Directory]::CreateDirectory($sounds) > $null
 [IO.File]::WriteAllText((Join-Path $data 'Saved/SaveGames/PrimaryUserSettings.json'),'{}')
 $context=New-KvkContext $game (Join-Path $root 'local')
 foreach($name in @('literal[1].wav','中文音效.ogg','Smári.wav','.ogg','Hit.WAV')) {
  $path=Join-Path $sounds $name;[IO.File]::WriteAllText($path,'original')
  $result=Get-KvkTarget $context ('sounds/'+$name.ToUpperInvariant())
  if($result -cne $path){throw ('Case/literal lookup changed: '+$name)}
 }
 for($i=0;$i -lt 480;$i++){[IO.File]::WriteAllText((Join-Path $sounds ('filler-'+$i+'.wav')),'')}
 $target=Join-Path $sounds 'literal[1].wav'
 if((Get-KvkTarget $context 'sounds/literal[1].wav') -cne $target){throw 'Large directory changed literal bracket behavior'}
 $alias=Join-Path $sounds 'hit.wav'
 if(-not [IO.File]::Exists($alias)){
  [IO.File]::WriteAllText($alias,'collision')
  $rejected=$false
  try{$null=Get-KvkTarget $context 'sounds/HIT.wav'}catch{$rejected=$true}
  if(-not $rejected){throw 'Case-sensitive directory collision accepted'}
 } else {Write-Host 'Case-insensitive host: distinct case collision cannot be created.'}
 Write-Host 'PASS: literal brackets, Unicode, dot filenames and case aliases in a 485-file directory.'
} finally {if([IO.Directory]::Exists($root)){Remove-Item -LiteralPath $root -Recurse -Force}}
