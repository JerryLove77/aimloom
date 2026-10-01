//! The Profile store and Profile asset reads (`kvk-engine.ps1`, from `Assert-KvkProfileId` to
//! `Read-KvkProfileAsset`). Profiles are editor documents: nothing here touches the game.
//!
//! A Profile file (and a Profile request) is read with System.Text.Json's strict grammar and
//! `ConvertFrom-KvkProfileElement`'s rules: an exact duplicate key is refused, an integer that
//! fits is an Int64 and any other number a Double. It is written back by `ConvertTo-Json`.

use std::path::Path;

use super::json::{self, Json};
use super::paths::{self, join};
use super::store::{self, Engine};
use super::txn::name_order;
use super::{EngineError, EngineResult};

const MAX_PROFILE_BYTES: usize = 262_144;
const MAX_ASSET_BYTES: u64 = 8 * 1024 * 1024;
const AUDIO_EVENTS: [&str; 6] = ["kill", "spawn", "mbsGood", "mbsOkay", "mbsBad", "mbsChangeNow"];

fn fail(zh: &str, en: &str) -> EngineError { EngineError::coded("ENGINE_ERROR", zh, en) }
fn invalid_path(zh: &str, en: &str) -> EngineError { EngineError::coded("INVALID_PATH", zh, en) }

/// Numbers as `ConvertFrom-KvkProfileElement` types them and `ConvertTo-Json` writes them.
fn canonical_numbers(value: Json) -> Json {
    match value {
        Json::Number(text) => {
            let integer = !text.contains(['.', 'e', 'E']);
            match (integer, text.parse::<i64>()) {
                (true, Ok(i)) => Json::Number(i.to_string()),
                _ => Json::Number(json::newtonsoft_double(text.parse::<f64>().unwrap_or(f64::NAN))),
            }
        }
        Json::Array(items) => Json::Array(items.into_iter().map(canonical_numbers).collect()),
        Json::Object(fields) => Json::Object(fields.into_iter().map(|(k, v)| (k, canonical_numbers(v))).collect()),
        other => other,
    }
}

/// `JsonDocument.Parse` + `ConvertFrom-KvkProfileElement`. `Err(None)` is a syntax error;
/// `Err(Some(_))` the coded duplicate-field refusal.
pub fn parse_strict(text: &str, max_depth: usize) -> Result<Json, Option<EngineError>> {
    let options = json::ReadOptions { strings: json::Strings::Literal, keys: json::Keys::RefuseDuplicates, max_depth };
    match json::parse_with(text, options, json::Grammar::Strict) {
        Ok(value) => Ok(canonical_numbers(value)),
        Err(e) if e.0 == json::DUPLICATE_KEY => Err(Some(fail("Profile JSON 含重复字段。", "The Profile JSON has a duplicate field."))),
        Err(_) => Err(None),
    }
}

fn is_number(value: Option<&Json>) -> bool { matches!(value, Some(Json::Number(_))) }

/// `Assert-KvkProfileId`.
pub fn assert_id(id: Option<&Json>) -> EngineResult<String> {
    let invalid = || invalid_path("Profile 标识无效。", "The Profile id is not valid.");
    let Some(Json::String(id)) = id else { return Err(invalid()) };
    let b = id.as_bytes();
    let head = b.first().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let rest = b.iter().skip(1).all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-');
    let lower = id.to_ascii_lowercase();
    let reserved = ["con", "prn", "aux", "nul"].contains(&lower.as_str())
        || (lower.len() == 4 && (lower.starts_with("com") || lower.starts_with("lpt")) && matches!(lower.as_bytes()[3], b'1'..=b'9'));
    if !head || !rest || b.len() > 64 || reserved { return Err(invalid()); }
    Ok(id.clone())
}

fn keys(value: &Json) -> Vec<String> { match value { Json::Object(f) => f.iter().map(|(k, _)| k.clone()).collect(), _ => Vec::new() } }

/// `Assert-KvkProfileObject`.
fn assert_object(value: Option<&Json>, required: &[&str], optional: &[&str]) -> EngineResult<()> {
    let Some(value @ Json::Object(_)) = value else { return Err(fail("Profile 字段必须是 JSON 对象。", "A Profile field must be a JSON object.")) };
    let present = keys(value);
    for key in required {
        if !present.iter().any(|k| k == key) { return Err(fail(&format!("Profile 缺少字段：{key}"), &format!("The Profile is missing the field: {key}."))); }
    }
    for key in &present {
        if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
            return Err(fail(&format!("Profile 含未知字段：{key}"), &format!("The Profile has an unknown field: {key}.")));
        }
    }
    Ok(())
}

