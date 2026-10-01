//! Plans and the write transaction (`kvk-engine.ps1`: `Get-KvkPackFiles`, `New-KvkPlan`,
//! `Add-KvkPristine`, `Invoke-KvkFileChange`, `Invoke-KvkInstall`, `Undo-KvkFailedInstall`).
//! The order of steps, game checks and manifest saves is the PowerShell engine's, so a fault
//! injected at the n-th step lands at the same place in both engines.

use std::path::Path;

use super::json::{self, Json};
use super::manifest;
use super::paths::{self, assert_safe_path, full_path, join};
use super::store::{self, copy_snapshot, hash, Context, Engine};
use super::text::{eq_ignore_case, lower_invariant};
use super::{english_text, EngineError, EngineResult};

const CATEGORIES: [&str; 6] = ["themes", "sounds", "crosshairs", "ui", "palette", "primary"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackItem { pub category: String, pub key: String, pub source: String }

pub struct PackFiles { pub root: String, pub items: Vec<PackItem>, pub skipped: Vec<String> }

/// `Sort-KvkByName`: ordinal ignoring case (UTF-16 code units, simple upper-case mapping), then
/// exact ordinal order to break ties, so a list never depends on the Windows display language.
pub fn name_order(a: &str, b: &str) -> std::cmp::Ordering {
    let upper = |s: &str| -> Vec<u16> {
        s.encode_utf16().map(|u| char::from_u32(u32::from(u)).map(|c| { let mut m = c.to_uppercase(); if m.len() == 1 { m.next().unwrap_or(c) } else { c } }).map_or(u, |c| u16::try_from(u32::from(c)).unwrap_or(u))).collect()
    };
    upper(a).cmp(&upper(b)).then_with(|| a.encode_utf16().cmp(b.encode_utf16()))
}

pub(super) fn sorted_entries(dir: &str) -> EngineResult<Vec<(String, bool)>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| EngineError::io(&e))? {
        let entry = entry.map_err(|e| EngineError::io(&e))?;
        let is_dir = std::fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(false);
        entries.push((entry.file_name().to_string_lossy().into_owned(), is_dir));
    }
    entries.sort_by(|a, b| name_order(&a.0, &b.0));
    Ok(entries)
}

