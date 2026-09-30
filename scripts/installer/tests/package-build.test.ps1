#Requires -Version 7.0
# The packager that turns a built app.exe into the folder and ZIP a player downloads.
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$packager = Join-Path (Split-Path $PSScriptRoot -Parent) 'test-build/package-test-build.ps1'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$appVersion = (Get-Content -LiteralPath (Join-Path $repo 'packages/app/src-tauri/tauri.installer.conf.json') -Raw | ConvertFrom-Json).version

Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:Count = 0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root = Join-Path ([IO.Path]::GetTempPath()) ('kvk-package-' + [guid]::NewGuid().ToString('N'))
    $null = [IO.Directory]::CreateDirectory($root)
    # Only the MZ header is checked, so a four-byte stand-in is enough.
    $script:Exe = Join-Path $root 'app.exe'; [IO.File]::WriteAllBytes($script:Exe, [byte[]](0x4D, 0x5A, 0, 0))
    $script:Out = Join-Path $root 'out'; $null = [IO.Directory]::CreateDirectory($script:Out)
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}
function Invoke-Packager([hashtable]$Arguments) {
    $all = @{ Exe = $script:Exe; Commit = 'abc1234'; OutRoot = $script:Out }
    foreach ($key in $Arguments.Keys) { $all[$key] = $Arguments[$key] }
    return & $packager @all
}
function Expect-Refusal([scriptblock]$Body,[string]$Match) {
    $caught = $null; try { & $Body | Out-Null } catch { $caught = $_.Exception.Message }
    Assert ($null -ne $caught) "Expected a refusal matching $Match"
    Assert ($caught -match $Match) "Wrong refusal: $caught"
    Assert (@(Get-ChildItem -LiteralPath $script:Out).Count -eq 0) 'A refused build must leave nothing behind'
}

Test-Case 'a test build is labelled as a test everywhere a player looks' {
    $result = Invoke-Packager @{ Version = "$appVersion-test.9" }
    Assert ((Split-Path $result.Folder -Leaf) -ceq "Aimloom-v$appVersion-test.9") "Wrong folder: $($result.Folder)"
    $readme = Get-Content -LiteralPath (Join-Path $result.Folder '使用说明.txt') -Raw
    Assert ($readme.Contains('测试版') -and $readme.Contains("$appVersion-test.9")) 'The test readme must say test build and name its version'
    Assert (-not $readme.Contains('{{')) 'A readme placeholder was left unfilled'
    Assert ((Get-Content -LiteralPath (Join-Path $result.Folder 'VERSION.txt') -First 1) -ceq "Aimloom $appVersion-test.9") 'VERSION.txt must name the build'
    $englishPath = Join-Path $result.Folder 'README.txt'
    Assert ([IO.File]::Exists($englishPath)) 'A test build must ship the English README.txt too'
    $english = Get-Content -LiteralPath $englishPath -Raw
    Assert (-not $english.Contains('{{')) 'A README.txt placeholder was left unfilled'
    Assert ($english.Contains('test build') -and $english.Contains("$appVersion-test.9")) 'README.txt must say test build and name its version'
}

