#Requires -Version 7.0
<#
.SYNOPSIS
Turns the packaged Aimloom folder into Aimloom-Setup-v<label>.exe with Tauri's NSIS bundler.

.DESCRIPTION
Run after package-test-build.ps1, on the machine that ran the Tauri build. The App carries its
own engine, so the installer's payload is that folder's VERSION.txt alone; the files the ZIP
holds besides it (the readmes) are for the ZIP. The EXE comes from the build
(target\<triple>\release\Aimloom.exe); the bundler marks its copy as an NSIS install
(__TAURI_BUNDLE_TYPE_VAR_UNK becomes ..._NSS), which is the only difference from the ZIP's EXE.
A folder in the old layout (one that still has scripts\ or pwsh\) is refused. -ConfigOnly writes
the generated bundle config and stops.

.EXAMPLE
pwsh -NoProfile -File scripts\installer\test-build\package-setup.ps1 `
    -Folder $HOME\Desktop\Aimloom-v0.1.2 -OutRoot $HOME\Desktop
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Folder,
    [Parameter(Mandatory)][string]$OutRoot,
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
    [string]$Target = 'x86_64-pc-windows-msvc',
    [switch]$ConfigOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
. (Join-Path $PSScriptRoot 'assert-no-local-paths.ps1')

$name = Split-Path $Folder -Leaf
if ($name -notmatch '^Aimloom-v(.+)$') { throw "$Folder is not a packaged Aimloom-v<label> folder." }
$label = $Matches[1]
foreach ($required in 'Aimloom.exe', 'VERSION.txt') {
    if (-not (Test-Path -LiteralPath (Join-Path $Folder $required) -PathType Leaf)) { throw "$Folder lacks $required; run package-test-build.ps1 first." }
}
foreach ($old in 'scripts', 'pwsh') {
    if (Test-Path -LiteralPath (Join-Path $Folder $old)) {
        throw "$Folder still has a $old folder: it was packaged by an older layout. Since 0.1.6 the App carries its own engine; run package-test-build.ps1 again."
    }
}

# The payload is VERSION.txt, at its place relative to the folder.
$resources = [ordered]@{}
$version = Get-Item -LiteralPath (Join-Path $Folder 'VERSION.txt')
$resources[($version.FullName -replace '\\', '/')] = 'VERSION.txt'
$config = Join-Path $OutRoot "setup-bundle-$label.conf.json"
@{ bundle = @{ resources = $resources } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $config -Encoding utf8NoBOM
if ($ConfigOnly) { return [pscustomobject]@{ Config = $config; Resources = $resources } }

$app = Join-Path $SourceRoot 'packages\app'
$appVersion = (Get-Content -LiteralPath (Join-Path $app 'src-tauri\tauri.installer.conf.json') -Raw | ConvertFrom-Json).version
$cli = Join-Path $SourceRoot 'node_modules\@tauri-apps\cli\tauri.js'
$built = Join-Path $app "src-tauri\target\$Target\release\bundle\nsis\Aimloom_$($appVersion)_x64-setup.exe"
# A Setup left by an earlier run must never be picked up as this run's output.
if (Test-Path -LiteralPath $built) { Remove-Item -LiteralPath $built -Force }
Push-Location $app
try {
    & node $cli bundle --bundles nsis --features installer-ui --target $Target `
        --config src-tauri/tauri.installer.conf.json --config src-tauri/tauri.installer.release.conf.json --config $config
    if ($LASTEXITCODE -ne 0) { throw "tauri bundle failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

if (-not (Test-Path -LiteralPath $built -PathType Leaf)) { throw "The bundler did not produce $built." }
$setup = Join-Path $OutRoot "Aimloom-Setup-v$label.exe"
Copy-Item -LiteralPath $built -Destination $setup -Force
try { Assert-KvkNoLocalPaths -Path $setup } catch { Remove-Item -LiteralPath $setup -Force; throw }
$setupVersion = (Get-Item -LiteralPath $setup).VersionInfo.ProductVersion
if ($setupVersion -cne $appVersion) { throw "$setup says version $setupVersion, but the source says $appVersion." }
[pscustomobject]@{
    Setup  = $setup
    Bytes  = (Get-Item -LiteralPath $setup).Length
    Sha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
}
