//! Enemy skins (`kvk-enemy.ps1`): exactly what the game's own Skin Browser changes, the two
//! strings at `characterModelOverride.<Shape>.{characterModel,characterSkin}` in
//! `PrimaryUserSettings.json`. See `docs/research/kovaak-skin-browser.md`.

use std::path::Path;

use super::json::{self, Json};
use super::store::{self, Context, Engine};
use super::text::{self, find_value, splice, utf16, TextFile};
use super::txn::{self, Plan};
use super::{EngineError, EngineResult};

const ALL: &[&str] = &["cylindrical", "cuboid", "spheroid"];
const HUMANOID: &[&str] = &["cylindrical"];

/// The Skin Browser's rows: label, characterModel, characterSkin, supported wire shapes.
pub const CATALOG: [(&str, &str, &str, &[&str]); 15] = [
    ("None", "None", "None", ALL),
    ("Ghost", "Ghost", "Default", ALL),
    ("Mummy", "Mummy", "Default", ALL),
    ("Stylized", "Stylized Ecto", "Default", HUMANOID),
    ("Ecto", "Ecto", "Default", HUMANOID),
    ("Endo", "Endo", "Default", HUMANOID),
    ("Meso", "Meso", "Default", HUMANOID),
    ("Shinji", "Meso", "Genji", HUMANOID),
    ("McCoy", "Meso", "McCree", HUMANOID),
    ("Rocket Flyer", "Meso", "Pharah", HUMANOID),
    ("Racer", "Meso", "Tracer", HUMANOID),
    ("Swat Arya", "Anime Girl", "Default", HUMANOID),
    ("Swat Katsumi", "Anime Girl", "Katsumi - SWAT", HUMANOID),
    ("School Arya", "Anime Girl", "Arya - School", HUMANOID),
    ("School Katsumi", "Anime Girl", "Katsumi - School", HUMANOID),
];

/// Wire shape name to the JSON key under `characterModelOverride`.
pub fn shape_key(shape: &str) -> Option<&'static str> {
    match shape { "cylindrical" => Some("Cylindrical"), "cuboid" => Some("Cuboid"), "spheroid" => Some("Spheroid"), _ => None }
}

pub fn catalog_json() -> Json {
    Json::Array(CATALOG.iter().map(|(label, model, skin, shapes)| Json::object(vec![
        ("label", Json::str(*label)), ("model", Json::str(*model)), ("skin", Json::str(*skin)),
        ("shapes", Json::Array(shapes.iter().map(|s| Json::str(*s)).collect())),
    ])).collect())
}

struct Region { start: usize, end: usize, text: Vec<u16> }

/// `Get-KvkEnemySkinShapeRegion`.
fn shape_region(text: &[u16], key: &str) -> EngineResult<Option<Region>> {
    let Some(root) = find_value(text, "characterModelOverride")? else { return Ok(None) };
    let root_region = &text[root.value_start..root.value_end];
    let Some(shape) = find_value(root_region, key)? else { return Ok(None) };
    Ok(Some(Region { start: root.value_start + shape.value_start, end: root.value_start + shape.value_end, text: root_region[shape.value_start..shape.value_end].to_vec() }))
}

/// `Get-KvkEnemySkinChoiceFromRegion`: both values must parse as JSON strings.
fn choice(region: &[u16]) -> EngineResult<Option<(String, String)>> {
    let (Some(model), Some(skin)) = (find_value(region, "characterModel")?, find_value(region, "characterSkin")?) else { return Ok(None) };
    let read = |span: text::Span| -> Option<String> {
        let raw = String::from_utf16_lossy(&region[span.value_start..span.value_end]);
        // ConvertFrom-Json with -DateKind String (the PowerShell fix list), so a date-like
        // model name stays a string.
        match json::parse(&raw, json::ReadOptions { strings: json::Strings::Literal, ..json::ReadOptions::CONVERT_FROM_JSON }) { Ok(Json::String(s)) => Some(s), _ => None }
    };
    Ok(read(model).zip(read(skin)))
}

/// `Set-KvkEnemySkinField`: replaces only one string value inside the named shape's object.
fn set_field(text: &[u16], key: &str, field: &str, value: &str) -> EngineResult<Vec<u16>> {
    let Some(shape) = shape_region(text, key)? else {
        return Err(EngineError::coded("ENGINE_ERROR", format!("当前设置缺少 characterModelOverride.{key} (missing shape block)。"), format!("The current settings are missing characterModelOverride.\"{key}\".")));
    };
    let Some(span) = find_value(&shape.text, field)? else {
        return Err(EngineError::coded("ENGINE_ERROR", format!("当前设置缺少所需的键 (missing key): {key}.{field}"), format!("The current settings are missing a required key: \"{key}.{field}\".")));
    };
    let region = splice(&shape.text, span.value_start, span.value_end, &utf16(&text::json_scalar_string(value)));
    Ok(splice(text, shape.start, shape.end, &region))
}

