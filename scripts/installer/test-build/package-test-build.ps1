#Requires -Version 7.0
<#
.SYNOPSIS
Assembles the folder and ZIP a player downloads, around a built app.exe: a test build or a release.

.DESCRIPTION
`tauri build --no-bundle` produces a bare app.exe, but the app needs its PowerShell worker
beside it: <exe dir>\scripts\gui\kvk-gui-worker.ps1 and everything that worker dot-sources.
This copies exactly that set, found by following the dot-source lines outward from the
worker, so a newly added script cannot be left behind.

It stands in for build-gui-release.py, which also requires a fixed WebView2 runtime and the
full 695-file asset pack. A test build needs neither: it uses the system WebView2, and the
five sections read the game's own folders. Only the legacy install wizard needs the pack.

PowerShell 7 ships inside the folder, as pwsh\: the official portable ZIP, extracted as it is.
-PwshZip names that ZIP, and it must be byte for byte the one pinned in pwsh-runtime.json (its
size and SHA-256, as GitHub publishes them), and its pwsh.exe must state the pinned version. The
App tries this copy before any PowerShell installed on the machine (discover_pwsh in worker.rs).

The label must agree with the app's own version (tauri.installer.conf.json): a test build is
<version>-test.N, a release is exactly <version>. The channel also picks the readme, from
channels\<channel>\, where {{VERSION}} is replaced by the label.

