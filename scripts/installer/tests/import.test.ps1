#Requires -Version 7.0
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$feature=Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-import.ps1'
if (-not [IO.File]::Exists($feature)) { throw 'MISSING FEATURE: file import adapter' }
. $feature
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-FileBytes([string]$Path,[byte[]]$Expected,[string]$Message) {
    $actual=[IO.File]::ReadAllBytes($Path)
    if ($actual.Length -ne $Expected.Length) { throw "$Message (length $($actual.Length) vs $($Expected.Length))" }
    for ($index=0;$index -lt $actual.Length;$index++) { if ($actual[$index] -ne $Expected[$index]) { throw $Message } }
}
# Returns the refusal so a case can check both the wording the player reads and the code.
function Expect-Refusal([scriptblock]$Body,[string]$Match,[string]$Code='') {
    $caught=$null; try { & $Body | Out-Null } catch { $caught=$_.Exception }
    Assert ($null -ne $caught) "Expected a refusal matching $Match"
    Assert ($caught.Message -match $Match) "Wrong refusal wording: $($caught.Message)"
    if ($Code) { Assert ($caught.Data['KvkCode'] -ceq $Code) "Wrong refusal code: $($caught.Data['KvkCode']) for $($caught.Message)" }
}
function Get-BytesHash([byte[]]$Bytes) {
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Write-Source([string]$Name,[byte[]]$Bytes) {
    $path=Join-Path $script:Downloads $Name
    [IO.File]::WriteAllBytes($path,$Bytes); return $path
}
function Get-Stages { $base=Join-Path $script:Local 'Aimloom/import-previews'; if ([IO.Directory]::Exists($base)) { @([IO.Directory]::GetDirectories($base)) } else { @() } }
$utf8=[Text.UTF8Encoding]::new($false)
function Theme-Bytes([string]$Name) { return $utf8.GetBytes('{"themeName":"'+$Name+'","wallMaterial":"DRYWALL","floorMaterial":"DRYWALL"}') }

$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-import-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $game=Join-Path $root 'Game'; $script:Local=Join-Path $root 'local'; $script:Downloads=Join-Path $root 'Downloads with space'
    $script:Themes=Join-Path $game 'FPSAimTrainer/Saved/SaveGames/Themes'
    $script:Sounds=Join-Path $game 'FPSAimTrainer/sounds'
    foreach ($dir in @($script:Themes,$script:Sounds,(Join-Path $game 'FPSAimTrainer/crosshairs'),$script:Downloads)) { $null=[IO.Directory]::CreateDirectory($dir) }
    [IO.File]::WriteAllText((Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'),'{"stringSettings":{}}',$utf8)
    # One installed theme and one installed sound, whose bytes an import must never touch.
    $script:InstalledTheme=Join-Path $script:Themes 'Blue.json'
    [IO.File]::WriteAllBytes($script:InstalledTheme,(Theme-Bytes 'Blue Hour'))
    $script:InstalledSound=Join-Path $script:Sounds 'hit.wav'
    [IO.File]::WriteAllBytes($script:InstalledSound,[byte[]](1,2,3,4))
    $script:Ctx=New-KvkContext $game $script:Local
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'a UTF-16 theme is copied byte for byte, listed, and removed again by undo' {
    # The game reads UTF-16 themes, so an import must never re-encode or re-serialize.
    $le=[Text.UnicodeEncoding]::new($false,$true)
    $bytes=[byte[]]($le.GetPreamble()+$le.GetBytes('{"themeName":"夜间 Night","wallMaterial":"DRYWALL"}'))
    $source=Write-Source 'Night 夜.json' $bytes
    $plan=New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) 'Night 夜.json'
    Assert (-not [IO.File]::Exists((Join-Path $Themes 'Night 夜.json'))) 'Planning an import wrote the game directory'
    Assert ($plan.Plan.Items.Count -eq 1 -and $plan.Plan.Items[0].Action -ceq 'create') 'An import must plan exactly one create'
    Assert ($plan.ThemeName -ceq '夜间 Night') 'The plan must report the theme''s internal name'
    $report=Invoke-KvkFileAdd $Ctx $plan
    Assert ($report.Status -eq 'completed') "Import failed: $($report.Errors -join '; ')"
    Assert-FileBytes (Join-Path $Themes 'Night 夜.json') $bytes 'The theme was not copied byte for byte'
    Assert (@((Get-KvkInstalledThemes $Ctx).Themes | Where-Object { $_.Name -ceq '夜间 Night' -and $_.Readable }).Count -eq 1) 'The imported theme must be listed'
    Assert (@(Get-Stages).Count -eq 0) 'The staging folder must be removed after the import'
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored') 'Undo failed'
    Assert (-not [IO.File]::Exists((Join-Path $Themes 'Night 夜.json'))) 'Undo did not remove the imported theme'
}

Test-Case 'a big-endian UTF-16 theme is accepted' {
    $be=[Text.UnicodeEncoding]::new($true,$true)
    $bytes=[byte[]]($be.GetPreamble()+$be.GetBytes('{"themeName":"BE Theme"}'))
    $source=Write-Source 'be.json' $bytes
    $plan=New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) 'be.json'
    Assert ($plan.ThemeName -ceq 'BE Theme') 'A big-endian theme must be readable'
}

Test-Case 'a theme whose internal name is already installed is refused, naming the installed file' {
    # The game keys themes by themeName. A second one would make both unusable on the Scheme page.
    $bytes=Theme-Bytes 'blue HOUR'
    $source=Write-Source 'Another.json' $bytes
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) 'Another.json' } 'blue HOUR.*Blue\.json|Blue\.json.*blue HOUR'
    Assert (-not [IO.File]::Exists((Join-Path $Themes 'Another.json'))) 'A refused import wrote the game directory'
    Assert (@(Get-Stages).Count -eq 0) 'A refused import left its staging folder behind'
}

