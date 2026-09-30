#Requires -Version 7.0
<#
.SYNOPSIS
Assembles the folder and ZIP a player downloads, around a built Aimloom.exe: a test build, a beta or a release.

.DESCRIPTION
The folder holds exactly four files: Aimloom.exe, VERSION.txt (three lines: the label, the commit
and the build time) and the channel's two readmes. The App carries its own engine (Aimloom.exe
--worker), so nothing else ships beside it: no scripts\ and no PowerShell.

The EXE must start with the MZ header, contain none of the builder's local paths
(Assert-KvkNoLocalPaths) and, when it states a version, state the app's. The label must agree
with the app's own version (tauri.installer.conf.json): a test build is <version>-test.N, a beta
is <version>-beta.N, a release is exactly <version>. The channel also picks the readmes, from
channels\<channel>\, where {{VERSION}} is replaced by the label; they are written as UTF-8 with a
BOM and CRLF. A failure after the folder exists removes it again. Then the folder is zipped next
to itself, with UTF-8 entry names. The ZIP is not byte-reproducible: it carries the build time.

.EXAMPLE
pwsh -NoProfile -File scripts\installer\test-build\package-test-build.ps1 `
    -Exe packages\app\src-tauri\target\x86_64-pc-windows-msvc\release\Aimloom.exe `
    -Version 0.1.2-test.1 -Commit abc1234 -OutRoot $HOME\Desktop

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
    [ValidateSet('test', 'beta', 'release')][string]$Channel = 'test',
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
. (Join-Path $PSScriptRoot 'assert-no-local-paths.ps1')

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

$target = Join-Path $OutRoot "Aimloom-v$Version"
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
$null = New-Item -ItemType Directory -Path $target
try {
    Copy-Item -LiteralPath $Exe -Destination (Join-Path $target 'Aimloom.exe')
    # The instructions for this channel. Notepad reads them best as UTF-8 with a BOM and CRLF,
    # whatever line endings the checkout produced.
    foreach ($readme in Get-ChildItem -LiteralPath $readmes -Filter '*.txt') {
        $text = ((Get-Content -LiteralPath $readme.FullName -Raw -Encoding utf8) -replace "`r?`n", "`r`n").Replace('{{VERSION}}', $Version)
        Set-Content -LiteralPath (Join-Path $target $readme.Name) -Value $text -Encoding utf8BOM -NoNewline
    }
    $built = [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
    Set-Content -LiteralPath (Join-Path $target 'VERSION.txt') -Encoding utf8BOM -Value @(
        "Aimloom $Version", "commit $Commit", "built $built UTC"
    )
} catch {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    throw
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = "$target.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
# UTF-8 entry names, so Explorer shows the Chinese file names correctly.
[IO.Compression.ZipFile]::CreateFromDirectory($target, $zip, [IO.Compression.CompressionLevel]::Optimal, $true, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    Folder  = $target
    Zip     = $zip
    Files   = @(Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($target, $_.FullName) })
}