/// `Get-KvkPackFiles`: the installable files of a pack folder, and every entry it skips.
pub fn pack_files(pack_root: &str) -> EngineResult<PackFiles> {
    let root = full_path(pack_root)?;
    assert_safe_path(&root)?;
    if !Path::new(&root).is_dir() { return Err(EngineError::plain(format!("Pack directory is missing: \"{root}\""))); }
    let (mut items, mut skipped, mut names) = (Vec::new(), Vec::new(), Vec::<String>::new());
    for (name, is_dir) in sorted_entries(&root)? {
        if names.iter().any(|n| eq_ignore_case(n, &name)) { return Err(EngineError::plain(format!("Case collision in pack: \"{name}\""))); }
        names.push(name.clone());
        let full = join(&root, &name);
        assert_safe_path(&full)?;
        let folder = ["Themes", "sounds", "crosshairs"].iter().any(|f| eq_ignore_case(f, &name));
        let loose = ["UI.json", "PrimaryUserSettings.json", "Palette.ini"].iter().find(|f| eq_ignore_case(f, &name));
        if is_dir && folder {
            let category = lower_invariant(&name);
            let mut seen = Vec::<String>::new();
            for (file, file_is_dir) in sorted_entries(&full)? {
                let file_full = join(&full, &file);
                assert_safe_path(&file_full)?;
                if seen.iter().any(|n| eq_ignore_case(n, &file)) { return Err(EngineError::plain(format!("Case collision in pack: \"{file_full}\""))); }
                seen.push(file.clone());
                let ext = lower_invariant(&paths::extension(&file));
                let allowed = (category == "themes" && file.to_ascii_lowercase().ends_with(".json"))
                    || (category == "sounds" && (ext == ".wav" || ext == ".ogg"))
                    || (category == "crosshairs" && ext == ".png");
                if !file_is_dir && allowed {
                    paths::assert_file_name(&file)?;
                    items.push(PackItem { key: format!("{category}/{file}"), category: category.clone(), source: file_full });
                } else {
                    skipped.push(file_full);
                }
            }
        } else if let (false, Some(canonical)) = (is_dir, loose) {
            let category = match *canonical { "UI.json" => "ui", "PrimaryUserSettings.json" => "primary", _ => "palette" };
            items.push(PackItem { key: format!("{category}/{canonical}"), category: category.to_string(), source: full });
        } else {
            skipped.push(full);
        }
    }
    Ok(PackFiles { root, items, skipped })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanItem {
    pub key: String,
    pub source: String,
    pub target: String,
    pub category: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub action: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub game_root: String,
    pub local_data_root: String,
    pub pack_root: String,
    pub categories: Vec<String>,
    pub items: Vec<PlanItem>,
    pub skipped: Vec<String>,
}

/// `Assert-KvkJsonObject`: the file must parse, and its root must be an object.
pub fn assert_json_object(path: &str) -> EngineResult<()> {
    let bytes = std::fs::read(path).map_err(|e| EngineError::io(&e))?;
    let text = read_all_text(&bytes);
    if !text.trim_start().starts_with('{') { return Err(EngineError::plain(format!("JSON must be an object: \"{path}\""))); }
    match json::parse(&text, json::ReadOptions::CONVERT_FROM_JSON) {
        Ok(Json::Object(_)) => Ok(()),
        Ok(_) => Err(EngineError::plain(format!("JSON must be an object: \"{path}\""))),
        Err(e) => Err(EngineError::plain(format!("Invalid JSON at \"{path}\" : {}", e.0))),
    }
}

/// `File.ReadAllText`: a BOM picks UTF-8, UTF-16 LE or BE and is dropped; otherwise UTF-8.
pub fn read_all_text(bytes: &[u8]) -> String {
    let file = super::text::TextFile::decode(bytes);
    String::from_utf16_lossy(&file.text)
}

/// `New-KvkPlan`: what installing the chosen categories of a pack would do to each target.
pub fn new_plan(engine: &Engine, context: &Context, pack_root: &str, categories: &[String]) -> EngineResult<Plan> {
    engine.assert_context(context)?;
    let pack = pack_files(pack_root)?;
    if categories.is_empty() { return Err(EngineError::plain("Select at least one category.")); }
    for c in categories {
        if !CATEGORIES.contains(&c.as_str()) { return Err(EngineError::plain(format!("Unknown category: {c}"))); }
        if !pack.items.iter().any(|i| eq_ignore_case(&i.category, c)) { return Err(EngineError::plain(format!("Category is not available: {c}"))); }
    }
    let mut items = Vec::new();
    for item in pack.items.iter().filter(|i| categories.iter().any(|c| eq_ignore_case(c, &i.category))) {
        if ["themes", "ui", "primary"].contains(&item.category.as_str()) { assert_json_object(&item.source)?; }
        let target = engine.target(context, &item.key)?;
        let before = hash(&target)?;
        let after = hash(&item.source)?;
        let Some(after) = after else { return Err(EngineError::plain(format!("Source missing: \"{}\"", item.source))) };
        let action = match &before { None => "create", Some(b) if *b == after => "skip", Some(_) => "replace" };
        items.push(PlanItem { key: item.key.clone(), source: item.source.clone(), target, category: item.category.clone(), before, after: Some(after), action: action.to_string() });
    }
    Ok(Plan { game_root: context.game_root.clone(), local_data_root: context.local_data_root.clone(), pack_root: pack.root, categories: categories.to_vec(), items, skipped: pack.skipped })
}

/// `New-KvkSettingsPreviewPlan`: stages an edited settings file in the data folder (never in
/// the game) and plans it as the one settings replacement. `None` when the settings changed
/// meanwhile or the plan is anything else; the caller words that as PLAN_STALE.
pub fn settings_preview_plan(engine: &Engine, context: &Context, target: &str, settings_hash: &str, bytes: &[u8], folder: &str, outside_message: &str) -> EngineResult<Option<Plan>> {
    let stage = join(&engine.data_root(&context.local_data_root)?, &format!("{folder}/{}", store::new_guid()));
    let game_prefix = format!("{}{}", context.game_root, paths::SEP);
    if stage.to_lowercase().starts_with(&game_prefix.to_lowercase()) { return Err(EngineError::plain(outside_message)); }
    store::new_directory(&stage)?;
    let staged = join(&stage, "PrimaryUserSettings.json");
    store::write_durable(&staged, bytes)?;
    let plan = new_plan(engine, context, &stage, &["primary".to_string()])?;
    let stale = plan.items.len() != 1 || plan.items[0].key != "primary/PrimaryUserSettings.json"
        || plan.items[0].after != hash(&staged)? || plan.items[0].before.as_deref() != Some(settings_hash)
        || hash(target)?.as_deref() != Some(settings_hash);
    Ok(if stale { None } else { Some(plan) })
}

/// One `Send-KvkObservation` event. `name` is not sent on the wire.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub name: &'static str,
    pub phase: &'static str,
    pub completed: Option<u64>,
    pub total: u64,
    pub current_file: Option<String>,
    pub batch_id: Option<String>,
}

pub type Observer<'a> = &'a mut dyn FnMut(&Observation);

/// `New-KvkReport`. `items` are manifest records (with `State`) or plan rows (with `Action`).
#[derive(Clone, Debug, PartialEq)]
pub struct Report { pub status: String, pub id: Option<String>, pub items: Vec<Json>, pub errors: Vec<String>, pub errors_en: Vec<String> }

