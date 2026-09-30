//! Settings edits in `PrimaryUserSettings.json`: the value splice (`Set-KvkJsonSetting`,
//! `ConvertTo-KvkJsonScalar`), and the Theme (`kvk-scheme.ps1`) and Sounds (`kvk-audio.ps1`)
//! plans built on it. Every edit replaces only the addressed value's text.

use std::path::Path;

use super::json::{Json, Number};
use super::lists::{self, AUDIO_EVENTS};
use super::store::{self, Context, Engine};
use super::text::{self, eq_ignore_case, find_value, splice, utf16, TextFile};
use super::txn::{self, Plan};
use super::{paths, EngineError, EngineResult};

/// A value `ConvertTo-KvkJsonScalar` writes.
#[derive(Clone, Debug, PartialEq)]
pub enum Scalar { Str(String), Int(i64), Double(f64), Bool(bool) }

impl Scalar {
    /// `ConvertTo-KvkJsonScalar`.
    pub fn render(&self) -> String {
        match self {
            Scalar::Str(s) => text::json_scalar_string(s),
            Scalar::Int(n) => n.to_string(),
            Scalar::Double(d) => text::double_r(*d),
            Scalar::Bool(b) => (if *b { "true" } else { "false" }).to_string(),
        }
    }
}

/// An edit's value: one scalar, or one scalar per channel of an object setting.
#[derive(Clone, Debug, PartialEq)]
pub enum Value { One(Scalar), Channels(Vec<(&'static str, Scalar)>) }

fn missing_key(key: &str) -> EngineError {
    EngineError::coded("ENGINE_ERROR", format!("当前设置缺少所需的键 (missing key): {key}"), format!("The current settings are missing a required key: {key}."))
}

/// `Set-KvkJsonSetting`.
pub fn set_setting(text: &[u16], key: &str, value: &Value) -> EngineResult<Vec<u16>> {
    let Some(span) = find_value(text, key)? else { return Err(missing_key(key)) };
    match value {
        Value::One(scalar) => Ok(splice(text, span.value_start, span.value_end, &utf16(&scalar.render()))),
        Value::Channels(channels) => {
            let mut region = text[span.value_start..span.value_end].to_vec();
            for (channel, scalar) in channels {
                let Some(inner) = find_value(&region, channel)? else { return Err(missing_key(&format!("{key}.{channel}"))) };
                region = splice(&region, inner.value_start, inner.value_end, &utf16(&scalar.render()));
            }
            Ok(splice(text, span.value_start, span.value_end, &region))
        }
    }
}

/// Applies each edit in turn; an edit that would leave its setting's text as it was is skipped.
fn apply_edits(source: &[u16], edits: &[(String, Value)]) -> EngineResult<Vec<u16>> {
    let mut updated = source.to_vec();
    for (key, value) in edits {
        let Some(span) = find_value(&updated, key)? else { return Err(missing_key(key)) };
        let before = updated[span.key_start..span.value_end].to_vec();
        let next = set_setting(&updated, key, value)?;
        let after_span = find_value(&next, key)?.ok_or_else(|| missing_key(key))?;
        if next[after_span.key_start..after_span.value_end] == before[..] { continue; }
        updated = next;
    }
    Ok(updated)
}

fn read_settings(engine: &Engine, context: &Context) -> EngineResult<(String, String, TextFile)> {
    let target = engine.target(context, "primary/PrimaryUserSettings.json")?;
    if !Path::new(&target).is_file() {
        return Err(EngineError::coded("ENGINE_ERROR", "找不到 PrimaryUserSettings.json；请先启动一次游戏并正常退出。", "PrimaryUserSettings.json was not found. Run the game once and exit normally first."));
    }
    let settings = TextFile::decode(&std::fs::read(&target).map_err(|e| EngineError::io(&e))?);
    let hash = store::hash(&target)?.unwrap_or_default();
    Ok((target, hash, settings))
}

// ---- Theme (scheme) ------------------------------------------------------------------------

/// `Assert-KvkSchemeNumber`: a JSON number (not a BigInteger) inside the range; whole when asked.
fn scheme_number(value: Option<&Json>, label: &str, min: f64, max: f64, integer: bool) -> EngineResult<Number> {
    let number = match value.and_then(Json::number) {
        Some(n @ (Number::Int(_) | Number::Double(_))) => n,
        _ => return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {label} 必须是数值"), format!("Theme field {label} must be a number."))),
    };
    let x = match number { Number::Int(i) => i as f64, Number::Double(d) => d, Number::Big => unreachable_big() };
    if x.is_nan() || x.is_infinite() || x < min || x > max {
        let (lo, hi) = (text::double_r(min), text::double_r(max));
        return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {label} 超出范围 {lo}..{hi}"), format!("Theme field {label} is outside the range {lo}..{hi}.")));
    }
    if integer && x != x.floor() {
        return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {label} 必须是整数"), format!("Theme field {label} must be a whole number.")));
    }
    Ok(number)
}

#[allow(clippy::panic)]
fn unreachable_big() -> ! { panic!("a BigInteger was refused above") }

/// The channel value as the theme stored it: Int64 stays an integer, anything else a double.
fn channel_scalar(number: Number) -> Scalar {
    match number { Number::Int(i) => Scalar::Int(i), Number::Double(d) => Scalar::Double(d), Number::Big => unreachable_big() }
}

fn as_double(number: Number) -> f64 { match number { Number::Int(i) => i as f64, Number::Double(d) => d, Number::Big => unreachable_big() } }

/// `Get-KvkSchemeEdits`: a field the theme carries must be valid and is written; a field it
/// lacks keeps the player's value. The three material overrides are always written.
pub fn scheme_edits(theme: &Json) -> EngineResult<Vec<(String, Value)>> {
    let mut edits = Vec::new();
    for (native, lower) in [("Wall", "wall"), ("Floor", "floor"), ("Ceiling", "ceiling"), ("Ramp", "ramp")] {
        let field = |name: &str| format!("{lower}{name}");
        if let Some(material) = theme.get(&field("Material")) {
            let Some(text) = material.as_str().filter(|t| !t.trim().is_empty()) else {
                let f = field("Material");
                return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {f} 为空或不是文本"), format!("Theme field {f} is empty or not text.")));
            };
            edits.push((format!("EStringSettingId::{native}Material"), Value::One(Scalar::Str(text.to_string()))));
        }
        if let Some(tint) = theme.get(&field("Tint")) {
            let f = field("Tint");
            if !matches!(tint, Json::Object(_)) { return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {f} 格式不正确"), format!("Theme field {f} is not in the expected format."))); }
            let mut channels = Vec::new();
            for channel in ["x", "y", "z"] { channels.push((channel, channel_scalar(scheme_number(tint.get(channel), &format!("{f}.{channel}"), 0.0, 1.0, false)?))); }
            edits.push((format!("EVectorSettingId::{native}Color"), Value::Channels(channels)));
        }
        for name in ["Roughness", "Metallic", "FullBright"] {
            let f = field(name);
            if theme.get(&f).is_none() { continue; }
            let number = scheme_number(theme.get(&f), &f, 0.0, 1.0, false)?;
            edits.push((format!("EFloatSettingId::{native}{name}"), Value::One(Scalar::Double(as_double(number)))));
        }
        let f = field("TextureScale");
        if theme.get(&f).is_some() {
            let number = as_double(scheme_number(theme.get(&f), &f, 0.0, f64::MAX, false)?);
            if number <= 0.0 { return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {f} 必须为正数"), format!("Theme field {f} must be positive."))); }
            edits.push((format!("EFloatSettingId::{native}TextureScale"), Value::One(Scalar::Double(number))));
        }
    }
    for (field, setting, max) in [("skyPresetId", "SkyPreset", 13.0), ("cloudCoverId", "CloudCover", 5.0)] {
        if theme.get(field).is_none() { continue; }
        let number = scheme_number(theme.get(field), field, 0.0, max, true)?;
        edits.push((format!("EIntegerSettingId::{setting}"), Value::One(Scalar::Int(as_double(number) as i64))));
    }
    for (field, setting) in [("solidSkyColor", "SolidSkyColor"), ("sunVisible", "ShowSunInSkybox")] {
        let Some(value) = theme.get(field) else { continue };
        let Json::Bool(flag) = value else { return Err(EngineError::coded("ENGINE_ERROR", format!("主题字段 {field} 必须是布尔值"), format!("Theme field {field} must be a boolean."))) };
        edits.push((format!("EBooleanSettingId::{setting}"), Value::One(Scalar::Bool(*flag))));
    }
    if let Some(sky) = theme.get("skyColor") {
        if !matches!(sky, Json::Object(_)) { return Err(EngineError::coded("ENGINE_ERROR", "主题字段 skyColor 格式不正确", "Theme field skyColor is not in the expected format.")); }
        let mut channels = Vec::new();
        for channel in ["r", "g", "b", "a"] { channels.push((channel, channel_scalar(scheme_number(sky.get(channel), &format!("skyColor.{channel}"), 0.0, 255.0, true)?))); }
        edits.push(("EColorSettingId::SkyColor".to_string(), Value::Channels(channels)));
    }
    // The game writes these three when it applies a theme itself; their material indices are
    // not derivable from theme files, so they are copied verbatim.
    edits.push(("EIntegerSettingId::WallMat".to_string(), Value::One(Scalar::Int(-1))));
    edits.push(("EIntegerSettingId::FloorMat".to_string(), Value::One(Scalar::Int(-1))));
    edits.push(("EBooleanSettingId::OverrideAllNewMapMaterials".to_string(), Value::One(Scalar::Bool(true))));
    Ok(edits)
}

pub struct SchemePlan { pub theme_path: String, pub theme_hash: String, pub plan: Plan }

/// `Get-KvkSchemeSource` + `New-KvkSchemePlan`.
pub fn scheme_plan(engine: &Engine, context: &Context, file: &str) -> EngineResult<SchemePlan> {
    engine.assert_context(context)?;
    paths::assert_file_name(file)?;
    if !file.to_ascii_lowercase().ends_with(".json") {
        return Err(EngineError::coded("ENGINE_ERROR", format!("主题文件名必须使用 .json 扩展名: {file}"), format!("A theme file name must use the .json extension: \"{file}\".")));
    }
    let installed = lists::installed_themes(engine, context)?;
    let matches: Vec<&lists::InstalledTheme> = installed.themes.iter().filter(|t| t.file == file).collect();
    let [theme] = matches[..] else { return Err(EngineError::coded("ENGINE_ERROR", format!("找不到主题文件 (theme not found): {file}"), format!("Theme file not found: \"{file}\"."))) };
    if !theme.readable { return Err(EngineError::coded("ENGINE_ERROR", format!("无法读取主题文件 (unreadable theme): {file}"), format!("The theme file could not be read: \"{file}\"."))); }
    if theme.duplicate_name {
        let name = theme.name.clone().unwrap_or_default();
        return Err(EngineError::coded("ENGINE_ERROR", format!("多个主题文件使用同一名称「{name}」，无法确定要应用哪一个 (duplicate theme name)"), format!("Several theme files use the name \"{name}\", so it is unclear which one to apply.")));
    }
    let theme_path = theme.path.clone();
    let theme_hash = store::hash(&theme_path)?.unwrap_or_default();
    let parsed = lists::read_theme(&theme_path)?;
    let name = parsed.get("themeName").and_then(Json::as_str).unwrap_or_default().to_string();
    let mut edits = vec![("EStringSettingId::CurrentThemeName".to_string(), Value::One(Scalar::Str(name)))];
    edits.extend(scheme_edits(&parsed)?);
    let (target, settings_hash, settings) = read_settings(engine, context)?;
    let updated = apply_edits(&settings.text, &edits)?;
    let bytes = settings.encoding.encode(&updated);
    let staged = txn::settings_preview_plan(engine, context, &target, &settings_hash, &bytes, "scheme-previews", "Scheme staging must be outside the game directory.")?;
    let Some(plan) = staged else { return Err(EngineError::coded("PLAN_STALE", "准备预览期间背景来源发生了变化。", "Scheme source changed during preview preparation.")) };
    Ok(SchemePlan { theme_path, theme_hash, plan })
}

/// `Invoke-KvkSchemeReplacement`.
pub fn scheme_execute(engine: &Engine, context: &Context, scheme: &SchemePlan, observer: txn::Observer) -> EngineResult<txn::Report> {
    if store::hash(&scheme.theme_path)?.as_deref() != Some(scheme.theme_hash.as_str()) {
        return Err(EngineError::coded("PLAN_STALE", "预览之后主题文件发生了变化，请重新核对。", "The theme file changed after preview; review it again."));
    }
    txn::install(engine, context, &scheme.plan, observer)
}

// ---- Sounds (audio) ------------------------------------------------------------------------

/// `Get-KvkAudioEdit` + `New-KvkAudioPlan`: binds the named sounds to one event.
pub fn audio_plan(engine: &Engine, context: &Context, event: &str, names: &[String]) -> EngineResult<Plan> {
    engine.assert_context(context)?;
    let Some((_, key, list)) = AUDIO_EVENTS.iter().find(|(e, _, _)| eq_ignore_case(e, event)) else {
        return Err(EngineError::coded("ENGINE_ERROR", format!("不支持的音效事件 (unknown audio event): {event}"), format!("Unknown audio event: {event}.")));
    };
    let (_, installed) = lists::installed_sounds(engine, context)?;
    for name in names {
        let bad = name.trim().is_empty() || name.contains(';') || name.chars().any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 0x20);
        if bad { return Err(EngineError::coded("ENGINE_ERROR", format!("音效名称无效 (invalid sound name): {name}"), format!("The sound name is not valid: \"{name}\"."))); }
        let Some(sound) = installed.iter().find(|s| eq_ignore_case(&s.name, name)) else {
            return Err(EngineError::coded("ENGINE_ERROR", format!("游戏 sounds 目录里没有这个音效 (sound not installed): {name}"), format!("This sound is not in the game sounds folder: \"{name}\".")));
        };
        if sound.ambiguous {
            return Err(EngineError::coded("ENGINE_ERROR", format!("有多个文件同名「{name}」，无法确定要绑定哪一个 (ambiguous sound name)"), format!("Two files share the name \"{name}\", so it cannot be bound.")));
        }
    }
    if !list && names.len() != 1 {
        return Err(EngineError::coded("ENGINE_ERROR", format!("{event} 只能绑定一个音效 (this event takes exactly one sound)"), format!("{event} takes exactly one sound.")));
    }
    let (target, settings_hash, settings) = read_settings(engine, context)?;
    if find_value(&settings.text, key)?.is_none() { return Err(missing_key(key)); }
    let updated = set_setting(&settings.text, key, &Value::One(Scalar::Str(names.join(";"))))?;
    let bytes = settings.encoding.encode(&updated);
    let staged = txn::settings_preview_plan(engine, context, &target, &settings_hash, &bytes, "audio-previews", "Audio staging must be outside the game directory.")?;
    staged.ok_or_else(|| EngineError::coded("PLAN_STALE", "准备预览期间音效来源发生了变化。", "Audio source changed during preview preparation."))
}