Test-Case 'a release build carries the app version and a readme with no test wording' {
    $result = Invoke-Packager @{ Version = $appVersion; Channel = 'release' }
    Assert ((Split-Path $result.Folder -Leaf) -ceq "Aimloom-v$appVersion") "Wrong folder: $($result.Folder)"
    Assert ([IO.File]::Exists("$($result.Folder).zip")) 'The ZIP must sit beside the folder'
    $readme = Get-Content -LiteralPath (Join-Path $result.Folder '使用说明.txt') -Raw
    Assert (-not $readme.Contains('测试')) 'A release readme must not call itself a test'
    Assert ($readme.Contains("v$appVersion")) 'The release readme must name its version'
    foreach ($fact in @('Aimloom.exe', 'WebView2', '仍要运行', '%LOCALAPPDATA%\Aimloom')) {
        Assert ($readme.Contains($fact)) "The release readme must still say: $fact"
    }
    $english = Get-Content -LiteralPath (Join-Path $result.Folder 'README.txt') -Raw
    Assert (-not $english.Contains('{{')) 'A README.txt placeholder was left unfilled'
    foreach ($fact in @('Aimloom.exe', 'WebView2', 'Run anyway', '%LOCALAPPDATA%\Aimloom')) {
        Assert ($english.Contains($fact)) "README.txt must say: $fact"
    }
    Assert (@(Get-ChildItem -LiteralPath $result.Folder -Filter '*.txt').Count -eq 3) 'Exactly two readmes plus VERSION.txt'
    foreach ($text in @($readme, $english)) { Assert (-not ($text -match 'pwsh|PowerShell')) 'A readme must not mention PowerShell or pwsh' }
    $bytes = [IO.File]::ReadAllBytes((Join-Path $result.Folder '使用说明.txt'))
    Assert ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) 'Notepad needs the readme as UTF-8 with a BOM'
    $englishBytes = [IO.File]::ReadAllBytes((Join-Path $result.Folder 'README.txt'))
    Assert ($englishBytes[0] -eq 0xEF -and $englishBytes[1] -eq 0xBB -and $englishBytes[2] -eq 0xBF) 'Notepad needs README.txt as UTF-8 with a BOM'
}

Test-Case 'a beta build is labelled as a beta everywhere a player looks' {
    $result = Invoke-Packager @{ Version = "$appVersion-beta.3"; Channel = 'beta' }
    Assert ((Split-Path $result.Folder -Leaf) -ceq "Aimloom-v$appVersion-beta.3") "Wrong folder: $($result.Folder)"
    Assert ([IO.File]::Exists("$($result.Folder).zip")) 'The ZIP must sit beside the folder'
    $readme = Get-Content -LiteralPath (Join-Path $result.Folder '使用说明.txt') -Raw
    Assert ($readme.Contains('Beta') -and $readme.Contains("$appVersion-beta.3")) 'The beta readme must say Beta and name its version'
    Assert (-not $readme.Contains('{{')) 'A readme placeholder was left unfilled'
    Assert ((Get-Content -LiteralPath (Join-Path $result.Folder 'VERSION.txt') -First 1) -ceq "Aimloom $appVersion-beta.3") 'VERSION.txt must name the build'
    $englishPath = Join-Path $result.Folder 'README.txt'
    Assert ([IO.File]::Exists($englishPath)) 'A beta build must ship the English README.txt too'
    $english = Get-Content -LiteralPath $englishPath -Raw
    Assert (-not $english.Contains('{{')) 'A README.txt placeholder was left unfilled'
    Assert ($english.Contains('Beta') -and $english.Contains("$appVersion-beta.3")) 'README.txt must say Beta and name its version'
    Assert (-not ($english -match 'test build')) 'The beta README must not call itself a test build'
    Assert ($readme.Contains('0.1.5') -and $english.Contains('0.1.5')) 'The beta readmes must state the Profile caveat against 0.1.5'
    foreach ($fact in @('Aimloom.exe', 'WebView2', 'Run anyway', '%LOCALAPPDATA%\Aimloom')) {
        Assert ($english.Contains($fact)) "README.txt must say: $fact"
    }
}