impl Report {
    pub fn new(status: &str, id: Option<&str>, items: Vec<Json>, errors: Vec<String>, errors_en: Option<Vec<String>>) -> Self {
        let errors_en = match errors_en {
            Some(given) if given.len() == errors.len() => errors.iter().zip(&given).map(|(m, e)| english_text(m, Some(e))).collect(),
            _ => errors.iter().map(|m| english_text(m, None)).collect(),
        };
        Report { status: status.to_string(), id: id.map(str::to_string), items, errors, errors_en }
    }
}

fn plan_row(item: &PlanItem) -> Json {
    Json::object(vec![
        ("Key", Json::str(&item.key)), ("Source", Json::str(&item.source)), ("Target", Json::str(&item.target)),
        ("Category", Json::str(&item.category)), ("BeforeHash", Json::opt_str(item.before.clone())),
        ("AfterHash", Json::opt_str(item.after.clone())), ("Action", Json::str(&item.action)),
    ])
}

fn text(value: &Json, field: &str) -> Option<String> { value.get(field).and_then(Json::as_str).map(str::to_string) }

fn source_name(key: &str) -> String { format!("source/{}.bin", paths::text_hash(&lower_invariant(key))) }

/// `Add-KvkPristine`: the first protection of every file this install touches for the first
/// time. Records already present are never changed.
fn add_pristine(engine: &Engine, context: &Context, install: &Json, install_dir: &str, observer: Observer) -> EngineResult<()> {
    let original = manifest::path(context, "pristine")?;
    let pristine_dir = paths::directory_name(&original).unwrap_or_default();
    let mut old = if Path::new(&original).is_file() { Some(manifest::read(engine, context, "pristine")?) } else { None };
    let working = if old.is_none() { let w = join(&context.backup_root, &format!(".stage-{}", store::new_guid())); store::new_directory(&w)?; w } else { pristine_dir.clone() };
    let mut all: Vec<Json> = old.as_ref().and_then(|m| m.get("Items")).and_then(Json::as_array).cloned().unwrap_or_default();
    let mut keys: Vec<String> = all.iter().filter_map(|x| text(x, "Key")).collect();
    let install_items = install.get("Items").and_then(Json::as_array).cloned().unwrap_or_default();
    for x in &install_items {
        let key = text(x, "Key").unwrap_or_default();
        // `@{}` in Add-KvkPristine ignores case: `sounds/HIT.wav` is the file `sounds/Hit.wav` protects.
        if keys.iter().any(|k| eq_ignore_case(k, &key)) { continue; }
        let before = text(x, "BeforeHash");
        let mut record = manifest::new_record(&key, &text(x, "Target").unwrap_or_default(), before.as_deref(), text(x, "AfterHash").as_deref());
        record.set("State", Json::str("protected"));
        if let Some(before) = &before {
            let backup = format!("files/{}.bin", paths::text_hash(&format!("{}/{}", lower_invariant(&key), store::new_guid())));
            copy_snapshot(engine, &join(install_dir, &text(x, "Backup").unwrap_or_default()), &join(&working, &backup), before)?;
            record.set("Backup", Json::str(backup));
        }
        all.push(record);
        keys.push(key);
    }
    let manifest = match old.take() {
        None => {
            let mut m = manifest::new(context, "pristine", "pristine", all, "", &[], None);
            m.set("Status", Json::str("protected"));
            m
        }
        Some(mut m) => { m.set("Items", Json::Array(all)); m }
    };
    if working != pristine_dir {
        store::write_atomic_json(&join(&working, "manifest.json"), &manifest)?;
        super::platform::move_directory(Path::new(&working), Path::new(&pristine_dir)).map_err(|e| EngineError::io(&e))?;
    } else {
        manifest::save(context, &manifest)?;
    }
    manifest::read(engine, context, "pristine")?;
    let count = install_items.len() as u64;
    observer(&Observation { name: "pristine-protected", phase: "protecting", completed: Some(count), total: count, current_file: None, batch_id: text(install, "Id") });
    Ok(())
}

/// `Assert-KvkGameClosedUnless`: the writes that only place files (a crosshair, an added theme or
/// sound) may run while the game is open; every other write requires it closed.
fn game_closed_unless(engine: &Engine, allowed: bool) -> EngineResult<()> { if allowed { Ok(()) } else { engine.assert_game_closed() } }

fn items_mut(manifest: &mut Json) -> &mut Vec<Json> {
    match manifest { Json::Object(fields) => match fields.iter_mut().find(|(k, _)| k == "Items") { Some((_, Json::Array(items))) => items, _ => unreachable_items() }, _ => unreachable_items() }
}

#[allow(clippy::panic)]
fn unreachable_items() -> ! { panic!("a validated manifest always has an Items array") }