Test-Case 'a file that is not a theme is refused in Chinese and leaves no staging behind' {
    foreach ($content in @('[1,2,3]','{"wallMaterial":"DRYWALL"}','{"themeName":"  "}','{not json')) {
        $bytes=$utf8.GetBytes($content)
        $source=Write-Source 'bad.json' $bytes
        Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) 'bad.json' } '主题文件'
    }
    Assert (@(Get-Stages).Count -eq 0) 'A refused import left its staging folder behind'
    Assert (@([IO.Directory]::GetFiles($Themes)).Count -eq 1) 'A refused import wrote the Themes folder'
}

Test-Case 'a theme without ceiling or ramp settings is still accepted' {
    # About a fifth of real themes lack them. Whether 应用背景 can use one is a separate question.
    $bytes=Theme-Bytes 'Sparse'
    $plan=New-KvkFileAddPlan $Ctx 'theme' (Write-Source 'sparse.json' $bytes) (Get-BytesHash $bytes) 'sparse.json'
    Assert ($plan.Plan.Items[0].Action -ceq 'create') 'A sparse theme must be importable'
}

Test-Case 'an existing file is never overwritten, whatever the letter case' {
    $before=[IO.File]::ReadAllBytes($InstalledTheme)
    $bytes=Theme-Bytes 'Unique Name'
    $source=Write-Source 'incoming.json' $bytes
    foreach ($name in @('Blue.json','BLUE.JSON','blue.Json')) {
        Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) $name } '已经有'
    }
    Assert-FileBytes $InstalledTheme $before 'A refused import changed the installed theme'
}

Test-Case 'the target may be renamed, and unsafe target names are refused' {
    $bytes=Theme-Bytes 'Renamed'
    $source=Write-Source 'incoming.json' $bytes
    $plan=New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) 'My Theme 2.json'
    Assert ($plan.Plan.Items[0].Key -ceq 'themes/My Theme 2.json') 'The chosen name must be the installed name'
    foreach ($bad in @('../escape.json','a/b.json','.hidden.json','trailing.json ','con.json','note.txt','a..b.json',(('a'*124)+'.json'))) {
        Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) $bad } '无效'
    }
}

