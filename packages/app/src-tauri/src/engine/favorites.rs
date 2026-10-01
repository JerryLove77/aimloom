//! Favourite themes and sounds (`profileFavoritesRead` / `profileFavoritesSave`): the file names
//! a player starred on Theme and Sounds, kept in `<data root>/favorites.json` so that an
//! uninstall (which may clear WebView storage) does not lose them. Like a Profile, this is an
//! editor document: nothing here touches the game or the backups.
//!
//! The file is `{"schemaVersion":1,"theme":[file…],"audio":[file…]}`, read with the Profile
//! store's strict grammar. A missing file is two empty lists; a damaged one is an error the
//! player sees, never silently replaced.

use std::path::Path;

use super::json::Json;
use super::paths::{self, join};
use super::profiles::parse_strict;
use super::store::{self, Engine};
use super::text::eq_ignore_case;
use super::{EngineError, EngineResult};

/// The most names one list holds.
pub const MAX_ENTRIES: usize = 500;
/// The largest favourites file read or written.
pub const MAX_BYTES: usize = 64 * 1024;

fn fail(zh: &str, en: &str) -> EngineError { EngineError::coded("ENGINE_ERROR", zh, en) }

fn damaged() -> EngineError {
    fail("收藏文件已损坏，没有读取，也不会覆盖它。删除数据文件夹里的 favorites.json 后会从空的收藏开始。",
        "The favourites file is damaged. It was not read and will not be overwritten. Deleting favorites.json in the data folder starts again with no favourites.")
}

fn assert_safe(path: &str) -> EngineResult<()> {
    paths::assert_safe_path(path).map_err(|_| EngineError::coded("INVALID_PATH", "收藏文件路径不安全，不允许链接或重解析点。", "The favourites path is not safe; links and reparse points are not allowed."))
}

fn file_path(engine: &Engine, local_data_root: &str) -> EngineResult<String> {
    let base = paths::get_full_path(local_data_root).and_then(|l| engine.data_root(&l))
        .map_err(|_| EngineError::coded("INVALID_PATH", "数据文件夹无效。", "The data folder is not valid."))?;
    let path = join(&base, "favorites.json");
    assert_safe(&path)?;
    Ok(path)
}

/// One list: at most `MAX_ENTRIES` distinct safe file names of the list's kind.
fn names(value: Option<&Json>, extensions: &[&str]) -> Option<Vec<String>> {
    let Some(Json::Array(items)) = value else { return None };
    if items.len() > MAX_ENTRIES { return None; }
    let mut out: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        let Json::String(name) = item else { return None };
        let bad = name.trim().is_empty() || name.encode_utf16().count() > 128 || paths::assert_file_name(name).is_err()
            || name.starts_with(' ') || !extensions.iter().any(|e| eq_ignore_case(&paths::extension(name), e))
            || out.iter().any(|n| eq_ignore_case(n, name));
        if bad { return None; }
        out.push(name.clone());
    }
    Some(out)
}

/// `{theme, audio}`, exactly those two keys.
fn lists(value: &Json) -> Option<(Vec<String>, Vec<String>)> {
    let Json::Object(fields) = value else { return None };
    if fields.len() != 2 { return None; }
    Some((names(value.get("theme"), &[".json"])?, names(value.get("audio"), &[".wav", ".ogg"])?))
}

fn reply(theme: &[String], audio: &[String]) -> Json {
    let list = |names: &[String]| Json::Array(names.iter().map(Json::str).collect());
    Json::object(vec![("favorites", Json::object(vec![("theme", list(theme)), ("audio", list(audio))]))])
}

