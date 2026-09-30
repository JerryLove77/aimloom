//! Backup manifests (`kvk-engine.ps1`: `Get-KvkManifestPath` … `New-KvkRecord`).
//!
//! A manifest stays a [`Json`] value rather than a Rust struct on purpose: the PowerShell engine
//! reads a manifest into an object and writes back every property in the order it found them,
//! so a manifest written by either engine must survive the other's read-and-save byte for byte.

use std::path::Path;

use super::json::{self, Json};
use super::paths::{self, assert_safe_path, join};
use super::store::{self, Context, Engine};
use super::text::eq_ignore_case;
use super::{EngineError, EngineResult};

pub const UNFINISHED: [&str; 3] = ["prepared", "applying", "recovery-required"];

/// `Get-KvkManifestPath`.
pub fn path(context: &Context, id: &str) -> EngineResult<String> {
    if id != "pristine" && !paths::is_lower_hex(id, 32) { return Err(EngineError::plain("Invalid backup identifier.")); }
    Ok(join(&join(&context.backup_root, id), "manifest.json"))
}

fn text<'a>(value: &'a Json, field: &str) -> Option<&'a str> { value.get(field).and_then(Json::as_str) }

fn require_fields(value: &Json, names: &[&str]) -> EngineResult<()> {
    for name in names {
        if value.get(name).is_none() { return Err(EngineError::plain(format!("Incomplete manifest: missing {name}"))); }
    }
    Ok(())
}

fn assert_hash_value(value: Option<&Json>) -> EngineResult<()> {
    match value {
        None | Some(Json::Null) => Ok(()),
        Some(Json::String(s)) if paths::is_hash(s) => Ok(()),
        _ => Err(EngineError::plain("Invalid persisted hash.")),
    }
}

/// True for a timestamp `[datetime]::TryParse(..., InvariantCulture, RoundtripKind)` accepts
/// in the forms the engines write: ISO 8601 (with or without time) or `MM/dd/yyyy[ HH:mm:ss]`.
fn is_timestamp(value: &str) -> bool {
    if json::round_trip_date(value).is_some() { return true; }
    let b = value.as_bytes();
    let digits = |r: std::ops::Range<usize>| b.get(r).is_some_and(|s| s.iter().all(u8::is_ascii_digit));
    (b.len() == 10 && digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10))
        || (b.len() >= 10 && digits(0..2) && b[2] == b'/' && digits(3..5) && b[5] == b'/' && digits(6..10))
}

