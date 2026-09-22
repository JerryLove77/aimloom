#Requires -Version 7.0
<#
.SYNOPSIS
One entry point for the Windows tauri build that keeps the builder's local paths out of app.exe.

.DESCRIPTION
`node node_modules/@tauri-apps/cli/tauri.js build --features installer-ui --config
src-tauri/tauri.installer.conf.json --no-bundle --target x86_64-pc-windows-msvc` (run by hand
from packages\app) produces a bare app.exe, but rustc also embeds the source path of every
dependency into panic locations — the compiling machine's `C:\Users\<name>\...` — which is how
the released v0.1.1 and v0.1.2 Aimloom.exe ended up carrying the builder's Windows user name 317
times. This script runs the same build with RUSTFLAGS's --remap-path-prefix set so rustc writes
`~` for the user profile and `.` for this checkout instead, computed from the running
environment at call time, never a hard-coded name. Any RUSTFLAGS already set in the environment
is kept; the remap flags are appended after it.

Run on Windows, from anywhere; -SourceRoot / -Target default to this checkout and the shipped
triple. package-test-build.ps1 and package-setup.ps1 still refuse the resulting EXE if any local
path made it through anyway (assert-no-local-paths.ps1) — this script is the build, not the
check.

.EXAMPLE
pwsh -NoProfile -File scripts\installer\test-build\build-exe.ps1
#>
[CmdletBinding()]
param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
    [string]$Target = 'x86_64-pc-windows-msvc'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$appRoot = Join-Path $SourceRoot 'packages\app'
$cli = Join-Path $SourceRoot 'node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw "Tauri CLI not found at $cli; run npm install first." }

# --remap-path-prefix=<from>=<to> rewrites a path prefix rustc records at compile time; the
# rules are tried in order, so the most specific prefix (CARGO_HOME, when it sits outside the
# profile) is listed before the broader USERPROFILE one.
$remaps = [Collections.Generic.List[string]]::new()
$userProfile = $env:USERPROFILE
if ($userProfile) {
    $cargoHome = $env:CARGO_HOME
    if ($cargoHome -and -not $cargoHome.StartsWith($userProfile, [StringComparison]::OrdinalIgnoreCase)) {
        $remaps.Add("--remap-path-prefix=$($cargoHome)=~\.cargo")
    }
    $remaps.Add("--remap-path-prefix=$($userProfile)=~")
}
$remaps.Add("--remap-path-prefix=$($SourceRoot)=.")

$previousRustflags = $env:RUSTFLAGS
$env:RUSTFLAGS = (@(($previousRustflags, ($remaps -join ' ')) | Where-Object { $_ })) -join ' '
Write-Host "RUSTFLAGS: $($env:RUSTFLAGS)"

Push-Location $appRoot
try {
    & node $cli build --features installer-ui --config src-tauri/tauri.installer.conf.json --no-bundle --target $Target
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
    if ($null -eq $previousRustflags) { Remove-Item Env:\RUSTFLAGS -ErrorAction SilentlyContinue } else { $env:RUSTFLAGS = $previousRustflags }
}

$exe = Join-Path $appRoot "src-tauri\target\$Target\release\Aimloom.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "tauri build reported success but $exe is missing." }
Write-Host "Built: $exe"
[pscustomobject]@{ Exe = $exe; RemapFlags = @($remaps) }