/// `Get-KvkEnemySkins`: the equipped pair per shape (`null` without a block) and the catalog.
pub fn list(engine: &Engine, context: &Context) -> EngineResult<Json> {
    engine.assert_context(context)?;
    let target = engine.target(context, "primary/PrimaryUserSettings.json")?;
    let mut current = Vec::new();
    let file = if Path::new(&target).is_file() { Some(TextFile::decode(&std::fs::read(&target).map_err(|e| EngineError::io(&e))?)) } else { None };
    for shape in ALL {
        let mut value = Json::Null;
        if let Some(file) = &file {
            if let Some(region) = shape_region(&file.text, shape_key(shape).unwrap_or_default())? {
                if let Some((model, skin)) = choice(&region.text)? { value = Json::object(vec![("model", Json::str(model)), ("skin", Json::str(skin))]); }
            }
        }
        current.push((shape.to_string(), value));
    }
    Ok(Json::object(vec![("current", Json::Object(current)), ("skins", catalog_json())]))
}

/// What executing an Enemy plan needs again: the settings file and the hash the preview saw.
pub struct EnemyPlan { pub settings_path: String, pub settings_hash: String, pub plan: Plan }

/// `New-KvkEnemySkinPlan`.
pub fn plan(engine: &Engine, context: &Context, shape: &str, model: &str, skin: &str) -> EngineResult<EnemyPlan> {
    engine.assert_context(context)?;
    let Some(key) = shape_key(shape) else {
        return Err(EngineError::coded("ENGINE_ERROR", format!("未知的敌人外观分类 (unknown shape): {shape}"), format!("Unknown enemy shape: \"{shape}\".")));
    };
    let rows = CATALOG.iter().filter(|(_, m, s, shapes)| *m == model && *s == skin && shapes.contains(&shape)).count();
    if rows != 1 {
        return Err(EngineError::coded("ENGINE_ERROR", format!("「{model} / {skin}」不是这个分类的皮肤目录条目 (not a catalog skin for this shape)。"), format!("\"{model} / {skin}\" is not a catalog skin for this shape.")));
    }
    let target = engine.target(context, "primary/PrimaryUserSettings.json")?;
    if !Path::new(&target).is_file() {
        return Err(EngineError::coded("ENGINE_ERROR", "找不到 PrimaryUserSettings.json；请先在游戏里打开一次皮肤浏览器 (Skin Browser)，正常退出后再试。", "PrimaryUserSettings.json was not found. Open the Skin Browser in the game once and exit normally, then try again."));
    }
    let settings_hash = store::hash(&target)?.unwrap_or_default();
    let source = TextFile::decode(&std::fs::read(&target).map_err(|e| EngineError::io(&e))?);
    let Some(region) = shape_region(&source.text, key)? else {
        return Err(EngineError::coded("ENGINE_ERROR", format!("当前设置缺少 characterModelOverride.{key}；请先在游戏里打开一次皮肤浏览器 (Skin Browser)。"), format!("The current settings are missing characterModelOverride.\"{key}\". Open the Skin Browser in the game once.")));
    };
    let Some((current_model, current_skin)) = choice(&region.text)? else {
        return Err(EngineError::coded("ENGINE_ERROR", format!("当前设置里 characterModelOverride.{key} 缺少必要的键；请先在游戏里打开一次皮肤浏览器 (Skin Browser)。"), format!("characterModelOverride.\"{key}\" is missing a required key. Open the Skin Browser in the game once.")));
    };
    if current_model == model && current_skin == skin {
        return Err(EngineError::coded("ENGINE_ERROR", format!("「{model} / {skin}」已经是当前装备的皮肤 (already equipped)。"), format!("\"{model} / {skin}\" is already the equipped skin.")));
    }
    let updated = set_field(&source.text, key, "characterModel", model)?;
    let updated = set_field(&updated, key, "characterSkin", skin)?;
    let after = source.encoding.encode(&updated);
    let staged = txn::settings_preview_plan(engine, context, &target, &settings_hash, &after, "enemy-previews", "Enemy skin preview staging must be outside the game directory.")?;
    let Some(plan) = staged else {
        return Err(EngineError::coded("PLAN_STALE", "准备预览期间敌人皮肤来源发生了变化。", "Enemy skin source changed during preview preparation."));
    };
    Ok(EnemyPlan { settings_path: target, settings_hash, plan })
}

/// `Invoke-KvkEnemySkinReplacement`: the game must be closed, since it rewrites the whole
/// settings file when it exits.
pub fn execute(engine: &Engine, context: &Context, enemy: &EnemyPlan, observer: txn::Observer) -> EngineResult<txn::Report> {
    if store::hash(&enemy.settings_path)?.as_deref() != Some(enemy.settings_hash.as_str()) {
        return Err(EngineError::coded("PLAN_STALE", "预览之后设置发生了变化，请重新核对。", "The settings changed after preview; review it again."));
    }
    txn::install(engine, context, &enemy.plan, false, observer)
}