/// `Read-KvkManifest`: reads and validates one manifest, including that every backup file it
/// names exists and hashes to the recorded value.
pub fn read(engine: &Engine, context: &Context, id: &str) -> EngineResult<Json> {
    let path = path(context, id)?;
    assert_safe_path(&path)?;
    if !Path::new(&path).is_file() { return Err(EngineError::plain(format!("Missing backup manifest: \"{path}\""))); }
    let corrupt = || EngineError::plain(format!("Corrupt manifest: \"{path}\""));
    let raw = std::fs::read(&path).map_err(|_| corrupt())?;
    // File.ReadAllText: a UTF-8 BOM is dropped, then the text is parsed.
    let body = raw.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&raw);
    let m = json::parse(&String::from_utf8_lossy(body), json::ReadOptions::CONVERT_FROM_JSON).map_err(|_| corrupt())?;
    if !matches!(m, Json::Object(_)) { return Err(corrupt()); }
    require_fields(&m, &["Version", "Id", "Kind", "CreatedAt", "GameRoot", "LocalDataRoot", "Status", "PackRoot", "Categories", "Items", "SourceId"])?;
    let version_one = matches!(m.get("Version"), Some(Json::Number(n)) if n.parse::<f64>() == Ok(1.0));
    let same = |field: &str, expected: &str| text(&m, field).is_some_and(|v| eq_ignore_case(v, expected));
    if !version_one || text(&m, "Id") != Some(id) || !same("GameRoot", &context.game_root) || !same("LocalDataRoot", &context.local_data_root) {
        return Err(EngineError::plain(format!("Manifest identity mismatch: \"{path}\"")));
    }
    let kind = text(&m, "Kind").unwrap_or("");
    let status = text(&m, "Status").unwrap_or("");
    if !["install", "restore", "pristine"].contains(&kind) || (id == "pristine") != (kind == "pristine") { return Err(EngineError::plain("Invalid manifest kind.")); }
    if !["prepared", "applying", "completed", "rolled-back", "recovery-required", "protected"].contains(&status) { return Err(EngineError::plain("Invalid manifest status.")); }
    if kind == "pristine" && status != "protected" { return Err(EngineError::plain("Invalid first-touch status.")); }
    if kind != "pristine" && status == "protected" { return Err(EngineError::plain("Invalid operation status.")); }
    if kind == "restore" { self::path(context, text(&m, "SourceId").unwrap_or(""))?; } else if !m.get("SourceId").is_some_and(Json::is_null) { return Err(EngineError::plain("Unexpected source operation.")); }
    if !text(&m, "CreatedAt").is_some_and(is_timestamp) { return Err(EngineError::plain("Invalid manifest timestamp.")); }
    let items = match m.get("Items") { Some(Json::Array(items)) if !items.is_empty() => items, _ => return Err(EngineError::plain("Manifest has no file records.")) };
    let directory = paths::directory_name(&path).unwrap_or_default();
    let mut seen: Vec<String> = Vec::new();
    for item in items {
        require_fields(item, &["Key", "Target", "BeforeHash", "AfterHash", "Backup", "DesiredBackup", "State", "TempPath"])?;
        let target = engine.target(context, text(item, "Key").unwrap_or(""))?;
        let item_target = text(item, "Target").unwrap_or("");
        if !eq_ignore_case(item_target, &target) || seen.iter().any(|s| eq_ignore_case(s, item_target)) { return Err(EngineError::plain("Invalid or duplicate manifest target.")); }
        seen.push(item_target.to_string());
        assert_hash_value(item.get("BeforeHash"))?;
        assert_hash_value(item.get("AfterHash"))?;
        let after_null = item.get("AfterHash").is_none_or(Json::is_null);
        if kind != "restore" && after_null { return Err(EngineError::plain("Missing installed hash.")); }
        let state = text(item, "State").unwrap_or("");
        if !["pending", "writing", "applied", "restored", "protected"].contains(&state) { return Err(EngineError::plain("Invalid file execution state.")); }
        if (kind == "pristine") != (state == "protected") { return Err(EngineError::plain("Invalid first-touch record state.")); }
        if (status == "completed" && state != "applied") || (status == "rolled-back" && state != "restored") || (status == "prepared" && state != "pending") {
            return Err(EngineError::plain("Inconsistent operation progress."));
        }
        for (name, hash_name) in [("Backup", "BeforeHash"), ("DesiredBackup", "AfterHash")] {
            let rel = item.get(name).unwrap_or(&Json::Null);
            if name == "DesiredBackup" && kind != "restore" {
                if !rel.is_null() { return Err(EngineError::plain("Unexpected desired backup.")); }
                continue;
            }
            let Some(expected) = text(item, hash_name) else {
                if !rel.is_null() { return Err(EngineError::plain("Unexpected snapshot path.")); }
                continue;
            };
            let valid_rel = rel.as_str().is_some_and(|r| {
                let rest = r.strip_prefix("files/").or_else(|| r.strip_prefix("desired/"));
                rest.and_then(|x| x.strip_suffix(".bin")).is_some_and(paths::is_hash)
            });
            if !valid_rel { return Err(EngineError::plain("Unsafe snapshot path.")); }
            let file = join(&directory, rel.as_str().unwrap_or(""));
            if store::hash(&file)?.as_deref() != Some(expected) { return Err(EngineError::plain(format!("Missing or corrupt backup: \"{file}\""))); }
        }
        if let Some(temp) = text(item, "TempPath") {
            let prefix = format!("{item_target}.kvk-{id}-");
            let ok = temp.strip_prefix(&prefix).and_then(|rest| rest.strip_suffix(".tmp")).is_some_and(|guid| paths::is_lower_hex(guid, 32));
            if !ok { return Err(EngineError::plain("Unsafe operation temporary path.")); }
            assert_safe_path(temp)?;
        } else if !item.get("TempPath").is_some_and(Json::is_null) {
            return Err(EngineError::plain("Unsafe operation temporary path."));
        }
        if state == "writing" && !after_null && text(item, "TempPath").is_none() { return Err(EngineError::plain("Missing write intent.")); }
    }
    Ok(m)
}