/// `Assert-KvkProfileText`: a non-blank string of at most `limit` UTF-16 units, no NUL, CR or LF.
fn assert_text(value: Option<&Json>, limit: usize, label: &str, label_en: &str) -> EngineResult<String> {
    match value {
        Some(Json::String(s)) if !s.trim().is_empty() && s.encode_utf16().count() <= limit && !s.contains(['\0', '\n', '\r']) => Ok(s.clone()),
        _ => Err(fail(&format!("Profile {label} 文本无效。"), &format!("The Profile {label_en} text is not valid."))),
    }
}

fn is_device_path(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() >= 4 && matches!(b[0], b'\\' | b'/') && matches!(b[1], b'\\' | b'/') && matches!(b[2], b'?' | b'.') && matches!(b[3], b'\\' | b'/')
}

/// `Assert-KvkProfileFile`: a local file path (no URI scheme, no device namespace) with one of
/// the kind's extensions.
fn assert_file(value: Option<&Json>, extensions: &[&str]) -> EngineResult<()> {
    let text = assert_text(value, 4096, "文件引用", "file reference")?;
    if is_device_path(&text) { return Err(fail("Profile 文件引用不允许设备命名空间。", "A Profile file reference may not use the device namespace.")); }
    let b = text.as_bytes();
    let scheme_len = b.iter().position(|&c| c == b':');
    let looks_like_scheme = b.first().is_some_and(u8::is_ascii_alphabetic)
        && scheme_len.is_some_and(|n| b[..n].iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'.' | b'-')));
    let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/');
    let ext = paths::extension(&text);
    if (looks_like_scheme && !drive) || !extensions.iter().any(|e| ext.eq_ignore_ascii_case(e)) {
        return Err(fail("Profile 文件引用格式或扩展名无效。", "A Profile file reference has an invalid format or extension."));
    }
    Ok(())
}

fn assert_reference(value: Option<&Json>, extensions: &[&str]) -> EngineResult<()> {
    assert_object(value, &["name", "path"], &[])?;
    let value = value.unwrap_or(&Json::Null);
    assert_text(value.get("name"), 4096, "名称", "name")?;
    assert_file(value.get("path"), extensions)
}

/// `Assert-KvkProfile` (format v2, a complete snapshot): `theme` and `audio` are required, all
/// six events are required, the MBS events hold exactly one sound, and no other key is accepted.
pub fn assert_profile(profile: &Json) -> EngineResult<()> {
    // The version is judged first, so a v1 file (which also carries crosshair/enemy) is reported
    // as an unsupported version, not as an unknown field.
    let version_two = || is_number(profile.get("schemaVersion")) && profile.get("schemaVersion").and_then(Json::number).is_some_and(|n| match n {
        json::Number::Int(i) => i == 2, json::Number::Double(d) => d == 2.0, json::Number::Big => false,
    });
    let unsupported = || fail("不支持此 Profile 版本。", "This Profile version is not supported.");
    if profile.get("schemaVersion").is_some() && !version_two() { return Err(unsupported()); }
    assert_object(Some(profile), &["schemaVersion", "id", "name", "theme", "audio"], &[])?;
    if !version_two() { return Err(unsupported()); }
    assert_id(profile.get("id"))?;
    assert_text(profile.get("name"), 128, "名称", "name")?;
    assert_reference(profile.get("theme"), &[".json"])?;
    let audio = profile.get("audio");
    assert_object(audio, &AUDIO_EVENTS, &[])?;
    let audio = audio.unwrap_or(&Json::Null);
    for key in AUDIO_EVENTS {
        let Some(Json::Array(files)) = audio.get(key) else { return Err(fail("Profile 音效必须是最多 64 项的数组。", "Profile sounds must be an array of at most 64 entries.")) };
        if files.len() > 64 { return Err(fail("Profile 音效必须是最多 64 项的数组。", "Profile sounds must be an array of at most 64 entries.")); }
        if key.starts_with("mbs") && files.len() != 1 { return Err(fail("Profile 的 MBS 音效必须恰好一项。", "A Profile MBS sound must have exactly one entry.")); }
        for file in files { assert_reference(Some(file), &[".wav", ".ogg"])?; }
    }
    if profile.to_compact().len() > MAX_PROFILE_BYTES { return Err(fail("Profile JSON 超过 256 KiB。", "The Profile JSON is larger than 256 KiB.")); }
    Ok(())
}

