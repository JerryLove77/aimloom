#Requires -Version 7.0
# Enemy skin adapter. Dot-source; importing performs no writes.
# Reuses the engine's plan/backup/rollback path for every write, exactly like Scheme and Audio.
#
# What this changes: exactly what the game's own Skin Browser changes -- the two strings at
# characterModelOverride.<Shape>.{characterModel,characterSkin} in PrimaryUserSettings.json.
# See docs/research/kovaak-skin-browser.md for where the choice lives and the 15-row catalog.
. (Join-Path $PSScriptRoot 'kvk-scheme.ps1')

# ---------------------------------------------------------------------------
# Catalog: one source for the whole App. Label (the browser's DisplayText), characterModel,
# characterSkin and the wire shape names this row supports, exactly as the research note's
# table. `cylindrical` is the humanoid box; `cuboid`/`spheroid` are the other two.
# ---------------------------------------------------------------------------
$script:KvkEnemySkinCatalog = @(
    [pscustomobject]@{Label='None';Model='None';Skin='None';Shapes=@('cylindrical','cuboid','spheroid')}
    [pscustomobject]@{Label='Ghost';Model='Ghost';Skin='Default';Shapes=@('cylindrical','cuboid','spheroid')}
    [pscustomobject]@{Label='Mummy';Model='Mummy';Skin='Default';Shapes=@('cylindrical','cuboid','spheroid')}
    [pscustomobject]@{Label='Stylized';Model='Stylized Ecto';Skin='Default';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Ecto';Model='Ecto';Skin='Default';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Endo';Model='Endo';Skin='Default';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Meso';Model='Meso';Skin='Default';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Shinji';Model='Meso';Skin='Genji';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='McCoy';Model='Meso';Skin='McCree';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Rocket Flyer';Model='Meso';Skin='Pharah';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Racer';Model='Meso';Skin='Tracer';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Swat Arya';Model='Anime Girl';Skin='Default';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='Swat Katsumi';Model='Anime Girl';Skin='Katsumi - SWAT';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='School Arya';Model='Anime Girl';Skin='Arya - School';Shapes=@('cylindrical')}
    [pscustomobject]@{Label='School Katsumi';Model='Anime Girl';Skin='Katsumi - School';Shapes=@('cylindrical')}
)
# Wire shape name -> the JSON key under characterModelOverride.
$script:KvkEnemyShapeKeys = [ordered]@{cylindrical='Cylindrical';cuboid='Cuboid';spheroid='Spheroid'}

function Get-KvkEnemySkinCatalog { return @($script:KvkEnemySkinCatalog | ForEach-Object { [pscustomobject]@{label=$_.Label;model=$_.Model;skin=$_.Skin;shapes=@($_.Shapes)} }) }

function Assert-KvkEnemyShape([string]$Shape) {
    if (-not $script:KvkEnemyShapeKeys.Contains($Shape)) { Throw-KvkFailure 'ENGINE_ERROR' "未知的敌人外观分类 (unknown shape): $Shape" "Unknown enemy shape: `"$Shape`"." }
}

# Locates characterModelOverride.<ShapeKey> in $Text and returns its absolute value span plus
# the region text, or $null if characterModelOverride or the shape key is missing. Everything
# outside that span is left untouched by any caller.
function Get-KvkEnemySkinShapeRegion([string]$Text,[string]$ShapeKey) {
    $root=Find-KvkJsonValue $Text 'characterModelOverride'
    if ($null -eq $root) { return $null }
    $rootRegion=$Text.Substring($root.ValueStart,$root.ValueEnd-$root.ValueStart)
    $shape=Find-KvkJsonValue $rootRegion $ShapeKey
    if ($null -eq $shape) { return $null }
    return [pscustomobject]@{
        Start=$root.ValueStart+$shape.ValueStart
        End=$root.ValueStart+$shape.ValueEnd
        Region=$rootRegion.Substring($shape.ValueStart,$shape.ValueEnd-$shape.ValueStart)
    }
}

# Reads {model, skin} out of a shape region, or $null if either string is missing/invalid.
function Get-KvkEnemySkinChoiceFromRegion([string]$Region) {
    $modelSpan=Find-KvkJsonValue $Region 'characterModel'
    $skinSpan=Find-KvkJsonValue $Region 'characterSkin'
    if ($null -eq $modelSpan -or $null -eq $skinSpan) { return $null }
    try {
        $model=ConvertFrom-Json ($Region.Substring($modelSpan.ValueStart,$modelSpan.ValueEnd-$modelSpan.ValueStart))
        $skin=ConvertFrom-Json ($Region.Substring($skinSpan.ValueStart,$skinSpan.ValueEnd-$skinSpan.ValueStart))
    } catch { return $null }
    if ($model -isnot [string] -or $skin -isnot [string]) { return $null }
    return [pscustomobject]@{Model=[string]$model;Skin=[string]$skin}
}

# Replaces only the bytes of one string value (characterModel or characterSkin) inside the
# named shape's object, by re-locating characterModelOverride.<ShapeKey> and the field fresh
# on $Text -- every other byte, including the other two shapes and
# currentlySelectedBoundingBoxType, is copied through unchanged.
function Set-KvkEnemySkinField([string]$Text,[string]$ShapeKey,[string]$FieldKey,[string]$Value) {
    $shape=Get-KvkEnemySkinShapeRegion $Text $ShapeKey
    if ($null -eq $shape) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少 characterModelOverride.$ShapeKey (missing shape block)。" "The current settings are missing characterModelOverride.`"$ShapeKey`"." }
    $field=Find-KvkJsonValue $shape.Region $FieldKey
    if ($null -eq $field) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少所需的键 (missing key): $ShapeKey.$FieldKey" "The current settings are missing a required key: `"$ShapeKey.$FieldKey`"." }
    $newRegion=$shape.Region.Substring(0,$field.ValueStart)+(ConvertTo-KvkJsonScalar $Value)+$shape.Region.Substring($field.ValueEnd)
    return $Text.Substring(0,$shape.Start)+$newRegion+$Text.Substring($shape.End)
}

# Every shape's equipped pair, or $null when the file has no block for that shape. A pair
# outside the catalog (a future game version) is returned as it is.
function Get-KvkEnemyCurrentSkins([string]$Text) {
    $current=[ordered]@{}
    foreach ($shape in $script:KvkEnemyShapeKeys.Keys) {
        $region=Get-KvkEnemySkinShapeRegion $Text $script:KvkEnemyShapeKeys[$shape]
        $choice=if ($null -eq $region) { $null } else { Get-KvkEnemySkinChoiceFromRegion $region.Region }
        $current[$shape]=if ($null -eq $choice) { $null } else { [pscustomobject]@{model=$choice.Model;skin=$choice.Skin} }
    }
    return $current
}

function Get-KvkEnemySkins($Context) {
    Assert-KvkContext $Context
    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    $current=[ordered]@{cylindrical=$null;cuboid=$null;spheroid=$null}
    if ([IO.File]::Exists($target)) { $current=Get-KvkEnemyCurrentSkins (Get-KvkTextFile $target).Text }
    return [pscustomobject]@{Current=$current;Skins=(Get-KvkEnemySkinCatalog)}
}

function New-KvkEnemySkinPlan($Context,[string]$Shape,[string]$Model,[string]$Skin) {
    Assert-KvkContext $Context
    Assert-KvkEnemyShape $Shape
    $shapeKey=$script:KvkEnemyShapeKeys[$Shape]
    $row=@($script:KvkEnemySkinCatalog | Where-Object { $_.Model -ceq $Model -and $_.Skin -ceq $Skin -and $Shape -cin $_.Shapes })
    if ($row.Count -ne 1) { Throw-KvkFailure 'ENGINE_ERROR' "「$Model / $Skin」不是这个分类的皮肤目录条目 (not a catalog skin for this shape)。" "`"$Model / $Skin`" is not a catalog skin for this shape." }
    $target=Get-KvkTarget $Context 'primary/PrimaryUserSettings.json'
    if (-not [IO.File]::Exists($target)) { Throw-KvkFailure 'ENGINE_ERROR' '找不到 PrimaryUserSettings.json；请先在游戏里打开一次皮肤浏览器 (Skin Browser)，正常退出后再试。' 'PrimaryUserSettings.json was not found. Open the Skin Browser in the game once and exit normally, then try again.' }
    $settingsHash=Get-KvkHash $target
    $source=Get-KvkTextFile $target
    $shape2=Get-KvkEnemySkinShapeRegion $source.Text $shapeKey
    if ($null -eq $shape2) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置缺少 characterModelOverride.$shapeKey；请先在游戏里打开一次皮肤浏览器 (Skin Browser)。" "The current settings are missing characterModelOverride.`"$shapeKey`". Open the Skin Browser in the game once." }
    $current=Get-KvkEnemySkinChoiceFromRegion $shape2.Region
    if ($null -eq $current) { Throw-KvkFailure 'ENGINE_ERROR' "当前设置里 characterModelOverride.$shapeKey 缺少必要的键；请先在游戏里打开一次皮肤浏览器 (Skin Browser)。" "characterModelOverride.`"$shapeKey`" is missing a required key. Open the Skin Browser in the game once." }
    if ($current.Model -ceq $Model -and $current.Skin -ceq $Skin) { Throw-KvkFailure 'ENGINE_ERROR' "「$Model / $Skin」已经是当前装备的皮肤 (already equipped)。" "`"$Model / $Skin`" is already the equipped skin." }
    $updated=Set-KvkEnemySkinField $source.Text $shapeKey 'characterModel' $Model
    $updated=Set-KvkEnemySkinField $updated $shapeKey 'characterSkin' $Skin
    $after=$source.Encoding.GetPreamble()+$source.Encoding.GetBytes($updated)
    $stage=Join-Path (Get-KvkDataRoot $Context.LocalDataRoot) ('enemy-previews/'+[guid]::NewGuid().ToString('N'))
    $gamePrefix=$Context.GameRoot+[IO.Path]::DirectorySeparatorChar
    if ($stage.StartsWith($gamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Enemy skin preview staging must be outside the game directory.' }
    New-KvkDirectory $stage
    Write-KvkDurableFile (Join-Path $stage 'PrimaryUserSettings.json') $after
    $plan=New-KvkPlan $Context $stage @('primary')
    if ($plan.Items.Count -ne 1 -or $plan.Items[0].Key -cne 'primary/PrimaryUserSettings.json' -or
        $plan.Items[0].AfterHash -cne (Get-KvkHash (Join-Path $stage 'PrimaryUserSettings.json')) -or
        $plan.Items[0].BeforeHash -cne $settingsHash -or $settingsHash -cne (Get-KvkHash $target)) {
        Throw-KvkFailure 'PLAN_STALE' '准备预览期间敌人皮肤来源发生了变化。' 'Enemy skin source changed during preview preparation.'
    }
    return [pscustomobject]@{Shape=$Shape;ShapeKey=$shapeKey;Model=$Model;Skin=$Skin;SettingsPath=$target;SettingsHash=$settingsHash;Plan=$plan}
}

function Invoke-KvkEnemySkinReplacement($Context,$SkinPlan,[scriptblock]$Observer=$null) {
    if ((Get-KvkHash $SkinPlan.SettingsPath) -cne $SkinPlan.SettingsHash) { Throw-KvkFailure 'PLAN_STALE' '预览之后设置发生了变化，请重新核对。' 'The settings changed after preview; review it again.' }
    # The engine locks, rechecks the reviewed before-hash, snapshots, backs up and verifies.
    # The game must be closed: it keeps these settings in memory and rewrites the whole
    # PrimaryUserSettings.json when it exits, so a write made while it runs is lost
    # (seen on the tester's PC, 2026-09-21, with an enemy skin).
    return Invoke-KvkInstall $Context $SkinPlan.Plan -Observer $Observer
}