Test-Case 'the Themes folder is created when the game does not have one yet' {
    Remove-Item -LiteralPath $Themes -Recurse -Force
    $bytes=Theme-Bytes 'First'
    $plan=New-KvkFileAddPlan $Ctx 'theme' (Write-Source 'first.json' $bytes) (Get-BytesHash $bytes) 'first.json'
    $report=Invoke-KvkFileAdd $Ctx $plan
    Assert ($report.Status -eq 'completed') "Import failed: $($report.Errors -join '; ')"
    Assert-FileBytes (Join-Path $Themes 'first.json') $bytes 'The first theme was not written'
}

Test-Case 'a sound is added as is, and a stem already bound under either extension is refused' {
    $bytes=[byte[]](82,73,70,70,9,9,9,9)
    $source=Write-Source 'bell.wav' $bytes
    $plan=New-KvkFileAddPlan $Ctx 'sound' $source (Get-BytesHash $bytes) 'bell.wav'
    $report=Invoke-KvkFileAdd $Ctx $plan
    Assert ($report.Status -eq 'completed') "Import failed: $($report.Errors -join '; ')"
    Assert-FileBytes (Join-Path $Sounds 'bell.wav') $bytes 'The sound was not copied byte for byte'
    Assert (@((Get-KvkInstalledSounds $Ctx).Sounds | Where-Object { $_.Name -ceq 'bell' -and -not $_.Ambiguous }).Count -eq 1) 'The imported sound must be bindable'
    # hit.wav is installed. A hit.ogg beside it would make BOTH unbindable and break a binding that names hit.
    $ogg=Write-Source 'hit.ogg' $bytes
    foreach ($name in @('hit.ogg','HIT.ogg','hit.wav')) {
        Expect-Refusal { New-KvkFileAddPlan $Ctx 'sound' $ogg (Get-BytesHash $bytes) $name } '已经有'
    }
    Assert (@((Get-KvkInstalledSounds $Ctx).Sounds | Where-Object { $_.Name -ceq 'hit' -and $_.Ambiguous }).Count -eq 0) 'A refused sound made hit ambiguous'
    foreach ($bad in @('a;b.wav','song.mp3','song.json','../x.wav','.x.ogg')) {
        Expect-Refusal { New-KvkFileAddPlan $Ctx 'sound' $source (Get-BytesHash $bytes) $bad } '无效'
    }
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'crosshair' $source (Get-BytesHash $bytes) 'x.wav' } '类型'
}

Test-Case 'a source that is not a plain local file of the right type is refused' {
    $bytes=Theme-Bytes 'Source Rules'
    $hash=Get-BytesHash $bytes
    $good=Write-Source 'good.json' $bytes
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' 'good.json' $hash 'good.json' } '路径' 'INVALID_PATH'
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' (Join-Path $Downloads 'missing.json') $hash 'good.json' } '来源|找不到|不存在'
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'sound' $good $hash 'good.wav' } '扩展名|类型' 'INVALID_PATH'
    $huge=Join-Path $Downloads 'huge.json'
    $stream=[IO.File]::Open($huge,[IO.FileMode]::CreateNew); try { $stream.SetLength(8388609) } finally { $stream.Dispose() }
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $huge $hash 'huge.json' } '8 MiB'
    $link=Join-Path $Downloads 'link.json'
    $linked=$false; try { $null=New-Item -ItemType SymbolicLink -Path $link -Target $good -ErrorAction Stop; $linked=$true } catch { Write-Host '  (symbolic links need a privilege this session lacks; that sub-case is skipped)' }
    if ($linked) { Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $link $hash 'link.json' } '链接|Links|不安全' }
    Assert (@(Get-Stages).Count -eq 0) 'A refused import left its staging folder behind'
}

