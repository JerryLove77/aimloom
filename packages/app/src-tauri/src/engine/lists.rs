//! The read-only lists of what is installed: themes (`kvk-scheme.ps1`), sounds and their
//! bindings (`kvk-audio.ps1`) and crosshairs (`kvk-crosshair.ps1`).

use std::path::Path;

use super::json::{self, Json};
use super::paths::{self, join};
use super::store::{enumerate_files, Context, Engine};
use super::text::{eq_ignore_case, find_value, TextFile};
use super::{EngineError, EngineResult};

/// Sound events, in the order the App shows them, and the setting each is stored under.
/// Kill and Spawn hold a `;`-separated list; the MBS events hold one name.
pub const AUDIO_EVENTS: [(&str, &str, bool); 6] = [
    ("kill", "EStringSettingId::KillConfirmedSound", true),
    ("spawn", "EStringSettingId::SpawnSound", true),
    ("mbsGood", "EStringSettingId::MBSGoodSound", false),
    ("mbsOkay", "EStringSettingId::MBSOkaySound", false),
    ("mbsBad", "EStringSettingId::MBSBadSound", false),
    ("mbsChangeNow", "EStringSettingId::MBSChangeNowSound", false),
];

fn settings_text(engine: &Engine, context: &Context) -> EngineResult<Option<Vec<u16>>> {
    let target = engine.target(context, "primary/PrimaryUserSettings.json")?;
    if !Path::new(&target).is_file() { return Ok(None); }
    Ok(Some(TextFile::decode(&std::fs::read(&target).map_err(|e| EngineError::io(&e))?).text))
}

/// The raw text between the quotes of a string setting, as the PowerShell adapters read it (no
/// unescaping), or `None` when the key is missing or its value is not a string.
fn raw_string_setting(text: &[u16], key: &str) -> EngineResult<Option<String>> {
    let Some(span) = find_value(text, key)? else { return Ok(None) };
    if text[span.value_start] != b'"' as u16 { return Ok(None); }
    Ok(Some(String::from_utf16_lossy(&text[span.value_start + 1..span.value_end - 1])))
}

/// `Read-KvkThemeFile`: a theme is a JSON object with a non-blank `themeName`.
pub fn read_theme(path: &str) -> EngineResult<Json> {
    let file_name = paths::file_name(path);
    let file = TextFile::decode(&std::fs::read(path).map_err(|e| EngineError::io(&e))?);
    let options = json::ReadOptions { strings: json::Strings::Literal, keys: json::Keys::KeepCaseVariants, max_depth: 32 };
    let theme = json::parse(&String::from_utf16_lossy(&file.text), options).map_err(|_| {
        EngineError::coded("ENGINE_ERROR", format!("主题文件不是有效的 JSON: {file_name}"), format!("The theme file is not valid JSON: \"{file_name}\"."))
    })?;
    if !matches!(theme, Json::Object(_)) {
        return Err(EngineError::coded("ENGINE_ERROR", format!("主题文件必须是一个 JSON 对象: {file_name}"), format!("The theme file must be a JSON object: \"{file_name}\".")));
    }
    if !theme.get("themeName").and_then(Json::as_str).is_some_and(|n| !n.trim().is_empty()) {
        return Err(EngineError::coded("ENGINE_ERROR", format!("主题文件缺少 themeName: {file_name}"), format!("The theme file has no themeName: \"{file_name}\".")));
    }
    Ok(theme)
}

pub struct InstalledTheme { pub name: Option<String>, pub file: String, pub path: String, pub readable: bool, pub duplicate_name: bool }

pub struct Themes { pub directory: String, pub themes: Vec<InstalledTheme>, pub current: Option<String> }

/// `Get-KvkInstalledThemes`.
pub fn installed_themes(engine: &Engine, context: &Context) -> EngineResult<Themes> {
    engine.assert_context(context)?;
    let directory = join(&context.game_root, "FPSAimTrainer/Saved/SaveGames/Themes");
    let mut themes = Vec::new();
    if Path::new(&directory).is_dir() {
        for path in enumerate_files(&directory, ".json")? {
            let name = read_theme(&path).ok().and_then(|t| t.get("themeName").and_then(Json::as_str).map(str::to_string));
            themes.push(InstalledTheme { readable: name.is_some(), name, file: paths::file_name(&path), path, duplicate_name: false });
        }
    }
    let names: Vec<String> = themes.iter().filter_map(|t| t.name.clone()).collect();
    for theme in &mut themes {
        if let Some(name) = &theme.name { theme.duplicate_name = names.iter().filter(|n| eq_ignore_case(n, name)).count() > 1; }
    }
    // Resolving the settings path may fail the list; reading it may not: a settings file that
    // cannot be read leaves the current theme unknown.
    let target = engine.target(context, "primary/PrimaryUserSettings.json")?;
    let current = if Path::new(&target).is_file() {
        std::fs::read(&target).ok().and_then(|bytes| raw_string_setting(&TextFile::decode(&bytes).text, "EStringSettingId::CurrentThemeName").ok().flatten())
    } else { None };
    Ok(Themes { directory, themes, current })
}

