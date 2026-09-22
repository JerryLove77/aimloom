#Requires -Version 7.0
param([string]$CaseFilter = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$feature=Join-Path (Split-Path $PSScriptRoot -Parent) 'kvk-crosshair.ps1'
if (-not [IO.File]::Exists($feature)) { throw 'MISSING FEATURE: crosshair adapter' }
. $feature
function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
# Byte arrays compare by reference with -ceq, so file contents need an element comparison.
function Assert-FileBytes([string]$Path,[byte[]]$Expected,[string]$Message) {
    $actual=[IO.File]::ReadAllBytes($Path)
    if ($actual.Length -ne $Expected.Length) { throw "$Message (length $($actual.Length) vs $($Expected.Length))" }
    for ($index=0;$index -lt $actual.Length;$index++) { if ($actual[$index] -ne $Expected[$index]) { throw $Message } }
}
# $Code is the strong form: the engine's own error code, which no wording change can move.
# $Match still exists for the refusals identified by the value they name, not by a code.
function Expect-Throw([scriptblock]$Body,[string]$Match='',[string]$Code='') {
    $message=$null;$actual=$null
    try { & $Body | Out-Null } catch { $message=$_.Exception.Message;$actual=$_.Exception.Data['KvkCode'] }
    Assert ($null -ne $message) 'Expected rejection'
    if ($Match) { Assert ($message -match $Match) "Wrong error: $message" }
    if ($Code) { Assert ($actual -ceq $Code) "Wrong code: $actual ($message)" }
}
function Write-Text([string]$Path,[string]$Text) {
    $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))
}
# A 4x2 canonical RGBA PNG produced by the browser encoder.
$script:Rgba='iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAALUlEQVR4AQEiAN3/AAD/B2QU9Qf/KOsHZDzhB/8AUNcHZGTNB/94wwdkjLkH/+7IDtXxPpQHAAAAAElFTkSuQmCC'
$script:Count=0
function Test-Case([string]$Name,[scriptblock]$Action) {
    if ($CaseFilter -and $Name -notlike "*$CaseFilter*") { return }
    $root=Join-Path ([IO.Path]::GetTempPath()) ('kvk-ch-current-'+[guid]::NewGuid().ToString('N'))
    if ($root.StartsWith('/var/')) { $root='/private'+$root }
    $script:Root=$root
    $game=Join-Path $root 'Game'; $local=Join-Path $root 'local'
    $script:Crosshairs=Join-Path $game 'FPSAimTrainer/crosshairs'
    $null=[IO.Directory]::CreateDirectory($script:Crosshairs)
    $null=[IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/sounds'))
    $null=[IO.Directory]::CreateDirectory((Join-Path $game 'FPSAimTrainer/Saved/SaveGames/Themes'))
    Write-Text (Join-Path $game 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json') '{"stringSettings":{}}'
    # An existing slot holds different bytes; replacing it must be reversible to these.
    $script:Target=Join-Path $script:Crosshairs 'slot.png'
    [IO.File]::WriteAllBytes($script:Target,[byte[]](9,9,9,9,9))
    [IO.File]::WriteAllBytes((Join-Path $script:Crosshairs 'other.png'),[byte[]](7,7,7))
    $script:Original=[IO.File]::ReadAllBytes($script:Target)
    $script:Png=[Convert]::FromBase64String($script:Rgba)
    $script:Ctx=New-KvkContext $game $local
    try { & $Action; $script:Count++; Write-Host "PASS $Name" } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Test-Case 'installed crosshairs are listed by file name and a target must already exist' {
    $listed=Get-KvkInstalledCrosshairs $Ctx
    Assert (@($listed.Crosshairs).Count -eq 2) 'Both PNG files must be listed'
    Assert ((@($listed.Crosshairs | ForEach-Object {$_.File}) | Sort-Object) -join ',' -ceq 'other.png,slot.png') 'Listed files must be the PNG names'
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'missing.png' $Png } 'not exist|找不到|exists'
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx '../../escape.png' $Png } 'Invalid|无效'
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.txt' $Png } 'Invalid|无效|png'
    Assert-FileBytes $Target $Original 'A rejected preview wrote the target'
}

Test-Case 'the preview writes no game file and the apply replaces only the chosen slot' {
    $plan=New-KvkCrosshairImagePlan $Ctx 'slot.png' $Png
    Assert-FileBytes $Target $Original 'Preview wrote the target'
    Assert ($plan.Plan.Items.Count -eq 1 -and $plan.Plan.Items[0].Action -eq 'replace') 'Expected one replacement'
    Assert ($plan.Width -eq 4 -and $plan.Height -eq 2) 'The preview must report the image size'
    Assert (-not $plan.GameSelectionChanged) 'A replacement must not claim it changed the game selection'
    $report=Invoke-KvkCrosshairImageReplacement $Ctx $plan
    Assert ($report.Status -eq 'completed') "Apply failed: $($report.Errors -join '; ')"
    Assert-FileBytes $Target $Png 'The slot bytes were not replaced'
    Assert-FileBytes (Join-Path $Crosshairs 'other.png') ([byte[]](7,7,7)) 'Another slot changed'
    $again=New-KvkCrosshairImagePlan $Ctx 'slot.png' $Png
    Assert ((Invoke-KvkCrosshairImageReplacement $Ctx $again).Status -eq 'no-change') 'An identical replacement must report no-change'
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored') 'Undo failed'
    Assert-FileBytes $Target $Original 'Undo did not restore the original bytes'
}

Test-Case 'the staged metadata matches the shape the existing adapter reads' {
    $plan=New-KvkCrosshairImagePlan $Ctx 'slot.png' $Png
    $metadata=ConvertFrom-Json ([IO.File]::ReadAllText($plan.MetadataPath)) -AsHashtable
    Assert ($metadata.schemaVersion -eq 1 -and $metadata.kind -ceq 'crosshair-replacement') 'Metadata kind/version is wrong'
    Assert ($metadata.targetFileName -ceq 'slot.png') 'Metadata target is wrong'
    Assert ($metadata.png.file -ceq 'crosshairs/slot.png') 'Metadata png path is wrong'
    Assert ($metadata.png.bytes -eq $Png.Length -and $metadata.png.width -eq 4 -and $metadata.png.height -eq 2) 'Metadata image facts are wrong'
    Assert ($metadata.png.sha256 -ceq (Get-KvkHash $plan.PngPath)) 'Metadata hash does not match the staged PNG'
    Assert ($metadata.requiresConfirmation -eq $true -and $metadata.gameSelectionChanged -eq $false) 'Metadata confirmation flags are wrong'
    Assert ($plan.PackRoot.StartsWith($Ctx.GameRoot,[StringComparison]::OrdinalIgnoreCase) -eq $false) 'The pack must live outside the game directory'
}

Test-Case 'only canonical RGBA images within the limits are accepted' {
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.png' ([byte[]](1,2,3)) } '签名|损坏|不完整|字节'
    $rgb=[byte[]]::new($Png.Length); [Array]::Copy($Png,$rgb,$Png.Length); $rgb[25]=2
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.png' $rgb } 'RGBA|颜色类型'
    $deep=[byte[]]::new($Png.Length); [Array]::Copy($Png,$deep,$Png.Length); $deep[24]=16
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.png' $deep } '8 位|位深'
    $interlaced=[byte[]]::new($Png.Length); [Array]::Copy($Png,$interlaced,$Png.Length); $interlaced[28]=1
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.png' $interlaced } '隔行'
    $big=[byte[]]::new(2MB+1)
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.png' $big } 'limit|上限|字节'
    # A width above the bound, written into a real IHDR, must be refused too.
    $wide=[byte[]]::new($Png.Length); [Array]::Copy($Png,$wide,$Png.Length)
    $wide[16]=0;$wide[17]=0;$wide[18]=2;$wide[19]=1
    Expect-Throw { New-KvkCrosshairImagePlan $Ctx 'slot.png' $wide } 'width|高度|尺寸|512'
    Assert-FileBytes $Target $Original 'A rejected image changed the target'
}

Test-Case 'a slot changed after review stops before writing' {
    $plan=New-KvkCrosshairImagePlan $Ctx 'slot.png' $Png
    [IO.File]::WriteAllBytes($Target,[byte[]](5,5,5))
    Expect-Throw { Invoke-KvkCrosshairImageReplacement $Ctx $plan } '' 'PLAN_STALE'
    Assert-FileBytes $Target ([byte[]](5,5,5)) 'A stale plan overwrote the slot'
}

Test-Case 'a running game does not block a crosshair image replacement' {
    $plan=New-KvkCrosshairImagePlan $Ctx 'slot.png' $Png
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { throw 'GAME_RUNNING the game is running' }
        $report=Invoke-KvkCrosshairImageReplacement $Ctx $plan
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ($report.Status -eq 'completed') "Replacement must be allowed while the game runs: $($report.Errors -join '; ')"
    Assert-FileBytes $Target $Png 'The running-game replacement did not take effect'
}

Test-Case 'adding a new crosshair creates one file and never overwrites an existing one' {
    # The player reads these, so they must be Chinese: an English-only message fails here.
    Expect-Throw { New-KvkCrosshairAddPlan $Ctx 'slot.png' $Png } '已经有'
    Expect-Throw { New-KvkCrosshairAddPlan $Ctx '../escape.png' $Png } '无效'
    Expect-Throw { New-KvkCrosshairAddPlan $Ctx 'brand.txt' $Png } '无效'
    # 128 characters including .png is the limit the page and Rust also enforce.
    Expect-Throw { New-KvkCrosshairAddPlan $Ctx (('a'*125)+'.png') $Png } '无效'
    $null=New-KvkCrosshairAddPlan $Ctx (('a'*124)+'.png') $Png
    Expect-Throw { New-KvkCrosshairAddPlan $Ctx 'new.png' ([byte[]](1,2,3)) } '签名|损坏|不完整|字节'
    $plan=New-KvkCrosshairAddPlan $Ctx 'new.png' $Png
    Assert (-not [IO.File]::Exists((Join-Path $Crosshairs 'new.png'))) 'Preparing an add wrote the game directory'
    Assert ($plan.Plan.Items.Count -eq 1 -and $plan.Plan.Items[0].Action -eq 'create') 'Adding must plan a create'
    $report=Invoke-KvkCrosshairAdd $Ctx $plan
    Assert ($report.Status -eq 'completed') "Add failed: $($report.Errors -join '; ')"
    Assert-FileBytes (Join-Path $Crosshairs 'new.png') $Png 'The new crosshair was not written'
    Assert-FileBytes $Target $Original 'The add changed another slot'
    Assert (@(Get-KvkInstalledCrosshairs $Ctx).Crosshairs.Count -eq 3) 'The new crosshair must be listed'
    $undo=Invoke-KvkRestore $Ctx (New-KvkRestorePlan $Ctx $report.Id)
    Assert ($undo.Status -eq 'restored') 'Undo failed'
    Assert (-not [IO.File]::Exists((Join-Path $Crosshairs 'new.png'))) 'Undo did not remove the added file'
    Assert-FileBytes $Target $Original 'Undo changed another slot'
}

Test-Case 'an added crosshair can be replaced afterwards, and a running game does not block it' {
    $add=New-KvkCrosshairAddPlan $Ctx 'new.png' $Png
    Assert ((Invoke-KvkCrosshairAdd $Ctx $add).Status -eq 'completed') 'Add failed'
    $other=[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAALUlEQVR4AQEiAN3/APoAY//cBWP/vgpj/6APY/8AghRj/2QZY/9GHmP/KCNj/x1XECUuvsH4AAAAAElFTkSuQmCC')
    $plan=New-KvkCrosshairImagePlan $Ctx 'new.png' $other
    $originalGuard=${function:Assert-KvkGameClosed}
    try {
        function Assert-KvkGameClosed { throw 'GAME_RUNNING the game is running' }
        $report=Invoke-KvkCrosshairImageReplacement $Ctx $plan
    } finally { ${function:Assert-KvkGameClosed}=$originalGuard }
    Assert ($report.Status -eq 'completed') "Replacing the new crosshair failed: $($report.Errors -join '; ')"
    Assert-FileBytes (Join-Path $Crosshairs 'new.png') $other 'The new crosshair was not replaced'
}

Write-Output "PASS crosshair current page: $script:Count case(s)"
