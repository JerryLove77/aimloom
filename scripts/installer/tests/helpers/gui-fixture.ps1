$ErrorActionPreference = 'Stop'
# The worker runs at 3.0. This file is dot-sourced, so a lower level here would silently
# lower the whole suite and hide errors that only the real app would hit.
Set-StrictMode -Version 3.0

function Write-KvkGuiFixtureText([string]$Path, [string]$Value) {
    $parent = [IO.Path]::GetDirectoryName($Path)
    if (-not [IO.Directory]::Exists($parent)) { $null = [IO.Directory]::CreateDirectory($parent) }
    [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Invoke-WithKvkGuiFixture([scriptblock]$Body) {
    $tempRoot=[IO.Path]::GetTempPath()
    if ($tempRoot.StartsWith('/var/')) { $tempRoot='/private'+$tempRoot }
    $root = Join-Path $tempRoot ('kvk-gui-' + [Guid]::NewGuid().ToString('N'))
    try {
        $gameRoot = Join-Path $root '游戏 with spaces/FPSAimTrainer'
        $packRoot = Join-Path $root '配置 pack'
        $localDataRoot = Join-Path $root 'Local Data'
        $primary = Join-Path $gameRoot 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
        $target = Join-Path $gameRoot 'FPSAimTrainer/sounds/hit.wav'
        $source = Join-Path $packRoot 'sounds/hit.wav'

        Write-KvkGuiFixtureText $primary '{}'
        Write-KvkGuiFixtureText $target 'original sound'
        Write-KvkGuiFixtureText $source 'new sound'
        $null = [IO.Directory]::CreateDirectory($localDataRoot)

        $runtimeRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        $session = New-KvkGuiSession -RuntimeRoot $runtimeRoot -LocalDataRoot $localDataRoot
        & $Body ([pscustomobject]@{
            Session = $session
            Root = $root
            GameRoot = $gameRoot
            PackRoot = $packRoot
            LocalDataRoot = $localDataRoot
            Target = $target
            Source = $source
        })
    } finally {
        if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
}