fn assert_safe(path: &str) -> EngineResult<()> {
    paths::assert_safe_path(path).map_err(|_| invalid_path("Profile 路径不安全，不允许链接或重解析点。", "The Profile path is not safe; links and reparse points are not allowed."))
}

/// `Read-KvkProfileFile`.
pub fn read_file(path: &str, id: &str) -> EngineResult<Json> {
    assert_safe(path)?;
    if Path::new(path).is_dir() { return Err(fail("Profile 路径不是文件。", "The Profile path is not a file.")); }
    let bytes = std::fs::read(path).map_err(|e| EngineError::io(&e))?;
    if bytes.len() > MAX_PROFILE_BYTES { return Err(fail("Profile JSON 超过 256 KiB。", "The Profile JSON is larger than 256 KiB.")); }
    // A strict UTF-8 reader: invalid bytes are an I/O failure, not a damaged document.
    let text = String::from_utf8(bytes).map_err(|_| EngineError::plain("Unable to translate bytes to Unicode."))?;
    let damaged = || fail("Profile JSON 已损坏或无法读取。", "The Profile JSON is damaged or could not be read.");
    let profile = match parse_strict(&text, 64) { Ok(p) => p, Err(Some(coded)) => return Err(coded), Err(None) => return Err(damaged()) };
    assert_profile(&profile)?;
    if profile.get("id").and_then(Json::as_str) != Some(id) { return Err(fail("Profile 标识与文件名不一致。", "The Profile id does not match its file name.")); }
    Ok(profile)
}

/// `Get-KvkProfileDirectory`.
pub fn directory(engine: &Engine, local_data_root: &str) -> EngineResult<String> {
    let base = paths::get_full_path(local_data_root).and_then(|l| engine.data_root(&l))
        .map_err(|_| invalid_path("Profile 存储目录无效。", "The Profile store folder is not valid."))?;
    let dir = join(&base, "profiles");
    assert_safe(&dir)?;
    let mut ancestor = Some(dir.clone());
    while let Some(a) = ancestor {
        if Path::new(&a).is_file() { return Err(fail("Profile 存储目录被文件占用。", "A file is in the way of the Profile store folder.")); }
        ancestor = paths::directory_name(&a).filter(|p| *p != a);
    }
    Ok(dir)
}

fn profile_path(engine: &Engine, local_data_root: &str, id: Option<&Json>) -> EngineResult<String> {
    let id = assert_id(id)?;
    let path = join(&directory(engine, local_data_root)?, &format!("{id}.json"));
    assert_safe(&path)?;
    Ok(path)
}

/// `Get-KvkProfiles`: every Profile that reads, and a row per file that does not.
pub fn list(engine: &Engine, local_data_root: &str) -> EngineResult<Json> {
    let dir = directory(engine, local_data_root)?;
    if Path::new(&dir).is_file() { return Err(fail("Profile 存储目录被文件占用。", "A file is in the way of the Profile store folder.")); }
    let (mut profiles, mut errors) = (Vec::new(), Vec::new());
    if Path::new(&dir).is_dir() {
        let mut names: Vec<String> = std::fs::read_dir(&dir).map_err(|e| EngineError::io(&e))?.flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.to_ascii_lowercase().ends_with(".json")).collect();
        names.sort_by(|a, b| name_order(a, b));
        for name in names {
            let result = (|| {
                let id = assert_id(Some(&Json::str(&name[..name.len() - 5])))?;
                if name != format!("{id}.json") { return Err(fail("Profile 文件名无效。", "The Profile file name is not valid.")); }
                read_file(&join(&dir, &name), &id)
            })();
            match result {
                Ok(profile) => profiles.push(profile),
                Err(e) => errors.push(Json::object(vec![("fileName", Json::str(&name)), ("message", Json::str(&e.message)), ("messageEn", Json::str(e.english()))])),
            }
        }
    }
    Ok(Json::object(vec![("directory", Json::str(dir)), ("profiles", Json::Array(profiles)), ("errors", Json::Array(errors))]))
}

/// `Get-KvkProfile`.
pub fn read(engine: &Engine, local_data_root: &str, id: Option<&Json>) -> EngineResult<Json> {
    let path = profile_path(engine, local_data_root, id)?;
    if Path::new(&path).is_dir() { return Err(fail("Profile 路径不是文件。", "The Profile path is not a file.")); }
    let profile = if Path::new(&path).is_file() { read_file(&path, id.and_then(Json::as_str).unwrap_or_default())? } else { Json::Null };
    Ok(Json::object(vec![("filePath", Json::str(path)), ("profile", profile)]))
}