/// `Invoke-KvkFileChange`: one target, from its before-hash to its after-hash, with the intent
/// journaled before the rename so a crash is recoverable.
fn file_change(engine: &Engine, context: &Context, manifest: &mut Json, index: usize, source: &str, allow_running: bool) -> EngineResult<()> {
    engine.host.fault("file-change")?;
    game_closed_unless(engine, allow_running)?;
    let id = text(manifest, "Id").unwrap_or_default();
    let item = items_mut(manifest)[index].clone();
    let target = text(&item, "Target").unwrap_or_default();
    let (before, after) = (text(&item, "BeforeHash"), text(&item, "AfterHash"));
    assert_safe_path(&target)?;
    if hash(&target)? != before { return Err(EngineError::plain(format!("Target changed before write: \"{target}\""))); }
    match &after {
        None => {
            items_mut(manifest)[index].set("State", Json::str("writing"));
            manifest::save(context, manifest)?;
            game_closed_unless(engine, allow_running)?;
            if hash(&target)? != before { return Err(EngineError::plain(format!("Target changed before deletion: \"{target}\""))); }
            if before.is_some() { std::fs::remove_file(&target).map_err(|e| EngineError::io(&e))?; }
        }
        Some(after_hash) => {
            store::new_directory(&paths::directory_name(&target).unwrap_or_default())?;
            let temp = format!("{target}.kvk-{id}-{}.tmp", store::new_guid());
            items_mut(manifest)[index].set("TempPath", Json::str(&temp));
            copy_snapshot(engine, source, &temp, after_hash)?;
            items_mut(manifest)[index].set("State", Json::str("writing"));
            manifest::save(context, manifest)?;
            game_closed_unless(engine, allow_running)?;
            if hash(&target)? != before { return Err(EngineError::plain(format!("Target changed before replacement: \"{target}\""))); }
            let moved = if before.is_none() { super::platform::move_file_no_replace(Path::new(&temp), Path::new(&target)) } else { super::platform::replace_file(Path::new(&temp), Path::new(&target)) };
            moved.map_err(|e| EngineError::io(&e))?;
        }
    }
    if hash(&target)? != after { return Err(EngineError::plain(format!("Read-back verification failed: \"{target}\""))); }
    items_mut(manifest)[index].set("State", Json::str("applied"));
    manifest::save(context, manifest)
}

/// `Invoke-KvkInstall`: backs up every target, publishes the backup, extends the first
/// protection, then writes and verifies each file; on failure rolls the batch back, and if
/// that fails too leaves it `recovery-required`.
pub fn install(engine: &Engine, context: &Context, plan: &Plan, allow_running: bool, observer: Observer) -> EngineResult<Report> {
    let _locks = engine.enter_lock(context)?;
    game_closed_unless(engine, allow_running)?;
    let manifests = manifest::all(engine, context)?;
    if manifest::has_unfinished(&manifests) {
        return Err(EngineError::coded("RECOVERY_REQUIRED", "上一次操作还没有完成，请先恢复再安装。", "An unfinished operation must be recovered before installing."));
    }
    let fresh = new_plan(engine, context, &plan.pack_root, &plan.categories)?;
    if !eq_ignore_case(&plan.game_root, &context.game_root) || !eq_ignore_case(&plan.local_data_root, &context.local_data_root) || plan.items.len() != fresh.items.len() {
        return Err(EngineError::coded("PLAN_STALE", "安装预览与当前文件不一致。", "Install preview no longer matches."));
    }
    if fresh.items != plan.items {
        return Err(EngineError::coded("PLAN_STALE", "预览之后来源或目标文件发生了变化。", "Install source or target changed after preview."));
    }
    let todo: Vec<&PlanItem> = fresh.items.iter().filter(|x| x.action != "skip").collect();
    if todo.is_empty() {
        let report = Report::new("no-change", None, fresh.items.iter().map(plan_row).collect(), Vec::new(), None);
        observer(&Observation { name: "report", phase: "verifying", completed: Some(0), total: 0, current_file: None, batch_id: None });
        return Ok(report);
    }
    let id = store::new_guid();
    let stage = join(&context.backup_root, &format!(".stage-{id}"));
    store::new_directory(&stage)?;
    let mut records = Vec::new();
    for (staged, x) in todo.iter().enumerate() {
        observer(&Observation { name: "source-staging", phase: "preparing", completed: Some(staged as u64), total: todo.len() as u64, current_file: Some(x.key.clone()), batch_id: Some(id.clone()) });
        let mut record = manifest::new_record(&x.key, &x.target, x.before.as_deref(), x.after.as_deref());
        if let Some(before) = &x.before {
            let backup = format!("files/{}.bin", paths::text_hash(&lower_invariant(&x.key)));
            copy_snapshot(engine, &x.target, &join(&stage, &backup), before)?;
            record.set("Backup", Json::str(backup));
        }
        // Source bytes are staged too: every read of the source ends before any game write.
        copy_snapshot(engine, &x.source, &join(&stage, &source_name(&x.key)), x.after.as_deref().unwrap_or_default())?;
        records.push(record);
    }
    let staged_manifest = manifest::new(context, "install", &id, records, &fresh.pack_root, &fresh.categories, None);
    store::write_atomic_json(&join(&stage, "manifest.json"), &staged_manifest)?;
    // A validated backup is published before first protection grows or any target is touched.
    let published = join(&context.backup_root, &id);
    super::platform::move_directory(Path::new(&stage), Path::new(&published)).map_err(|e| EngineError::io(&e))?;
    let mut m = manifest::read(engine, context, &id)?;
    let attempt = (|| -> EngineResult<Report> {
        add_pristine(engine, context, &m, &published, observer)?;
        m.set("Status", Json::str("applying"));
        manifest::save(context, &m)?;
        let total = items_mut(&mut m).len() as u64;
        observer(&Observation { name: "installing", phase: "installing", completed: Some(0), total, current_file: None, batch_id: Some(id.clone()) });
        for index in 0..total as usize {
            let key = text(&items_mut(&mut m)[index], "Key").unwrap_or_default();
            file_change(engine, context, &mut m, index, &join(&published, &source_name(&key)), allow_running)?;
            observer(&Observation { name: "file-verified", phase: "verifying", completed: Some(index as u64 + 1), total, current_file: Some(key), batch_id: Some(id.clone()) });
        }
        m.set("Status", Json::str("completed"));
        manifest::save(context, &m)?;
        let report = Report::new("completed", Some(&id), items_mut(&mut m).clone(), Vec::new(), None);
        observer(&Observation { name: "report", phase: "verifying", completed: Some(total), total, current_file: None, batch_id: Some(id.clone()) });
        Ok(report)
    })();
    match attempt {
        Ok(report) => Ok(report),
        Err(error) => {
            let mut errors = vec![error.message.clone()];
            let mut errors_en = vec![error.english()];
            let total = items_mut(&mut m).len() as u64;
            match undo_failed_install(engine, context, &mut m, allow_running, observer) {
                Ok(rollback) => {
                    errors.extend(rollback.errors);
                    errors_en.extend(rollback.errors_en);
                    let report = Report::new(&rollback.status, Some(&id), items_mut(&mut m).clone(), errors, Some(errors_en));
                    observer(&Observation { name: "report", phase: "rolling-back", completed: Some(total), total, current_file: None, batch_id: Some(id.clone()) });
                    Ok(report)
                }
                Err(undo_error) => {
                    errors.push(undo_error.message.clone());
                    errors_en.push(undo_error.english());
                    m.set("Status", Json::str("recovery-required"));
                    if let Err(save_error) = manifest::save(context, &m) { errors.push(save_error.message.clone()); errors_en.push(save_error.english()); }
                    let report = Report::new("recovery-required", Some(&id), items_mut(&mut m).clone(), errors, Some(errors_en));
                    observer(&Observation { name: "report", phase: "rolling-back", completed: None, total, current_file: None, batch_id: Some(id.clone()) });
                    Ok(report)
                }
            }
        }
    }
}

