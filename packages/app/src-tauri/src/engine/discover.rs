//! Finding the game (`kvk-engine.ps1`: `Get-KvkSteamLibraries`, `Get-KvkCandidates`;
//! `Get-KvkGuiDefaultPack`). Steam's own library list comes first; the usual folders after it.

use std::path::Path;

use super::json::Json;
use super::paths::{self, join};
use super::store::Engine;
use super::text::{eq_ignore_case, TextFile};

/// KovaaK's Steam application id: how a library that holds the game is told from one that exists.
const STEAM_APP_ID: &str = "824270";

/// `^\s*"<key>"\s+"` on one line, returning the text after that opening quote.
fn vdf_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let rest = line.trim_start();
    let quoted = format!("\"{key}\"");
    if rest.len() < quoted.len() || !rest.is_char_boundary(quoted.len()) || !eq_ignore_case(&rest[..quoted.len()], &quoted) { return None; }
    let after = &rest[quoted.len()..];
    let value = after.trim_start();
    if value.len() == after.len() || !value.starts_with('"') { return None; }
    Some(&value[1..])
}

/// `Get-KvkSteamLibraries`: the libraries Steam's `libraryfolders.vdf` lists, those whose apps
/// include the game first. Never fails: no file, or a damaged one, means no libraries.
pub fn steam_libraries(steam_root: &str) -> Vec<String> {
    if steam_root.trim().is_empty() { return Vec::new(); }
    let root = if cfg!(windows) { steam_root.replace('/', "\\") } else { steam_root.to_string() };
    let vdf = join(&root, "steamapps/libraryfolders.vdf");
    let Ok(bytes) = std::fs::read(&vdf) else { return Vec::new() };
    let text = String::from_utf16_lossy(&TextFile::decode(&bytes).text);
    let (mut with_game, mut others) = (Vec::new(), Vec::new());
    let mut pending: Option<String> = None;
    for line in text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)) {
        if let Some(value) = vdf_value(line, "path") {
            // `"(.*)"\s*$`: the path runs to the last quote that only whitespace follows.
            let trimmed = value.trim_end();
            if let Some(path) = trimmed.strip_suffix('"') {
                if let Some(previous) = pending.take() { others.push(previous); }
                // VDF escapes a backslash as two; nothing else in a path needs unescaping.
                pending = Some(path.replace("\\\\", "\\"));
                continue;
            }
        }
        if pending.is_some() && vdf_value(line, STEAM_APP_ID).is_some() {
            with_game.push(pending.take().unwrap_or_default());
        }
    }
    if let Some(previous) = pending { others.push(previous); }
    with_game.extend(others);
    with_game
}

/// `Get-KvkCandidates`: every game folder found, each once.
pub fn candidates(engine: &Engine, local_data_root: &str) -> Vec<String> {
    let mut bases = Vec::new();
    for root in engine.host.steam_roots() {
        for library in steam_libraries(&root) { bases.push(join(&library, "steamapps/common/FPSAimTrainer")); }
    }
    for name in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(value) = engine.host.env(name) { bases.push(join(&value, "Steam/steamapps/common/FPSAimTrainer")); }
    }
    for drive in engine.host.drive_roots() { bases.push(join(&drive, "SteamLibrary/steamapps/common/FPSAimTrainer")); }
    let mut found: Vec<String> = Vec::new();
    for base in bases {
        if let Ok(root) = engine.game_root(&base, Some(local_data_root)) {
            if !found.iter().any(|f| eq_ignore_case(f, &root)) { found.push(root); }
        }
    }
    found
}

/// `Get-KvkGuiDefaultPack`: the `KVK Settings 2025` folder beside the runtime, or one level up.
pub fn default_pack(runtime_root: &str) -> Option<String> {
    let parent = paths::directory_name(runtime_root)?;
    let grandparent = paths::directory_name(&parent);
    for base in std::iter::once(parent).chain(grandparent) {
        if base.trim().is_empty() { continue; }
        let candidate = join(&base, "KVK Settings 2025");
        if Path::new(&candidate).is_dir() { return paths::get_full_path(&candidate).ok(); }
    }
    None
}

pub fn discovery_json(engine: &Engine, local_data_root: &str, runtime_root: &str) -> Json {
    Json::object(vec![
        ("candidates", Json::Array(candidates(engine, local_data_root).into_iter().map(Json::str).collect())),
        ("defaultPack", Json::opt_str(default_pack(runtime_root))),
    ])
}