fn read_lists(path: &str) -> EngineResult<(Vec<String>, Vec<String>)> {
    if Path::new(path).is_dir() { return Err(fail("收藏文件的位置被一个文件夹占用。", "A folder is in the way of the favourites file.")); }
    if !Path::new(path).is_file() { return Ok((Vec::new(), Vec::new())); }
    let bytes = std::fs::read(path).map_err(|e| EngineError::io(&e))?;
    if bytes.len() > MAX_BYTES { return Err(damaged()); }
    let text = String::from_utf8(bytes).map_err(|_| damaged())?;
    let file = parse_strict(&text, 8).map_err(|_| damaged())?;
    let Json::Object(fields) = &file else { return Err(damaged()) };
    let version_one = matches!(file.get("schemaVersion").and_then(Json::number), Some(super::json::Number::Int(1)));
    if fields.len() != 3 || !version_one { return Err(damaged()); }
    let body = Json::object(vec![("theme", file.get("theme").cloned().unwrap_or(Json::Null)), ("audio", file.get("audio").cloned().unwrap_or(Json::Null))]);
    lists(&body).ok_or_else(damaged)
}

/// `profileFavoritesRead`.
pub fn read(engine: &Engine, local_data_root: &str) -> EngineResult<Json> {
    let (theme, audio) = read_lists(&file_path(engine, local_data_root)?)?;
    Ok(reply(&theme, &audio))
}