/// `Save-KvkProfile`: validated, written to a temporary file, read back, then moved into place.
/// An existing damaged Profile is never replaced silently.
pub fn save(engine: &Engine, local_data_root: &str, profile: Option<&Json>) -> EngineResult<Json> {
    let profile = profile.cloned().unwrap_or(Json::Null);
    assert_profile(&profile)?;
    let id = profile.get("id").and_then(Json::as_str).unwrap_or_default().to_string();
    let path = profile_path(engine, local_data_root, profile.get("id"))?;
    read(engine, local_data_root, profile.get("id"))?;
    let text = profile.to_compact();
    let dir = paths::directory_name(&path).unwrap_or_default();
    let temporary = join(&dir, &format!(".{id}.{}.tmp", store::new_guid()));
    let result = (|| -> EngineResult<Json> {
        store::new_directory(&dir)?;
        assert_safe(&temporary)?;
        super::platform::write_new_durable(Path::new(&temporary), text.as_bytes()).map_err(|e| EngineError::io(&e))?;
        let validated = read_file(&temporary, &id)?;
        assert_safe(&path)?;
        read(engine, local_data_root, profile.get("id"))?;
        std::fs::rename(&temporary, &path).map_err(|e| EngineError::io(&e))?;
        Ok(Json::object(vec![("filePath", Json::str(&path)), ("profile", validated)]))
    })();
    if Path::new(&temporary).is_file() { let _ = std::fs::remove_file(&temporary); }
    result.map_err(|e: EngineError| if e.classified { e } else { fail("无法保存 Profile，原有文件已保留。", "The Profile could not be saved; the existing file is unchanged.") })
}

/// `Remove-KvkProfile`.
pub fn delete(engine: &Engine, local_data_root: &str, id: Option<&Json>) -> EngineResult<Json> {
    let path = profile_path(engine, local_data_root, id)?;
    if Path::new(&path).is_dir() { return Err(fail("Profile 路径不是文件。", "The Profile path is not a file.")); }
    let exists = Path::new(&path).is_file();
    if exists { assert_safe(&path)?; std::fs::remove_file(&path).map_err(|e| EngineError::io(&e))?; }
    Ok(Json::object(vec![("deleted", Json::Bool(exists))]))
}

// ---- Assets --------------------------------------------------------------------------------

/// `Get-KvkProfileAssetExtensions`.
pub fn asset_extensions(kind: Option<&Json>) -> EngineResult<&'static [&'static str]> {
    match kind.and_then(Json::as_str) {
        Some("audio") => Ok(&[".wav", ".ogg"]),
        Some("crosshair") => Ok(&[".png"]),
        Some("theme" | "enemy") => Ok(&[".json"]),
        _ => Err(fail("资源类型无效。", "The asset kind is not valid.")),
    }
}

/// `[IO.Path]::IsPathFullyQualified` on this platform.
fn is_fully_qualified(path: &str) -> bool {
    #[cfg(windows)]
    {
        let b = path.as_bytes();
        let sep = |c: u8| c == b'\\' || c == b'/';
        (b.len() >= 2 && sep(b[0]) && sep(b[1])) || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && sep(b[2]))
    }
    #[cfg(not(windows))]
    { path.starts_with('/') }
}

/// `Get-KvkProfileAssetPath`: the full path of an ordinary local file, refusing device paths,
/// stray colons, wildcard characters and unsafe segments.
pub fn asset_path(path: Option<&Json>) -> EngineResult<String> {
    let text = assert_text(path, 4096, "资源路径", "asset path")?;
    let refuse = || invalid_path("请选择普通文件的完整路径。", "Choose the full path of an ordinary file.");
    if !is_fully_qualified(&text) || is_device_path(&text) { return Err(refuse()); }
    if text.chars().any(|c| (c as u32) < 0x20 || matches!(c, '<' | '>' | '"' | '|' | '?' | '*')) { return Err(refuse()); }
    let b = text.as_bytes();
    if b.iter().enumerate().any(|(i, &c)| c == b':' && !(i == 1 && b[0].is_ascii_alphabetic())) { return Err(refuse()); }
    for part in text.split(['\\', '/']) {
        let upper = part.to_ascii_uppercase();
        let stem = upper.split('.').next().unwrap_or("");
        let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem)
            || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if part == "." || part == ".." || part.ends_with('.') || part.ends_with(' ') || reserved {
            return Err(invalid_path("资源路径含不安全的文件名。", "The asset path contains an unsafe file name."));
        }
    }
    let full = paths::get_full_path(&text)?;
    assert_safe(&full)?;
    Ok(full)
}