Test-Case 'the folder holds exactly the EXE, VERSION.txt and the two readmes, and VERSION.txt has three lines' {
    $result = Invoke-Packager @{ Version = $appVersion; Channel = 'release' }
    $names = @($result.Files | Sort-Object)
    $expected = @('Aimloom.exe', 'README.txt', 'VERSION.txt', '使用说明.txt' | Sort-Object)
    Assert (($names -join '|') -ceq ($expected -join '|')) "Folder holds $($names -join ', ')"
    $lines = @(Get-Content -LiteralPath (Join-Path $result.Folder 'VERSION.txt'))
    Assert ($lines.Count -eq 3) "VERSION.txt has $($lines.Count) lines"
    Assert ($lines[0] -ceq "Aimloom $appVersion" -and $lines[1] -ceq 'commit abc1234' -and $lines[2] -match '^built \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$') "Wrong VERSION.txt: $($lines -join ' / ')"
    $zip = [IO.Compression.ZipFile]::OpenRead($result.Zip)
    try { $inZip = @($zip.Entries | ForEach-Object { $_.FullName } | Sort-Object) } finally { $zip.Dispose() }
    Assert (($inZip -join '|') -ceq ($expected -join '|')) "The ZIP holds $($inZip -join ', ')"
}

# The pin is no longer shipped; CI downloads that ZIP to run the PowerShell suites.
Test-Case 'the tracked pin, which CI uses to run these suites, still names the official PowerShell 7 ZIP' {
    $pin = Get-Content -LiteralPath (Join-Path (Split-Path $packager -Parent) 'pwsh-runtime.json') -Raw | ConvertFrom-Json -AsHashtable
    Assert ($pin.schemaVersion -eq 1) 'schemaVersion 1'
    Assert ($pin.version -cmatch '^7\.\d+\.\d+$') "A PowerShell 7 release: $($pin.version)"
    Assert ($pin.url -ceq "https://github.com/PowerShell/PowerShell/releases/download/v$($pin.version)/PowerShell-$($pin.version)-win-x64.zip") "The official win-x64 ZIP: $($pin.url)"
    Assert ($pin.sha256 -cmatch '^[0-9a-f]{64}$' -and $pin.bytes -gt 0) 'Size and SHA-256'
}

Test-Case 'a label that disagrees with the app version or the channel is refused' {
    Expect-Refusal { Invoke-Packager @{ Version = '9.9.9'; Channel = 'release' } } $appVersion
    Expect-Refusal { Invoke-Packager @{ Version = '9.9.9-test.1' } } $appVersion
    Expect-Refusal { Invoke-Packager @{ Version = "$appVersion-test.1"; Channel = 'release' } } 'release'
    Expect-Refusal { Invoke-Packager @{ Version = $appVersion } } 'test'
    Expect-Refusal { Invoke-Packager @{ Version = "$appVersion-beta"; Channel = 'beta' } } $appVersion
    Expect-Refusal { Invoke-Packager @{ Version = '9.9.9-beta.1'; Channel = 'beta' } } $appVersion
    Expect-Refusal { Invoke-Packager @{ Version = "$appVersion-test.1"; Channel = 'beta' } } 'beta'
}
$setupPackager = Join-Path (Split-Path $PSScriptRoot -Parent) 'test-build/package-setup.ps1'

Test-Case 'the Setup payload is exactly VERSION.txt' {
    $result = Invoke-Packager @{ Version = $appVersion; Channel = 'release' }
    $plan = & $setupPackager -Folder $result.Folder -OutRoot $script:Out -ConfigOnly
    $targets = @($plan.Resources.Values)
    Assert (($targets -join '|') -ceq 'VERSION.txt') "Payload $($targets -join ', ') is not exactly VERSION.txt"
    foreach ($source in $plan.Resources.Keys) { Assert (Test-Path -LiteralPath $source -PathType Leaf) "Missing payload source $source" }
    $json = Get-Content -LiteralPath $plan.Config -Raw | ConvertFrom-Json -AsHashtable
    Assert ($json.bundle.resources.Count -eq 1) 'The written config must carry the same map'
}