/// `Undo-KvkFailedInstall`: every file this batch owns goes back to its before-hash; a file
/// someone else changed stops the rollback, leaving the batch `recovery-required`.
fn undo_failed_install(engine: &Engine, context: &Context, m: &mut Json, allow_running: bool, observer: Observer) -> EngineResult<Report> {
    let id = text(m, "Id").unwrap_or_default();
    manifest::read(engine, context, &id)?;
    game_closed_unless(engine, allow_running)?;
    m.set("Status", Json::str("recovery-required"));
    manifest::save(context, m)?;
    let total = items_mut(m).len() as u64;
    observer(&Observation { name: "rollback-started", phase: "rolling-back", completed: Some(0), total, current_file: None, batch_id: Some(id.clone()) });
    for x in items_mut(m).iter() {
        let target = text(x, "Target").unwrap_or_default();
        let current = hash(&target)?;
        if current == text(x, "BeforeHash") { continue; }
        if !manifest::is_owned(x) || current != text(x, "AfterHash") { return Err(EngineError::plain(format!("Automatic rollback conflict: \"{target}\""))); }
    }
    let mut completed = 0u64;
    for index in 0..total as usize {
        let x = items_mut(m)[index].clone();
        let (target, key) = (text(&x, "Target").unwrap_or_default(), text(&x, "Key").unwrap_or_default());
        let (before, after) = (text(&x, "BeforeHash"), text(&x, "AfterHash"));
        if hash(&target)? != before {
            game_closed_unless(engine, allow_running)?;
            if hash(&target)? != after { return Err(EngineError::plain(format!("Target changed during rollback: \"{target}\""))); }
            match &before {
                None => std::fs::remove_file(&target).map_err(|e| EngineError::io(&e))?,
                Some(before_hash) => {
                    let temp = format!("{target}.rollback-{}.tmp", store::new_guid());
                    let backup = join(&join(&context.backup_root, &id), &text(&x, "Backup").unwrap_or_default());
                    copy_snapshot(engine, &backup, &temp, before_hash)?;
                    let replaced = (|| {
                        game_closed_unless(engine, allow_running)?;
                        if hash(&target)? != after { return Err(EngineError::plain("Target changed during rollback.")); }
                        super::platform::replace_file(Path::new(&temp), Path::new(&target)).map_err(|e| EngineError::io(&e))
                    })();
                    if Path::new(&temp).is_file() { let _ = std::fs::remove_file(&temp); }
                    replaced?;
                }
            }
            if hash(&target)? != before { return Err(EngineError::plain(format!("Rollback verification failed: \"{target}\""))); }
        }
        items_mut(m)[index].set("State", Json::str("restored"));
        manifest::save(context, m)?;
        completed += 1;
        observer(&Observation { name: "file-verified", phase: "rolling-back", completed: Some(completed), total, current_file: Some(key), batch_id: Some(id.clone()) });
    }
    m.set("Status", Json::str("rolled-back"));
    manifest::save(context, m)?;
    Ok(Report::new("rolled-back", Some(&id), items_mut(m).clone(), Vec::new(), None))
}