.EXAMPLE
pwsh -NoProfile -File scripts\installer\test-build\package-test-build.ps1 `
    -Exe packages\app\src-tauri\target\x86_64-pc-windows-msvc\release\Aimloom.exe `
    -Version 0.1.2-test.1 -Commit abc1234 -OutRoot $HOME\Desktop `
    -PwshZip $HOME\Downloads\PowerShell-7.6.6-win-x64.zip

.EXAMPLE
pwsh -NoProfile -File scripts\installer\test-build\package-test-build.ps1 `
    -Exe packages\app\src-tauri\target\x86_64-pc-windows-msvc\release\Aimloom.exe `
    -Version 0.1.2 -Channel release -Commit abc1234 -OutRoot $HOME\Desktop

.EXAMPLE
pwsh -NoProfile -File scripts\installer\test-build\package-test-build.ps1 `
    -Exe packages\app\src-tauri\target\x86_64-pc-windows-msvc\release\Aimloom.exe `
    -Version 0.1.4-beta.1 -Channel beta -Commit abc1234 -OutRoot $HOME\Desktop
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Exe,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Commit,
    [Parameter(Mandatory)][string]$OutRoot,
    [Parameter(Mandatory)][string]$PwshZip,
    [string]$PwshPin = (Join-Path $PSScriptRoot 'pwsh-runtime.json'),
    [ValidateSet('test', 'beta', 'release')][string]$Channel = 'test',
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
. (Join-Path $PSScriptRoot 'assert-no-local-paths.ps1')

$scripts = Join-Path $SourceRoot 'scripts\installer'
$header = [byte[]]::new(2)
$stream = [IO.File]::OpenRead($Exe)
try { $null = $stream.Read($header, 0, 2) } finally { $stream.Dispose() }
if ($header[0] -ne 0x4D -or $header[1] -ne 0x5A) { throw "$Exe is not a Windows executable." }
Assert-KvkNoLocalPaths -Path $Exe

# The label is what players and the website see, so it may not drift from the app's own version.
$appVersion = (Get-Content -LiteralPath (Join-Path $SourceRoot 'packages\app\src-tauri\tauri.installer.conf.json') -Raw | ConvertFrom-Json).version
if ($Channel -eq 'release' -and $Version -cne $appVersion) {
    throw "A release is labelled exactly the app version $appVersion; got '$Version'. Use -Channel test for $appVersion-test.N."
}
if ($Channel -eq 'test' -and $Version -cnotmatch ('^' + [regex]::Escape($appVersion) + '-test\.\d+$')) {
    throw "A test build is labelled $appVersion-test.N; got '$Version'. Use -Channel release for $appVersion."
}
if ($Channel -eq 'beta' -and $Version -cnotmatch ('^' + [regex]::Escape($appVersion) + '-beta\.[1-9]\d*$')) {
    throw "A beta build is labelled $appVersion-beta.N (N a positive integer); got '$Version'. Use -Channel test for $appVersion-test.N or -Channel release for $appVersion."
}
# A real build states its version; the tests' four-byte stand-in has none.
$exeVersion = (Get-Item -LiteralPath $Exe).VersionInfo.ProductVersion
if ($exeVersion -and $exeVersion -cne $appVersion) { throw "$Exe says version $exeVersion, but the source says $appVersion. Rebuild it." }
$readmes = Join-Path $PSScriptRoot "channels\$Channel"
if (-not @(Get-ChildItem -LiteralPath $readmes -Filter '*.txt').Count) { throw "No readme for the $Channel channel in $readmes." }

# The bundled PowerShell: exactly the pinned archive, checked before anything is written.
$pin = Get-Content -LiteralPath $PwshPin -Raw | ConvertFrom-Json -AsHashtable
$pinValid = $pin.schemaVersion -eq 1 -and
    ($pin.version -is [string] -and $pin.version -cmatch '^\d+\.\d+\.\d+$') -and
    ($pin.bytes -is [int] -or $pin.bytes -is [long]) -and
    ($pin.sha256 -is [string] -and $pin.sha256 -cmatch '^[0-9a-f]{64}$')
if (-not $pinValid) { throw "$PwshPin is not a valid PowerShell pin (schemaVersion 1, version, bytes, sha256)." }
if (-not (Test-Path -LiteralPath $PwshZip -PathType Leaf)) { throw "The PowerShell ZIP $PwshZip does not exist; download $($pin.url)." }
$zipBytes = (Get-Item -LiteralPath $PwshZip).Length
if ($zipBytes -ne $pin.bytes) { throw "$PwshZip is $zipBytes bytes; the pinned PowerShell $($pin.version) ZIP is $($pin.bytes). Download $($pin.url)." }
$zipHash = (Get-FileHash -LiteralPath $PwshZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($zipHash -cne $pin.sha256) { throw "$PwshZip has SHA-256 $zipHash; the pinned PowerShell $($pin.version) ZIP has $($pin.sha256)." }

# Follow `. (Join-Path $runtimeRoot|$PSScriptRoot 'name')` lines outward from the worker.
# $runtimeRoot is the scripts folder; $PSScriptRoot is the referencing file's own folder.
$pattern = '(?m)^\s*\.\s*\(Join-Path\s+\$(runtimeRoot|PSScriptRoot)\s+''([^'']+)''\)'
$needed = [Collections.Generic.SortedSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$queue = [Collections.Generic.Queue[string]]::new()
$queue.Enqueue('gui/kvk-gui-worker.ps1')
while ($queue.Count -gt 0) {
    $relative = $queue.Dequeue()
    if (-not $needed.Add($relative)) { continue }
    $file = Join-Path $scripts $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "The worker needs $relative, which is missing from $scripts." }
    foreach ($match in [regex]::Matches((Get-Content -LiteralPath $file -Raw), $pattern)) {
        $folder = if ($match.Groups[1].Value -eq 'runtimeRoot') { '' } else { Split-Path $relative -Parent }
        # Built outside the call: inside Enqueue(...), the comma in `-replace a, b` would be
        # read as a second method argument.
        $next = (($folder ? "$folder/" : '') + $match.Groups[2].Value) -replace '\\', '/'
        $queue.Enqueue($next)
    }
}

$target = Join-Path $OutRoot "Aimloom-v$Version"
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
$null = New-Item -ItemType Directory -Path $target
try {
    Copy-Item -LiteralPath $Exe -Destination (Join-Path $target 'Aimloom.exe')
    foreach ($relative in @($needed) + 'gui/protocol.schema.json') {
        $destination = Join-Path $target "scripts/$relative"
        $null = New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force
        Copy-Item -LiteralPath (Join-Path $scripts $relative) -Destination $destination
    }

    # The instructions for this channel. Notepad reads them best as UTF-8 with a BOM and CRLF,
    # whatever line endings the checkout produced.
    foreach ($readme in Get-ChildItem -LiteralPath $readmes -Filter '*.txt') {
        $text = ((Get-Content -LiteralPath $readme.FullName -Raw -Encoding utf8) -replace "`r?`n", "`r`n").Replace('{{VERSION}}', $Version)
        Set-Content -LiteralPath (Join-Path $target $readme.Name) -Value $text -Encoding utf8BOM -NoNewline
    }
    $built = [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
    Set-Content -LiteralPath (Join-Path $target 'VERSION.txt') -Encoding utf8BOM -Value @(
        "Aimloom $Version", "commit $Commit", "built $built UTC", "PowerShell $($pin.version)"
    )

    # Extracted as it is: no file is added, dropped or rewritten. .NET refuses an entry that would
    # land outside the folder.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $pwsh = Join-Path $target 'pwsh'
    [IO.Compression.ZipFile]::ExtractToDirectory($PwshZip, $pwsh)
    $pwshExe = Join-Path $pwsh 'pwsh.exe'
    if (-not (Test-Path -LiteralPath $pwshExe -PathType Leaf)) { throw "$PwshZip has no pwsh.exe at its root." }
    # "7.6.6 SHA: ..." for a real build.
    $stated = "$((Get-Item -LiteralPath $pwshExe).VersionInfo.ProductVersion)".Split(' ')[0]
    if ($stated -cne $pin.version) { throw "The bundled pwsh.exe says version '$stated'; the pin says $($pin.version)." }
} catch {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    throw
}

$zip = "$target.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
# UTF-8 entry names, so Explorer shows the Chinese file names correctly.
[IO.Compression.ZipFile]::CreateFromDirectory($target, $zip, [IO.Compression.CompressionLevel]::Optimal, $true, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    Folder  = $target
    Zip     = $zip
    Scripts = @($needed)
    Pwsh    = $pin.version
    Files   = @(Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($target, $_.FullName) })
}