pub fn theme_list_json(themes: &Themes) -> Json {
    Json::object(vec![
        ("directory", Json::str(&themes.directory)),
        ("current", Json::opt_str(themes.current.clone())),
        ("themes", Json::Array(themes.themes.iter().map(|t| Json::object(vec![
            ("name", Json::opt_str(t.name.clone())), ("file", Json::str(&t.file)), ("path", Json::str(&t.path)),
            ("readable", Json::Bool(t.readable)), ("duplicateName", Json::Bool(t.duplicate_name)),
        ])).collect())),
    ])
}

pub struct InstalledSound { pub name: String, pub file: String, pub path: String, pub ambiguous: bool }

/// `Get-KvkInstalledSounds`: one entry per name; a second file with the same name (the other
/// extension, or another case) marks it ambiguous.
pub fn installed_sounds(engine: &Engine, context: &Context) -> EngineResult<(String, Vec<InstalledSound>)> {
    engine.assert_context(context)?;
    let directory = join(&context.game_root, "FPSAimTrainer/sounds");
    let mut sounds: Vec<InstalledSound> = Vec::new();
    if Path::new(&directory).is_dir() {
        for path in enumerate_files(&directory, "")? {
            let file = paths::file_name(&path);
            let ext = paths::extension(&file);
            if !eq_ignore_case(&ext, ".ogg") && !eq_ignore_case(&ext, ".wav") { continue; }
            let name = file[..file.len() - ext.len()].to_string();
            if name.trim().is_empty() { continue; }
            match sounds.iter_mut().find(|s| eq_ignore_case(&s.name, &name)) {
                Some(existing) => existing.ambiguous = true,
                None => sounds.push(InstalledSound { name, file, path, ambiguous: false }),
            }
        }
    }
    sounds.sort_by(|a, b| super::txn::name_order(&a.name, &b.name));
    Ok((directory, sounds))
}

/// `Get-KvkAudioBindings`: every event's stored names, in event order.
pub fn audio_bindings(engine: &Engine, context: &Context) -> EngineResult<Json> {
    let text = settings_text(engine, context)?;
    let mut fields = Vec::new();
    for (event, key, _) in AUDIO_EVENTS {
        let mut names = Vec::new();
        if let Some(text) = &text {
            // An empty list is stored as an empty string, so it splits to no names.
            if let Some(stored) = raw_string_setting(text, key)? { if !stored.is_empty() { names = stored.split(';').map(Json::str).collect(); } }
        }
        fields.push((event.to_string(), Json::Array(names)));
    }
    Ok(Json::Object(fields))
}

pub fn audio_list_json(engine: &Engine, context: &Context) -> EngineResult<Json> {
    let (directory, sounds) = installed_sounds(engine, context)?;
    Ok(Json::object(vec![
        ("directory", Json::str(directory)),
        ("sounds", Json::Array(sounds.iter().map(|s| Json::object(vec![
            ("name", Json::str(&s.name)), ("file", Json::str(&s.file)), ("path", Json::str(&s.path)), ("ambiguous", Json::Bool(s.ambiguous)),
        ])).collect())),
        ("bindings", audio_bindings(engine, context)?),
    ]))
}

/// `Get-KvkInstalledCrosshairs`.
pub fn crosshair_list_json(engine: &Engine, context: &Context) -> EngineResult<Json> {
    engine.assert_context(context)?;
    let directory = join(&context.game_root, "FPSAimTrainer/crosshairs");
    let mut rows = Vec::new();
    if Path::new(&directory).is_dir() {
        for path in enumerate_files(&directory, ".png")? {
            let file = paths::file_name(&path);
            let name = file[..file.len() - paths::extension(&file).len()].to_string();
            rows.push(Json::object(vec![("name", Json::str(name)), ("file", Json::str(file)), ("path", Json::str(path))]));
        }
    }
    Ok(Json::object(vec![("directory", Json::str(directory)), ("crosshairs", Json::Array(rows))]))
}