// ---- Restore -------------------------------------------------------------------------------

/// One row of `New-KvkRestorePlan`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestoreItem {
    pub key: String,
    pub target: String,
    pub action: String,
    pub current: Option<String>,
    pub desired: Option<String>,
    pub desired_backup: Option<String>,
    pub source_id: String,
    pub conflict: bool,
    pub unowned: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestorePlan { pub id: String, pub kind: String, pub game_root: String, pub local_data_root: String, pub items: Vec<RestoreItem>, pub conflicts: Vec<String> }

impl RestoreItem {
    fn row(&self) -> Json {
        Json::object(vec![
            ("Key", Json::str(&self.key)), ("Target", Json::str(&self.target)), ("Action", Json::str(&self.action)),
            ("CurrentHash", Json::opt_str(self.current.clone())), ("DesiredHash", Json::opt_str(self.desired.clone())),
            ("DesiredBackup", Json::opt_str(self.desired_backup.clone())), ("SourceId", Json::str(&self.source_id)),
            ("Conflict", Json::Bool(self.conflict)), ("Unowned", Json::Bool(self.unowned)),
        ])
    }
}

/// `[datetime]` order of a manifest's `CreatedAt`.
pub fn created_key(manifest: &Json) -> (String, String) {
    let text = manifest.get("CreatedAt").and_then(Json::as_str).unwrap_or_default();
    let (head, tail) = text.split_at(text.len().min(19));
    let fraction: String = tail.strip_prefix('.').unwrap_or("").chars().take_while(char::is_ascii_digit).collect();
    (head.to_string(), format!("{fraction:0<7}"))
}

/// `New-KvkRestorePlan`: what restoring a batch (or the first protection) would do to each
/// file, and whether each write is provably this installer's to undo.
pub fn restore_plan(engine: &Engine, context: &Context, id: &str) -> EngineResult<RestorePlan> {
    engine.assert_context(context)?;
    let all = manifest::all(engine, context)?;
    let m = manifest::read(engine, context, id)?;
    let kind = text(&m, "Kind").unwrap_or_default();
    let mut history: Vec<&Json> = all.iter().filter(|h| h.get("Kind").and_then(Json::as_str) != Some("pristine")).collect();
    history.sort_by_key(|h| created_key(h));
    let (mut items, mut conflicts) = (Vec::new(), Vec::new());
    for x in m.get("Items").and_then(Json::as_array).cloned().unwrap_or_default() {
        let key = text(&x, "Key").unwrap_or_default();
        let target = text(&x, "Target").unwrap_or_default();
        let current = hash(&target)?;
        let (mut desired, mut backup, mut expected, mut owned) = (text(&x, "BeforeHash"), text(&x, "Backup"), text(&x, "AfterHash"), manifest::is_owned(&x));
        if kind == "restore" { desired = text(&x, "AfterHash"); backup = text(&x, "DesiredBackup"); expected = text(&x, "BeforeHash"); owned = true; }
        if kind == "pristine" {
            owned = false;
            expected = text(&x, "BeforeHash");
            for h in &history {
                for hx in h.get("Items").and_then(Json::as_array).into_iter().flatten().filter(|hx| text(hx, "Key").is_some_and(|k| eq_ignore_case(&k, &key))) {
                    if text(hx, "State").as_deref() == Some("restored") { expected = text(hx, "BeforeHash"); owned = true; }
                    else if manifest::is_owned(hx) { expected = text(hx, "AfterHash"); owned = true; }
                }
            }
        }
        let action = if current == desired { "skip" } else if desired.is_none() { "delete" } else { "restore" };
        let conflict = action != "skip" && (current != expected || !owned);
        let unowned = action != "skip" && desired.is_none() && !owned;
        if conflict { conflicts.push(target.clone()); }
        items.push(RestoreItem { key, target, action: action.to_string(), current, desired, desired_backup: backup, source_id: id.to_string(), conflict, unowned });
    }
    Ok(RestorePlan { id: id.to_string(), kind, game_root: context.game_root.clone(), local_data_root: context.local_data_root.clone(), items, conflicts })
}