Test-Case 'the Setup packager refuses a folder in the old layout, with scripts\ or pwsh\' {
    foreach ($old in 'scripts', 'pwsh') {
        $result = Invoke-Packager @{ Version = $appVersion; Channel = 'release' }
        $null = New-Item -ItemType Directory -Path (Join-Path $result.Folder $old)
        $caught = $null; try { & $setupPackager -Folder $result.Folder -OutRoot $script:Out -ConfigOnly | Out-Null } catch { $caught = $_.Exception.Message }
        Assert ($null -ne $caught -and $caught -match "still has a $old folder" -and $caught -match 'older layout') "Wrong refusal for ${old}: $caught"
        Assert (@(Get-ChildItem -LiteralPath $script:Out -Filter 'setup-bundle-*.conf.json').Count -eq 0) 'A refused folder must write no bundle config'
        Remove-Item -LiteralPath $result.Folder -Recurse -Force
        Remove-Item -LiteralPath $result.Zip -Force
    }
}

Test-Case 'the Setup packager refuses a folder that is not a packaged Aimloom folder' {
    $bare = Join-Path $script:Out 'Aimloom-v9'; $null = New-Item -ItemType Directory -Path $bare
    $caught = $null; try { & $setupPackager -Folder $bare -OutRoot $script:Out -ConfigOnly | Out-Null } catch { $caught = $_.Exception.Message }
    Assert ($caught -match 'package-test-build') "Wrong refusal: $caught"
    $caught = $null; try { & $setupPackager -Folder $script:Out -OutRoot $script:Out -ConfigOnly | Out-Null } catch { $caught = $_.Exception.Message }
    Assert ($caught -match 'Aimloom-v') "Wrong refusal: $caught"
}

$assertHelper = Join-Path (Split-Path $PSScriptRoot -Parent) 'test-build/assert-no-local-paths.ps1'
. $assertHelper

Test-Case 'a planted user name in ASCII bytes is refused' {
    if (-not $env:USERNAME) { return }
    $target = Join-Path $script:Out 'planted-ascii.exe'
    [IO.File]::WriteAllBytes($target, [Text.Encoding]::UTF8.GetBytes("prefix $($env:USERNAME) suffix"))
    $caught = $null
    try { Assert-KvkNoLocalPaths -Path $target } catch { $caught = $_.Exception.Message }
    Assert ($null -ne $caught) 'Expected a refusal for a planted ASCII user name'
    Assert (-not $caught.Contains($env:USERNAME)) 'The refusal must never echo the matched text'
}

Test-Case 'a planted user name in UTF-16LE bytes is refused' {
    if (-not $env:USERNAME) { return }
    $target = Join-Path $script:Out 'planted-utf16.exe'
    [IO.File]::WriteAllBytes($target, [Text.Encoding]::Unicode.GetBytes("prefix $($env:USERNAME) suffix"))
    $caught = $null
    try { Assert-KvkNoLocalPaths -Path $target } catch { $caught = $_.Exception.Message }
    Assert ($null -ne $caught) 'Expected a refusal for a planted UTF-16LE user name'
    Assert (-not $caught.Contains($env:USERNAME)) 'The refusal must never echo the matched text'
}

Test-Case 'a literal C:\Users\ path is refused even without a matching env value' {
    $target = Join-Path $script:Out 'planted-cusers.exe'
    [IO.File]::WriteAllBytes($target, [Text.Encoding]::UTF8.GetBytes('prefix C:\Users\SomeoneElse\.cargo\registry suffix'))
    $caught = $null
    try { Assert-KvkNoLocalPaths -Path $target } catch { $caught = $_.Exception.Message }
    Assert ($null -ne $caught) 'Expected a refusal for a literal C:\Users\ path'
    Assert ($caught -match 'C:\\Users\\') "Wrong refusal: $caught"
}

Test-Case 'a clean file with none of the local-path forms is accepted' {
    $target = Join-Path $script:Out 'clean.exe'
    [IO.File]::WriteAllBytes($target, [Text.Encoding]::UTF8.GetBytes('nothing local in here, just ~ and . remap targets'))
    Assert-KvkNoLocalPaths -Path $target
}

Write-Host "package-build tests passed: $script:Count"