Test-Case 'the bytes the player previewed are the bytes that get installed' {
    $bytes=Theme-Bytes 'Pinned'
    $source=Write-Source 'pinned.json' $bytes
    # Changed between preview and plan: the hash the sheet computed no longer matches.
    Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash (Theme-Bytes 'Other')) 'pinned.json' } '发生了变化' 'PLAN_STALE'
    foreach ($bad in @('','abc',('A'*64),('g'*64))) { Expect-Refusal { New-KvkFileAddPlan $Ctx 'theme' $source $bad 'pinned.json' } '校验' }
    # Changed between plan and execute: staging pinned the bytes, so the edit is not installed.
    $plan=New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) 'pinned.json'
    [IO.File]::WriteAllBytes($source,(Theme-Bytes 'Tampered After Planning'))
    $report=Invoke-KvkFileAdd $Ctx $plan
    Assert ($report.Status -eq 'completed') "Import failed: $($report.Errors -join '; ')"
    Assert-FileBytes (Join-Path $Themes 'pinned.json') $bytes 'A source edited after planning changed what was installed'
}

Test-Case 'a target that appears after planning stops the import without overwriting' {
    $bytes=Theme-Bytes 'Raced'
    $plan=New-KvkFileAddPlan $Ctx 'theme' (Write-Source 'raced.json' $bytes) (Get-BytesHash $bytes) 'raced.json'
    $intruder=Theme-Bytes 'Someone Else'
    [IO.File]::WriteAllBytes((Join-Path $Themes 'raced.json'),$intruder)
    Expect-Refusal { Invoke-KvkFileAdd $Ctx $plan } '.' 'PLAN_STALE'
    Assert-FileBytes (Join-Path $Themes 'raced.json') $intruder 'A stale import overwrote a file that appeared after review'
    Assert (@(Get-Stages).Count -eq 0) 'A failed import left its staging folder behind'
}

Test-Case 'a running game does not block an import' {
    $bytes=Theme-Bytes 'While Running'
    $plan=New-KvkFileAddPlan $Ctx 'theme' (Write-Source 'running.json' $bytes) (Get-BytesHash $bytes) 'running.json'
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { throw 'GAME_RUNNING the game is running' }
        $report=Invoke-KvkFileAdd $Ctx $plan
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ($report.Status -eq 'completed') "An import must be allowed while the game runs: $($report.Errors -join '; ')"
}

Test-Case 'a refusal about a Chinese-named file names it in English, inside quotes' {
    # ROADMAP I18N-NAMES: game content is never translated, so the English message carries the
    # name inside double quotes. The English filter then accepts it, and an English player
    # learns which file was refused instead of reading the fixed worker.log line.
    [IO.File]::WriteAllBytes((Join-Path $Themes '中文主题.json'),(Theme-Bytes '中文 Theme'))
    $bytes=Theme-Bytes 'Unique Name'
    $source=Write-Source 'incoming.json' $bytes
    $caught=$null
    try { New-KvkFileAddPlan $Ctx 'theme' $source (Get-BytesHash $bytes) '中文主题.json' | Out-Null } catch { $caught=$_.Exception }
    Assert ($null -ne $caught) 'Adding a file that is already installed must be refused'
    $english=[string]$caught.Data['KvkMessageEn']
    Assert ($english.Contains('"中文主题.json"')) "The English refusal must name the file inside quotes: $english"
    Assert (Test-KvkEnglishSafe $english) "The English refusal must be English-safe: $english"
    Assert ((Get-KvkEnglishText $caught.Message $english) -ceq $english) 'The English refusal must survive the English filter'
    Assert ($caught.Message -match '中文主题\.json') 'The Chinese refusal must still name the file'

    # The same for a theme whose internal name clashes: both the internal name and the
    # installed file name are game content.
    $clashing=Theme-Bytes '中文 Theme'
    $clashSource=Write-Source 'clash.json' $clashing
    $caught=$null
    try { New-KvkFileAddPlan $Ctx 'theme' $clashSource (Get-BytesHash $clashing) 'clash.json' | Out-Null } catch { $caught=$_.Exception }
    Assert ($null -ne $caught) 'A clashing internal theme name must be refused'
    $english=[string]$caught.Data['KvkMessageEn']
    Assert ($english.Contains('"中文 Theme"') -and $english.Contains('"中文主题.json"')) "The English refusal must quote both names: $english"
    Assert (Test-KvkEnglishSafe $english) "The English refusal must be English-safe: $english"
    Assert (@(Get-Stages).Count -eq 0) 'A refused import left its staging folder behind'
}

Write-Output "PASS file import: $script:Count case(s)"