fn settle(manifest: &mut Json) {
    manifest.set("Status", Json::str("rolled-back"));
    for item in items_mut(manifest).iter_mut() { item.set("State", Json::str("restored")); }
}

/// `Complete-KvkRestore`: the restore is done, and the batch it undid is marked rolled back (a
/// first-protection restore settles every unfinished install instead).
fn complete_restore(engine: &Engine, context: &Context, m: &mut Json) -> EngineResult<()> {
    m.set("Status", Json::str("completed"));
    manifest::save(context, m)?;
    let source_id = text(m, "SourceId").unwrap_or_default();
    if !eq_ignore_case(&source_id, "pristine") {
        let mut source = manifest::read(engine, context, &source_id)?;
        if text(&source, "Kind").as_deref() == Some("install") { settle(&mut source); manifest::save(context, &source)?; }
    } else {
        for mut source in manifest::all(engine, context)? {
            let unfinished = text(&source, "Status").is_some_and(|s| manifest::UNFINISHED.contains(&s.as_str()));
            if text(&source, "Kind").as_deref() == Some("install") && unfinished { settle(&mut source); manifest::save(context, &source)?; }
        }
    }
    Ok(())
}

/// `Invoke-KvkRestore`.
/// The temporary copies an install batch may leave beside its targets when the worker stops
/// while copying one (`<target>.kvk-<batch id>-<32 hex>.tmp`, see `file_change`): a copy that was
/// still being written was never recorded, so recovery finds them by that name, which only this
/// batch can have made. Best effort; anything else in the folder is left alone.
fn remove_batch_temps(batch: &Json) {
    let Some(id) = text(batch, "Id") else { return };
    let items = batch.get("Items").and_then(Json::as_array).cloned().unwrap_or_default();
    for item in items {
        let Some(target) = text(&item, "Target") else { continue };
        let Some(dir) = paths::directory_name(&target) else { continue };
        let prefix = format!("{}.kvk-{id}-", paths::file_name(&target));
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(rest) = name.strip_prefix(&prefix).and_then(|r| r.strip_suffix(".tmp")) else { continue };
            let full = join(&dir, &name);
            if paths::is_lower_hex(rest, 32) && assert_safe_path(&full).is_ok() && Path::new(&full).is_file() { let _ = std::fs::remove_file(&full); }
        }
    }
}