/// `profileFavoritesSave`: replaces both lists, through a checked temporary file. A damaged file
/// is refused rather than overwritten, so the player decides what happens to it.
pub fn save(engine: &Engine, local_data_root: &str, favorites: Option<&Json>) -> EngineResult<Json> {
    let Some((theme, audio)) = favorites.and_then(lists) else {
        return Err(fail("收藏列表无效：每类最多 500 个不重复的文件名，背景为 .json，音效为 .wav 或 .ogg。",
            "The favourites are not valid: at most 500 distinct file names each, .json for themes and .wav or .ogg for sounds."));
    };
    let path = file_path(engine, local_data_root)?;
    read_lists(&path)?;
    let list = |names: &[String]| Json::Array(names.iter().map(Json::str).collect());
    let text = Json::object(vec![("schemaVersion", Json::int(1)), ("theme", list(&theme)), ("audio", list(&audio))]).to_compact();
    if text.len() > MAX_BYTES { return Err(fail("收藏列表太大，没有保存。", "The favourites are too large to save.")); }
    let dir = paths::directory_name(&path).unwrap_or_default();
    let temporary = join(&dir, &format!(".favorites.{}.tmp", store::new_guid()));
    let result = (|| -> EngineResult<Json> {
        store::new_directory(&dir)?;
        assert_safe(&temporary)?;
        super::platform::write_new_durable(Path::new(&temporary), text.as_bytes()).map_err(|e| EngineError::io(&e))?;
        let written = read_lists(&temporary)?;
        if written != (theme.clone(), audio.clone()) { return Err(EngineError::plain("Favourites read-back verification failed.")); }
        assert_safe(&path)?;
        std::fs::rename(&temporary, &path).map_err(|e| EngineError::io(&e))?;
        Ok(reply(&theme, &audio))
    })();
    if Path::new(&temporary).is_file() { let _ = std::fs::remove_file(&temporary); }
    result.map_err(|e| if e.classified { e } else { fail("无法保存收藏，原有文件已保留。", "The favourites could not be saved; the existing file is unchanged.") })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::installer::protocol::is_english;

    struct NoHost;
    impl super::super::store::Host for NoHost {
        fn process_names(&self) -> std::io::Result<Vec<String>> { Ok(Vec::new()) }
    }

    fn setup() -> (Engine, std::path::PathBuf, String) {
        let root = super::super::paths::temp_dir_without_links().join(format!("kvk-favorites-{}", store::new_guid()));
        std::fs::create_dir_all(&root).unwrap();
        let local = root.to_string_lossy().into_owned();
        (Engine::new(Box::new(NoHost)), root, local)
    }

    fn favorites(theme: &[&str], audio: &[&str]) -> Json {
        Json::object(vec![("theme", Json::Array(theme.iter().map(|n| Json::str(*n)).collect())), ("audio", Json::Array(audio.iter().map(|n| Json::str(*n)).collect()))])
    }

    #[test]
    fn a_missing_file_reads_as_no_favourites_and_a_save_round_trips() {
        let (engine, root, local) = setup();
        assert_eq!(read(&engine, &local).unwrap().to_compact(), r#"{"favorites":{"theme":[],"audio":[]}}"#);
        assert!(!root.join("Aimloom").exists(), "reading creates nothing");
        let saved = save(&engine, &local, Some(&favorites(&["Clean Dark.json", "蓝色训练室.json"], &["hit.wav", "Bell5.ogg"]))).unwrap();
        assert_eq!(saved.to_compact(), r#"{"favorites":{"theme":["Clean Dark.json","蓝色训练室.json"],"audio":["hit.wav","Bell5.ogg"]}}"#);
        assert_eq!(read(&engine, &local).unwrap(), saved);
        assert_eq!(std::fs::read_to_string(root.join("Aimloom/favorites.json")).unwrap(),
            r#"{"schemaVersion":1,"theme":["Clean Dark.json","蓝色训练室.json"],"audio":["hit.wav","Bell5.ogg"]}"#);
        save(&engine, &local, Some(&favorites(&[], &[]))).unwrap();
        assert_eq!(read(&engine, &local).unwrap().to_compact(), r#"{"favorites":{"theme":[],"audio":[]}}"#);
        let leftovers: Vec<_> = std::fs::read_dir(root.join("Aimloom")).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "no temporary file stays: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_save_refuses_names_that_are_not_safe_files_of_their_kind_and_over_the_limit() {
        let (engine, root, local) = setup();
        let five_hundred: Vec<String> = (0..500).map(|i| format!("{i}.wav")).collect();
        let refs: Vec<&str> = five_hundred.iter().map(String::as_str).collect();
        save(&engine, &local, Some(&favorites(&[], &refs))).unwrap();
        let mut over = five_hundred.clone();
        over.push("500.wav".into());
        let over_refs: Vec<&str> = over.iter().map(String::as_str).collect();
        for bad in [
            favorites(&[], &over_refs), favorites(&["a.wav"], &[]), favorites(&[], &["a.json"]), favorites(&["../a.json"], &[]),
            favorites(&["a/b.json"], &[]), favorites(&["A.json", "a.JSON"], &[]), favorites(&[""], &[]), favorites(&["CON.json"], &[]),
            Json::object(vec![("theme", Json::Array(Vec::new()))]),
            Json::object(vec![("theme", Json::Array(Vec::new())), ("audio", Json::Array(Vec::new())), ("crosshair", Json::Array(Vec::new()))]),
            Json::object(vec![("theme", Json::Array(vec![Json::int(1)])), ("audio", Json::Array(Vec::new()))]),
        ] {
            let error = save(&engine, &local, Some(&bad)).unwrap_err();
            assert!(error.classified && is_english(&error.english()), "{}", bad.to_compact());
        }
        assert_eq!(read(&engine, &local).unwrap().get("favorites").and_then(|f| f.get("audio")).and_then(Json::as_array).unwrap().len(), 500, "a refused save changes nothing");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_damaged_file_is_reported_in_both_languages_and_never_overwritten() {
        let (engine, root, local) = setup();
        let file = root.join("Aimloom/favorites.json");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        for bytes in [&b"{ not json"[..], br#"{"schemaVersion":2,"theme":[],"audio":[]}"#, br#"{"schemaVersion":1,"theme":[]}"#,
            br#"{"schemaVersion":1,"theme":[],"audio":[],"theme":[]}"#, br#"{"schemaVersion":1,"theme":["x.wav"],"audio":[]}"#, &[0xFF, 0xFE, 0x00]] {
            std::fs::write(&file, bytes).unwrap();
            let error = read(&engine, &local).unwrap_err();
            assert!(error.message.contains("收藏文件已损坏") && is_english(&error.english()), "{error:?}");
            assert!(save(&engine, &local, Some(&favorites(&[], &[]))).is_err());
            assert_eq!(std::fs::read(&file).unwrap(), bytes, "a damaged file stays as it was");
        }
        std::fs::write(&file, vec![b' '; MAX_BYTES + 1]).unwrap();
        assert!(read(&engine, &local).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