/// `Get-KvkProfileAssetInfo`: an ordinary file of the kind's type, 1 byte to 8 MiB.
fn asset_info(kind: Option<&Json>, path: Option<&Json>) -> EngineResult<String> {
    let extensions = asset_extensions(kind)?;
    let full = asset_path(path)?;
    let ext = paths::extension(&full);
    if !extensions.iter().any(|e| ext.eq_ignore_ascii_case(e)) { return Err(invalid_path("资源扩展名与类型不匹配。", "The asset extension does not match its kind.")); }
    let meta = std::fs::metadata(&full).map_err(|_| EngineError::plain(format!("Cannot find path '{full}' because it does not exist.")))?;
    if !meta.is_file() { return Err(invalid_path("资源必须是普通文件。", "The asset must be an ordinary file.")); }
    if meta.len() == 0 || meta.len() > MAX_ASSET_BYTES { return Err(fail("资源文件必须非空且不超过 8 MiB。", "The asset file must not be empty and must be 8 MiB or smaller.")); }
    Ok(full)
}

/// `Read-KvkProfileAssetBytes`.
pub fn asset_bytes(kind: Option<&Json>, path: Option<&Json>) -> EngineResult<(String, Vec<u8>)> {
    let full = asset_info(kind, path)?;
    assert_safe(&full)?;
    let bytes = std::fs::read(&full).map_err(|e| EngineError::io(&e))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_ASSET_BYTES { return Err(fail("资源文件必须非空且不超过 8 MiB。", "The asset file must not be empty and must be 8 MiB or smaller.")); }
    Ok((full, bytes))
}

/// `Get-KvkProfileAssets`: the kind's files in a folder, and a row per candidate that fails.
pub fn asset_list(kind: Option<&Json>, directory: Option<&Json>) -> EngineResult<Json> {
    let extensions = asset_extensions(kind)?;
    let full = asset_path(directory)?;
    if !Path::new(&full).is_dir() { return Err(invalid_path("资源目录不存在。", "The asset folder does not exist.")); }
    // NTFS lists a folder in upper-cased name order; the same order here on every host.
    let mut names: Vec<String> = std::fs::read_dir(&full).map_err(|e| EngineError::io(&e))?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort_by(|a, b| name_order(a, b));
    let (mut files, mut errors, mut count) = (Vec::new(), Vec::new(), 0);
    for name in names {
        let path = join(&full, &name);
        if !extensions.iter().any(|e| paths::extension(&name).eq_ignore_ascii_case(e)) { continue; }
        count += 1;
        if count > 1000 { return Err(fail("资源目录超过 1000 个候选文件，请选择更小的目录。", "The asset folder has more than 1000 candidate files. Choose a smaller folder.")); }
        match asset_info(kind, Some(&Json::str(&path))) {
            Ok(found) => files.push((paths::file_name(&found), found)),
            Err(e) => errors.push(Json::object(vec![("fileName", Json::str(&name)), ("message", Json::str(&e.message)), ("messageEn", Json::str(e.english()))])),
        }
    }
    files.sort_by(|a, b| name_order(&a.0, &b.0));
    let files = files.into_iter().map(|(n, p)| Json::object(vec![("name", Json::str(n)), ("path", Json::str(p))])).collect();
    Ok(Json::object(vec![("directory", Json::str(full)), ("files", Json::Array(files)), ("errors", Json::Array(errors))]))
}

/// `Read-KvkProfileAsset`: the file as base64, with its MIME type.
pub fn asset_read(kind: Option<&Json>, path: Option<&Json>) -> EngineResult<Json> {
    let (full, bytes) = asset_bytes(kind, path)?;
    let mime = match paths::extension(&full).to_ascii_lowercase().as_str() {
        ".json" => Json::str("application/json"), ".png" => Json::str("image/png"), ".wav" => Json::str("audio/wav"), ".ogg" => Json::str("audio/ogg"), _ => Json::Null,
    };
    Ok(Json::object(vec![("path", Json::str(full)), ("mimeType", mime), ("base64", Json::str(base64(&bytes)))]))
}

/// Standard base64 with padding (`[Convert]::ToBase64String`).
pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() { out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char); } else { out.push('='); }
        }
    }
    out
}