/// `Save-KvkManifest`.
pub fn save(context: &Context, manifest: &Json) -> EngineResult<()> {
    store::write_atomic_json(&path(context, text(manifest, "Id").unwrap_or(""))?, manifest)
}

/// `Get-KvkManifests`: every published manifest, validated. A `.stage-<id>` folder is skipped:
/// nothing in the game is written before its manifest is published.
pub fn all(engine: &Engine, context: &Context) -> EngineResult<Vec<Json>> {
    engine.assert_context(context)?;
    if !Path::new(&context.backup_root).is_dir() { return Ok(Vec::new()); }
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&context.backup_root).map_err(|e| EngineError::io(&e))? {
        let entry = entry.map_err(|e| EngineError::io(&e))?;
        names.push((entry.file_name().to_string_lossy().into_owned(), entry.file_type().map(|t| t.is_dir()).unwrap_or(false)));
    }
    // Get-ChildItem lists a folder in name order.
    names.sort_by(|a, b| a.0.cmp(&b.0));
    let mut manifests = Vec::new();
    for (name, is_dir) in names {
        let full = join(&context.backup_root, &name);
        assert_safe_path(&full)?;
        if name.strip_prefix(".stage-").is_some_and(|g| paths::is_lower_hex(g, 32)) { continue; }
        if !is_dir { return Err(EngineError::plain(format!("Unexpected backup entry: \"{full}\""))); }
        manifests.push(read(engine, context, &name)?);
    }
    Ok(manifests)
}

/// True when any batch is still `prepared`, `applying` or `recovery-required`.
pub fn has_unfinished(manifests: &[Json]) -> bool {
    manifests.iter().any(|m| text(m, "Status").is_some_and(|s| UNFINISHED.contains(&s)))
}

/// `New-KvkManifest`: properties in this exact order.
pub fn new(context: &Context, kind: &str, id: &str, items: Vec<Json>, pack_root: &str, categories: &[String], source_id: Option<&str>) -> Json {
    Json::object(vec![
        ("Version", Json::int(1)),
        ("Id", Json::str(id)),
        ("Kind", Json::str(kind)),
        ("CreatedAt", Json::str(utc_now_round_trip())),
        ("GameRoot", Json::str(&context.game_root)),
        ("LocalDataRoot", Json::str(&context.local_data_root)),
        ("PackRoot", Json::str(pack_root)),
        ("Categories", Json::Array(categories.iter().map(Json::str).collect())),
        ("Status", Json::str("prepared")),
        ("SourceId", Json::opt_str(source_id)),
        ("Items", Json::Array(items)),
    ])
}

/// `New-KvkRecord`.
pub fn new_record(key: &str, target: &str, before: Option<&str>, after: Option<&str>) -> Json {
    Json::object(vec![
        ("Key", Json::str(key)),
        ("Target", Json::str(target)),
        ("BeforeHash", Json::opt_str(before)),
        ("AfterHash", Json::opt_str(after)),
        ("Backup", Json::Null),
        ("DesiredBackup", Json::Null),
        ("State", Json::str("pending")),
        ("TempPath", Json::Null),
    ])
}

/// `Test-KvkOwned`: this engine's write provably reached the file.
pub fn is_owned(item: &Json) -> bool {
    match text(item, "State") {
        Some("applied") => true,
        Some("writing") => {
            if item.get("AfterHash").is_none_or(Json::is_null) { return true; }
            // A rename consumes the journaled temporary file; a failed create leaves it there.
            text(item, "TempPath").is_some_and(|t| !Path::new(t).exists())
        }
        _ => false,
    }
}

/// `[datetime]::UtcNow.ToString('o')`: `yyyy-MM-ddTHH:mm:ss.fffffffZ`.
pub fn utc_now_round_trip() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as i64;
    let ticks = now.subsec_nanos() / 100;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{ticks:07}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps() {
        let now = utc_now_round_trip();
        assert_eq!(now.len(), 28);
        assert!(json::round_trip_date(&now).is_some());
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_726), (2026, 9, 30));
        assert!(is_timestamp("2026-09-30T08:09:10.123Z") && is_timestamp("2026-09-30") && !is_timestamp("yesterday"));
    }
}