pub fn restore(engine: &Engine, context: &Context, plan: &RestorePlan, allow_conflicts: bool, observer: Observer) -> EngineResult<Report> {
    let _locks = engine.enter_lock(context)?;
    engine.assert_game_closed()?;
    let fresh = restore_plan(engine, context, &plan.id)?;
    if !eq_ignore_case(&fresh.game_root, &plan.game_root) || !eq_ignore_case(&fresh.local_data_root, &plan.local_data_root) || fresh.items.len() != plan.items.len() {
        return Err(EngineError::coded("PLAN_STALE", "恢复预览已改变。", "Restore preview changed."));
    }
    if fresh.items != plan.items {
        return Err(EngineError::coded("PLAN_STALE", "恢复预览之后目标文件或备份发生了变化。", "Target or backup changed after restore preview."));
    }
    if fresh.items.iter().any(|i| i.unowned) {
        return Err(EngineError::coded("UNOWNED_FILE", "没有证据证明这个文件是本程序写入的，因此不会删除它。", "Cannot delete a file without proof that this installer created it."));
    }
    if !fresh.conflicts.is_empty() && !allow_conflicts {
        return Err(EngineError::plain(format!("Restore conflicts require explicit confirmation: {}", fresh.conflicts.join(", "))));
    }
    let source = manifest::read(engine, context, &plan.id)?;
    let source_unfinished = text(&source, "Status").is_some_and(|s| manifest::UNFINISHED.contains(&s.as_str()));
    // An interrupted install may have left a temporary copy no record names (`remove_batch_temps`).
    let interrupted_install = (text(&source, "Kind").as_deref() == Some("install") && source_unfinished).then(|| source.clone());
    let mut m;
    if text(&source, "Kind").as_deref() == Some("restore") && source_unfinished {
        // Retrying an interrupted restore: files changed since are preserved before their
        // previewed state is accepted.
        m = source;
        m.set("Status", Json::str("applying"));
        let id = text(&m, "Id").unwrap_or_default();
        for index in 0..items_mut(&mut m).len() {
            let x = items_mut(&mut m)[index].clone();
            let key = text(&x, "Key").unwrap_or_default();
            let Some(p) = fresh.items.iter().find(|p| p.key == key) else { continue };
            if p.action == "skip" { items_mut(&mut m)[index].set("State", Json::str("applied")); continue; }
            if text(&x, "BeforeHash") != p.current {
                match &p.current {
                    Some(current) => {
                        let rel = format!("files/{}.bin", paths::text_hash(&format!("{key}/{}", store::new_guid())));
                        copy_snapshot(engine, &text(&x, "Target").unwrap_or_default(), &join(&join(&context.backup_root, &id), &rel), current)?;
                        items_mut(&mut m)[index].set("Backup", Json::str(rel));
                    }
                    None => items_mut(&mut m)[index].set("Backup", Json::Null),
                }
                items_mut(&mut m)[index].set("BeforeHash", Json::opt_str(p.current.clone()));
            }
            items_mut(&mut m)[index].set("State", Json::str("pending"));
            items_mut(&mut m)[index].set("TempPath", Json::Null);
        }
        manifest::save(context, &m)?;
    } else {
        let todo: Vec<&RestoreItem> = fresh.items.iter().filter(|p| p.action != "skip").collect();
        if todo.is_empty() {
            let mut source = source;
            if text(&source, "Kind").as_deref() == Some("install") && source_unfinished { settle(&mut source); manifest::save(context, &source)?; }
            if let Some(batch) = &interrupted_install { remove_batch_temps(batch); }
            let report = Report::new("restored", Some(&plan.id), fresh.items.iter().map(RestoreItem::row).collect(), Vec::new(), None);
            observer(&Observation { name: "report", phase: "restoring", completed: Some(0), total: 0, current_file: None, batch_id: Some(plan.id.clone()) });
            return Ok(report);
        }
        let id = store::new_guid();
        let stage = join(&context.backup_root, &format!(".stage-{id}"));
        store::new_directory(&stage)?;
        let mut records = Vec::new();
        for (staged, p) in todo.iter().enumerate() {
            observer(&Observation { name: "restore-preparing", phase: "preparing", completed: Some(staged as u64), total: todo.len() as u64, current_file: Some(p.key.clone()), batch_id: Some(id.clone()) });
            let mut record = manifest::new_record(&p.key, &p.target, p.current.as_deref(), p.desired.as_deref());
            let key_hash = paths::text_hash(&lower_invariant(&p.key));
            if let Some(current) = &p.current {
                let rel = format!("files/{key_hash}.bin");
                copy_snapshot(engine, &p.target, &join(&stage, &rel), current)?;
                record.set("Backup", Json::str(rel));
            }
            if let Some(desired) = &p.desired {
                let rel = format!("desired/{key_hash}.bin");
                let from = join(&join(&context.backup_root, &p.source_id), p.desired_backup.as_deref().unwrap_or_default());
                copy_snapshot(engine, &from, &join(&stage, &rel), desired)?;
                record.set("DesiredBackup", Json::str(rel));
            }
            records.push(record);
        }
        let staged_manifest = manifest::new(context, "restore", &id, records, "", &[], Some(&plan.id));
        store::write_atomic_json(&join(&stage, "manifest.json"), &staged_manifest)?;
        super::platform::move_directory(Path::new(&stage), Path::new(&join(&context.backup_root, &id))).map_err(|e| EngineError::io(&e))?;
        m = manifest::read(engine, context, &id)?;
    }
    let id = text(&m, "Id").unwrap_or_default();
    let total = items_mut(&mut m).len() as u64;
    let attempt = (|| -> EngineResult<Report> {
        m.set("Status", Json::str("applying"));
        manifest::save(context, &m)?;
        observer(&Observation { name: "restoring", phase: "restoring", completed: Some(0), total, current_file: None, batch_id: Some(id.clone()) });
        let mut completed = 0u64;
        for index in 0..total as usize {
            let x = items_mut(&mut m)[index].clone();
            if text(&x, "State").as_deref() == Some("applied") { completed += 1; continue; }
            let desired_path = text(&x, "DesiredBackup").map(|rel| join(&join(&context.backup_root, &id), &rel)).unwrap_or_default();
            file_change(engine, context, &mut m, index, &desired_path, false)?;
            completed += 1;
            observer(&Observation { name: "file-verified", phase: "verifying", completed: Some(completed), total, current_file: text(&x, "Key"), batch_id: Some(id.clone()) });
        }
        complete_restore(engine, context, &mut m)?;
        if let Some(batch) = &interrupted_install { remove_batch_temps(batch); }
        let report = Report::new("restored", Some(&id), items_mut(&mut m).clone(), Vec::new(), None);
        observer(&Observation { name: "report", phase: "verifying", completed: Some(total), total, current_file: None, batch_id: Some(id.clone()) });
        Ok(report)
    })();
    match attempt {
        Ok(report) => Ok(report),
        Err(error) => {
            let (mut errors, mut errors_en) = (vec![error.message.clone()], vec![error.english()]);
            m.set("Status", Json::str("recovery-required"));
            if let Err(save_error) = manifest::save(context, &m) { errors.push(save_error.message.clone()); errors_en.push(save_error.english()); }
            let report = Report::new("recovery-required", Some(&id), items_mut(&mut m).clone(), errors, Some(errors_en));
            observer(&Observation { name: "report", phase: "restoring", completed: None, total, current_file: None, batch_id: Some(id.clone()) });
            Ok(report)
        }
    }
}
