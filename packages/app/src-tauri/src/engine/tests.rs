//! End-to-end cases for the Rust engine, run through the same request boundary the worker
//! uses. They were ported from the retired PowerShell suites (`enemy.test.ps1`, the Enemy block
//! of `gui-protocol.test.ps1`, and the write-core cases of `engine.test.ps1` that the Enemy path
//! reaches: rollback, recovery-required, the lock). Parity with the retired PowerShell engine is
//! the job of the frozen goldens (`tests/engine_parity.rs`); these pin behaviour on any host, the
//! Mac included.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use super::json::{self, Json};
use super::session::{self, Session};
use super::store::Host;
use super::{platform, EngineError, EngineResult};

#[derive(Default)]
pub(super) struct HostState { pub(super) running_from_call: Cell<Option<usize>>, pub(super) calls: Cell<usize>, faults: RefCell<Vec<String>> }

pub(super) struct TestHost(pub(super) Rc<HostState>);

impl Host for TestHost {
    fn process_names(&self) -> std::io::Result<Vec<String>> {
        let call = self.0.calls.get() + 1;
        self.0.calls.set(call);
        Ok(match self.0.running_from_call.get() { Some(from) if call >= from => vec!["FPSAimTrainer".to_string()], _ => vec!["explorer".to_string()] })
    }

    fn fault(&self, point: &str) -> EngineResult<()> {
        if self.0.faults.borrow().iter().any(|f| f == point) { return Err(EngineError::plain(format!("Injected failure at {point}"))); }
        Ok(())
    }
}

/// The CRLF + tab layout real KovaaK writes, as `New-KvkEnemyFixtureText` builds it.
pub(super) fn fixture_text(cylindrical: &str) -> String {
    let (m, s) = cylindrical.split_once('/').unwrap();
    format!("{{\r\n\t\"floatSettings\":\r\n\t{{\r\n\t\t\"EFloatSettingId::XSens\": 0.91\r\n\t}},\r\n\t\"characterModelOverride\":\r\n\t{{\r\n\t\t\"Cylindrical\":\r\n\t\t{{\r\n\t\t\t\"characterModel\": \"{m}\",\r\n\t\t\t\"characterSkin\": \"{s}\"\r\n\t\t}},\r\n\t\t\"Cuboid\":\r\n\t\t{{\r\n\t\t\t\"characterModel\": \"Ghost\",\r\n\t\t\t\"characterSkin\": \"Default\"\r\n\t\t}},\r\n\t\t\"Spheroid\":\r\n\t\t{{\r\n\t\t\t\"characterModel\": \"Mummy\",\r\n\t\t\t\"characterSkin\": \"Default\"\r\n\t\t}}\r\n\t}},\r\n\t\"currentlySelectedBoundingBoxType\": \"Cuboid\",\r\n\t\"large\": 9007199254740993,\r\n\t\"stringSettings\":\r\n\t{{\r\n\t\t\"unchangedDate\": \"2026-09-15T00:00:00Z\"\r\n\t}}\r\n}}")
}

pub(super) struct Fixture { pub(super) root: PathBuf, pub(super) game: String, pub(super) local: String, pub(super) target: PathBuf, pub(super) host: Rc<HostState>, session: Session, next: u32 }

impl Fixture {
    pub(super) fn new(bytes: &[u8]) -> Self {
        // The temp folder sits behind a link on macOS; the engine refuses links, as PowerShell does.
        let base = super::paths::temp_dir_without_links();
        let root = base.join(format!("kvk-rust-{}", super::store::new_guid()));
        let game = root.join("游戏 with spaces");
        let target = game.join("FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::create_dir_all(game.join("FPSAimTrainer/sounds")).unwrap();
        std::fs::write(&target, bytes).unwrap();
        let local = root.join("Local Data");
        std::fs::create_dir_all(&local).unwrap();
        let host = Rc::new(HostState::default());
        let session = Session::new(Box::new(TestHost(host.clone())), &local.to_string_lossy(), &root.to_string_lossy()).unwrap();
        Fixture { game: game.to_string_lossy().into_owned(), local: local.to_string_lossy().into_owned(), root, target, host, session, next: 0 }
    }

    pub(super) fn request(&mut self, op: &str, args: Json) -> (Json, Vec<Json>) {
        self.next += 1;
        let request = Json::object(vec![("v", Json::int(1)), ("requestId", Json::str(format!("r{}", self.next))), ("op", Json::str(op)), ("args", args)]);
        let mut progress = Vec::new();
        let reply = self.session.handle(&request, &mut |line| progress.push(line));
        (reply, progress)
    }

    pub(super) fn ok(&mut self, op: &str, args: Json) -> Json {
        let (reply, _) = self.request(op, args);
        assert_eq!(reply.get("ok"), Some(&Json::Bool(true)), "{op} failed: {}", reply.to_compact());
        reply.get("data").cloned().unwrap()
    }

    pub(super) fn error(&mut self, op: &str, args: Json) -> Json {
        let (reply, _) = self.request(op, args);
        assert_eq!(reply.get("ok"), Some(&Json::Bool(false)), "{op} was accepted: {}", reply.to_compact());
        reply.get("error").cloned().unwrap()
    }

    fn plan(&mut self, shape: &str, model: &str, skin: &str) -> String {
        let args = Json::object(vec![("gameRoot", Json::str(&self.game)), ("shape", Json::str(shape)), ("model", Json::str(model)), ("skin", Json::str(skin)), ("revision", Json::int(1))]);
        self.ok("planEnemy", args).get("planId").and_then(Json::as_str).unwrap().to_string()
    }

    fn plan_error(&mut self, shape: &str, model: &str, skin: &str) -> Json {
        let args = Json::object(vec![("gameRoot", Json::str(&self.game)), ("shape", Json::str(shape)), ("model", Json::str(model)), ("skin", Json::str(skin)), ("revision", Json::int(1))]);
        self.error("planEnemy", args)
    }

    pub(super) fn execute_args(plan_id: &str) -> Json {
        Json::object(vec![("operationId", Json::str("op-1")), ("planId", Json::str(plan_id)), ("confirmation", Json::str("install")), ("allowConflicts", Json::Bool(false))])
    }

    pub(super) fn bytes(&self) -> Vec<u8> { std::fs::read(&self.target).unwrap() }

    pub(super) fn backup_root(&self) -> PathBuf {
        let backups = Path::new(&self.local).join("Aimloom/backups");
        std::fs::read_dir(&backups).unwrap().next().unwrap().unwrap().path()
    }

    pub(super) fn manifest(&self, id: &str) -> (String, Json) {
        let raw = std::fs::read_to_string(self.backup_root().join(id).join("manifest.json")).unwrap();
        let parsed = json::parse(&raw, json::ReadOptions { strings: json::Strings::Literal, ..json::ReadOptions::CONVERT_FROM_JSON }).unwrap();
        (raw, parsed)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); }
}

pub(super) fn code(error: &Json) -> &str { error.get("code").and_then(Json::as_str).unwrap() }
pub(super) fn english(error: &Json) -> &str { error.get("messageEn").and_then(Json::as_str).unwrap() }
pub(super) fn original() -> Vec<u8> { fixture_text("Stylized Ecto/Default").into_bytes() }

#[test]
fn listing_reads_each_shape_and_the_fixed_catalog() {
    let mut f = Fixture::new(&original());
    let data = f.ok("enemyList", Json::object(vec![("gameRoot", Json::str(&f.game.clone()))]));
    assert_eq!(data.get("current").unwrap().to_compact(), r#"{"cylindrical":{"model":"Stylized Ecto","skin":"Default"},"cuboid":{"model":"Ghost","skin":"Default"},"spheroid":{"model":"Mummy","skin":"Default"}}"#);
    let skins = data.get("skins").and_then(Json::as_array).unwrap();
    assert_eq!(skins.len(), 15);
    assert_eq!(skins.iter().filter(|s| s.get("shapes").and_then(Json::as_array).unwrap().len() == 3).count(), 3);
    assert_eq!(skins[7].to_compact(), r#"{"label":"Shinji","model":"Meso","skin":"Genji","shapes":["cylindrical"]}"#);
}

#[test]
fn a_pair_outside_the_catalog_and_a_missing_block_are_listed_as_they_are() {
    let mut f = Fixture::new(fixture_text("Pigeon/Default").as_bytes());
    let game = f.game.clone();
    let data = f.ok("enemyList", Json::object(vec![("gameRoot", Json::str(&game))]));
    assert_eq!(data.get("current").and_then(|c| c.get("cylindrical")).unwrap().to_compact(), r#"{"model":"Pigeon","skin":"Default"}"#);
    std::fs::write(&f.target, br#"{"characterModelOverride":{"Cuboid":{"characterModel":"Ghost","characterSkin":"Default"}}}"#).unwrap();
    let data = f.ok("enemyList", Json::object(vec![("gameRoot", Json::str(&game))]));
    assert_eq!(data.get("current").unwrap().to_compact(), r#"{"cylindrical":null,"cuboid":{"model":"Ghost","skin":"Default"},"spheroid":null}"#);
}

#[test]
fn apply_changes_only_the_two_strings_and_records_the_backup() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    assert_eq!(f.bytes(), original(), "a preview must not write the game");
    let (reply, progress) = f.request("execute", Fixture::execute_args(&plan_id));
    let data = reply.get("data").unwrap();
    assert_eq!(data.get("status").and_then(Json::as_str), Some("completed"), "{}", reply.to_compact());
    let expected = fixture_text("Stylized Ecto/Default").replacen("\"characterModel\": \"Stylized Ecto\"", "\"characterModel\": \"Ghost\"", 1);
    assert_eq!(String::from_utf8(f.bytes()).unwrap(), expected);

    let phases: Vec<String> = progress.iter().map(|p| p.get("data").and_then(|d| d.get("phase")).and_then(Json::as_str).unwrap().to_string()).collect();
    assert_eq!(phases, ["preparing", "protecting", "installing", "verifying", "verifying"]);
    assert_eq!(progress[0].get("operationId").and_then(Json::as_str), Some("op-1"));

    let batch = data.get("batchId").and_then(Json::as_str).unwrap().to_string();
    let (raw, install) = f.manifest(&batch);
    assert_eq!(install.get("Status").and_then(Json::as_str), Some("completed"));
    // Saved more than once, so the timestamp is in its round-trip form (probe, 2026-09-30).
    let created = install.get("CreatedAt").and_then(Json::as_str).unwrap();
    assert_eq!(json::round_trip_date(created).as_deref(), Some(created));
    assert!(raw.starts_with(r#"{"Version":1,"Id":""#), "{raw}");
    let item = &install.get("Items").and_then(Json::as_array).unwrap()[0];
    assert_eq!(item.get("State").and_then(Json::as_str), Some("applied"));
    let backup = f.backup_root().join(&batch).join(item.get("Backup").and_then(Json::as_str).unwrap());
    assert_eq!(std::fs::read(backup).unwrap(), original());

    let (pristine_raw, pristine) = f.manifest("pristine");
    assert_eq!(pristine.get("Status").and_then(Json::as_str), Some("protected"));
    // Written once, never re-read and saved: still `ToString('o')`, seven fraction digits.
    assert_eq!(pristine.get("CreatedAt").and_then(Json::as_str).unwrap().len(), 28, "{pristine_raw}");
    let first = &pristine.get("Items").and_then(Json::as_array).unwrap()[0];
    let protected = f.backup_root().join("pristine").join(first.get("Backup").and_then(Json::as_str).unwrap());
    assert_eq!(std::fs::read(protected).unwrap(), original());

    // A second change keeps the first protection's records, and lists newest first. The
    // PowerShell engine saves the first-protection manifest again on every install, even with
    // nothing to add, so its timestamp then takes the round-trip form too.
    let first_created = pristine.get("CreatedAt").and_then(Json::as_str).unwrap().to_string();
    let plan_id = f.plan("cylindrical", "Meso", "Genji");
    assert_eq!(f.ok("execute", Fixture::execute_args(&plan_id)).get("status").and_then(Json::as_str), Some("completed"));
    let expected_pristine = pristine_raw.replace(&first_created, &json::round_trip_date(&first_created).unwrap());
    assert_eq!(f.manifest("pristine").0, expected_pristine);
    let game = f.game.clone();
    let listed = f.ok("backups", Json::object(vec![("gameRoot", Json::str(&game))]));
    let records = listed.get("records").and_then(Json::as_array).unwrap();
    assert_eq!(records.len(), 2);
    assert_ne!(records[0].get("id").and_then(Json::as_str), Some(batch.as_str()));
    assert_eq!(records[1].get("id").and_then(Json::as_str), Some(batch.as_str()));
    assert_eq!(listed.get("hasPristine"), Some(&Json::Bool(true)));
    assert_eq!(records[0].get("categories").unwrap().to_compact(), r#"["primary"]"#);
}

#[test]
fn encodings_and_preambles_survive_a_change() {
    let text = fixture_text("Stylized Ecto/Default");
    let mut bom = vec![0xEF, 0xBB, 0xBF];
    bom.extend_from_slice(text.as_bytes());
    let mut utf16 = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() { utf16.extend_from_slice(&unit.to_le_bytes()); }
    for bytes in [bom, utf16] {
        let mut f = Fixture::new(&bytes);
        let plan_id = f.plan("cuboid", "Mummy", "Default");
        assert_eq!(f.ok("execute", Fixture::execute_args(&plan_id)).get("status").and_then(Json::as_str), Some("completed"));
        let after = f.bytes();
        assert_eq!(after[..2], bytes[..2]);
        let file = super::text::TextFile::decode(&after);
        let expected = text.replacen("\"Cuboid\":\r\n\t\t{\r\n\t\t\t\"characterModel\": \"Ghost\"", "\"Cuboid\":\r\n\t\t{\r\n\t\t\t\"characterModel\": \"Mummy\"", 1);
        assert_eq!(String::from_utf16_lossy(&file.text), expected);
    }
}

#[test]
fn refusals_name_the_problem_in_both_languages() {
    let mut f = Fixture::new(&original());
    let cases = [
        ("humanoid", "Ghost", "Default", "Unknown enemy shape: \"humanoid\"."),
        ("cylindrical", "Does Not Exist", "Default", "\"Does Not Exist / Default\" is not a catalog skin for this shape."),
        ("cuboid", "Stylized Ecto", "Default", "\"Stylized Ecto / Default\" is not a catalog skin for this shape."),
        ("spheroid", "Meso", "Genji", "\"Meso / Genji\" is not a catalog skin for this shape."),
        ("cylindrical", "Stylized Ecto", "Default", "\"Stylized Ecto / Default\" is already the equipped skin."),
    ];
    for (shape, model, skin, en) in cases {
        let error = f.plan_error(shape, model, skin);
        assert_eq!((code(&error), english(&error)), ("ENGINE_ERROR", en));
    }
    std::fs::write(&f.target, br#"{"floatSettings":{"EFloatSettingId::XSens":0.91}}"#).unwrap();
    let error = f.plan_error("cylindrical", "Ghost", "Default");
    assert_eq!(english(&error), "The current settings are missing characterModelOverride.\"Cylindrical\". Open the Skin Browser in the game once.");
    assert_eq!(f.bytes(), br#"{"floatSettings":{"EFloatSettingId::XSens":0.91}}"#, "a missing block is never created");
    std::fs::write(&f.target, br#"{"characterModelOverride":{"Cylindrical":{"characterModel":"Ghost"}}}"#).unwrap();
    let error = f.plan_error("cylindrical", "Mummy", "Default");
    assert_eq!(english(&error), "characterModelOverride.\"Cylindrical\" is missing a required key. Open the Skin Browser in the game once.");
}

#[test]
fn the_request_envelope_is_checked_before_anything_runs() {
    let mut f = Fixture::new(&original());
    let game = f.game.clone();
    let extra = Json::object(vec![("gameRoot", Json::str(&game)), ("shape", Json::str("cylindrical")), ("model", Json::str("Ghost")), ("skin", Json::str("Default")), ("revision", Json::int(1)), ("extra", Json::int(1))]);
    assert_eq!(english(&f.error("planEnemy", extra)), "args contains an unknown field: extra.");
    let negative = Json::object(vec![("gameRoot", Json::str(&game)), ("shape", Json::str("cylindrical")), ("model", Json::str("Ghost")), ("skin", Json::str("Default")), ("revision", Json::int(-1))]);
    assert_eq!(english(&f.error("planEnemy", negative)), "revision must be a non-negative integer.");
    assert_eq!(english(&f.error("removeEverything", Json::object(vec![]))), "Unknown operation: removeEverything.");
    let no_args = Json::object(vec![("v", Json::int(1)), ("requestId", Json::str("x")), ("op", Json::str("gameState"))]);
    let reply = f.session.handle(&no_args, &mut |_| {});
    assert_eq!(reply.to_compact(), r#"{"v":1,"requestId":null,"type":"reply","ok":false,"error":{"code":"ENGINE_ERROR","message":"request is missing field: args","messageEn":"request is missing field: args.","path":null}}"#);
    assert_eq!(f.ok("gameState", Json::object(vec![])), Json::str("closed"));
    assert_eq!(f.bytes(), original());
}

#[test]
fn execute_checks_the_plan_it_is_given() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    assert_eq!(code(&f.error("execute", Fixture::execute_args("0123"))), "PLAN_MISSING");
    // A wrong plan id leaves the real plan executable; a wrong confirmation consumes it.
    let wrong = Json::object(vec![("operationId", Json::str("o")), ("planId", Json::str(&plan_id)), ("confirmation", Json::str("restore")), ("allowConflicts", Json::Bool(false))]);
    assert_eq!(code(&f.error("execute", wrong)), "PLAN_STALE");
    assert_eq!(code(&f.error("execute", Fixture::execute_args(&plan_id))), "PLAN_MISSING");
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    let allow = Json::object(vec![("operationId", Json::str("o")), ("planId", Json::str(&plan_id)), ("confirmation", Json::str("install")), ("allowConflicts", Json::Bool(true))]);
    assert_eq!(code(&f.error("execute", allow)), "CONFLICT");
    assert_eq!(f.bytes(), original());
}

#[test]
fn settings_that_changed_after_the_preview_stop_the_write() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    let mut changed = original();
    changed.push(b' ');
    std::fs::write(&f.target, &changed).unwrap();
    assert_eq!(code(&f.error("execute", Fixture::execute_args(&plan_id))), "PLAN_STALE");
    assert_eq!(f.bytes(), changed);
}

#[test]
fn a_running_game_blocks_the_preview_and_the_write() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cuboid", "Mummy", "Default");
    f.host.running_from_call.set(Some(0));
    assert_eq!(code(&f.error("execute", Fixture::execute_args(&plan_id))), "GAME_RUNNING");
    assert_eq!(code(&f.plan_error("cuboid", "Mummy", "Default")), "GAME_RUNNING");
    assert_eq!(f.bytes(), original());
    let game = f.game.clone();
    assert_eq!(f.ok("backups", Json::object(vec![("gameRoot", Json::str(&game))])).get("records").unwrap().to_compact(), "[]");
}

#[test]
fn a_failed_write_rolls_the_batch_back() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    f.host.faults.borrow_mut().push("file-change".to_string());
    let (reply, progress) = f.request("execute", Fixture::execute_args(&plan_id));
    let data = reply.get("data").unwrap();
    assert_eq!(data.get("status").and_then(Json::as_str), Some("rolled-back"), "{}", reply.to_compact());
    assert_eq!(data.get("errors").unwrap().to_compact(), r#"["Injected failure at file-change"]"#);
    assert_eq!(data.get("errorsEn").unwrap().to_compact(), r#"["Injected failure at file-change"]"#);
    assert_eq!(data.get("items").and_then(Json::as_array).unwrap()[0].get("state").and_then(Json::as_str), Some("restored"));
    assert_eq!(progress.last().and_then(|p| p.get("data")).and_then(|d| d.get("phase")).and_then(Json::as_str), Some("rolling-back"));
    assert_eq!(f.bytes(), original());
    let batch = data.get("batchId").and_then(Json::as_str).unwrap().to_string();
    assert_eq!(f.manifest(&batch).1.get("Status").and_then(Json::as_str), Some("rolled-back"));
    // A rolled-back batch is finished: the next preview is allowed.
    f.host.faults.borrow_mut().clear();
    f.plan("cylindrical", "Ghost", "Default");
}

#[test]
fn a_game_that_starts_mid_install_leaves_the_batch_recovery_required() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    let calls = f.host.calls.get();
    // Install checks once, the file change twice: the game "starts" just before the rename.
    f.host.running_from_call.set(Some(calls + 3));
    let data = f.ok("execute", Fixture::execute_args(&plan_id));
    assert_eq!(data.get("status").and_then(Json::as_str), Some("recovery-required"), "{}", data.to_compact());
    assert_eq!(data.get("errors").and_then(Json::as_array).unwrap().len(), 2);
    assert_eq!(f.bytes(), original());
    f.host.running_from_call.set(None);
    let error = f.plan_error("cylindrical", "Ghost", "Default");
    assert_eq!((code(&error), english(&error)), ("RECOVERY_REQUIRED", "An unfinished operation must be recovered before changing the enemy skin."));
    let game = f.game.clone();
    let records = f.ok("backups", Json::object(vec![("gameRoot", Json::str(&game))]));
    assert_eq!(records.get("records").and_then(Json::as_array).unwrap()[0].get("status").and_then(Json::as_str), Some("recovery-required"));
}

#[test]
fn a_held_lock_reports_busy() {
    let mut f = Fixture::new(&original());
    let plan_id = f.plan("cylindrical", "Ghost", "Default");
    let lock = Path::new(&f.local).join("Aimloom/locks/palette.lock");
    std::fs::create_dir_all(lock.parent().unwrap()).unwrap();
    let _held = platform::open_exclusive(&lock).unwrap();
    let error = f.error("execute", Fixture::execute_args(&plan_id));
    assert_eq!(code(&error), "BUSY");
    assert!(english(&error).starts_with("Another Aimloom may be running, or the lock files could not be used: \""));
    assert_eq!(f.bytes(), original());
}

#[test]
fn the_worker_loop_answers_one_line_per_request() {
    let mut f = Fixture::new(&original());
    let input = "[]\nnot json\n{\"v\":1,\"requestId\":\"g\",\"op\":\"gameState\",\"args\":{}}\n";
    let mut output = Vec::new();
    session::run_jsonl(&mut f.session, input.as_bytes(), &mut output).unwrap();
    let lines: Vec<String> = String::from_utf8(output).unwrap().lines().map(str::to_string).collect();
    assert_eq!(lines.len(), 3);
    assert!(lines[0].contains(r#""message":"request must be a JSON object.""#), "{}", lines[0]);
    assert!(lines[1].starts_with(r#"{"v":1,"requestId":null,"type":"reply","ok":false,"error":{"code":"ENGINE_ERROR","message":"Invalid JSON request: "#), "{}", lines[1]);
    assert_eq!(lines[2], r#"{"v":1,"requestId":"g","type":"reply","ok":true,"data":"closed"}"#);
}

#[test]
fn a_saved_copy_replies_with_the_names_the_app_decodes() {
    let mut f = Fixture::new(&original());
    let out = f.root.join("out");
    std::fs::create_dir_all(&out).unwrap();
    let png = super::profiles::base64(&[1, 2, 3]);
    let game = f.game.clone();
    let data = f.ok("exportFile", Json::object(vec![("directory", Json::str(out.to_string_lossy())), ("fileName", Json::str("copy.png")), ("base64", Json::str(png)), ("gameRoot", Json::str(&game))]));
    // The App refuses unknown fields: a reply in any other casing fails there (it did, 2026-10-01).
    let decoded: crate::installer::protocol::ExportedFile = serde_json::from_str(&data.to_compact()).unwrap();
    assert_eq!(decoded.bytes, 3);
}

/// A release's runtime root is `<exe dir>\scripts`, which is not shipped: `discover` still looks
/// for the sample pack beside `Aimloom.exe`, through the root's parent.
#[test]
fn the_release_runtime_root_finds_a_sample_pack_beside_the_exe() {
    let dir = crate::engine::paths::temp_dir_without_links().join(format!("kvk-runtime-root-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("KVK Settings 2025")).unwrap();
    let root = crate::engine::runtime_root(&dir);
    assert!(!root.exists(), "the scripts folder is never created");
    let found = crate::engine::discover::default_pack(&root.to_string_lossy()).expect("the pack beside the exe");
    assert!(found.replace('\\', "/").ends_with("KVK Settings 2025"), "{found}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// An engine bug in one request answers that request with a bilingual ENGINE_ERROR instead of
/// unwinding out of the worker loop, as the PowerShell worker caught each request's errors.
#[test]
fn a_panicking_request_gets_an_engine_error_reply_and_a_normal_one_passes_through() {
    let (reply, panicked) = crate::engine::session::guard_request_for_test(Json::str("r1"), || panic!("an engine bug"));
    assert!(panicked);
    assert_eq!(reply.get("requestId").and_then(Json::as_str), Some("r1"));
    assert_eq!(reply.get("ok"), Some(&Json::Bool(false)));
    let error = reply.get("error").unwrap();
    assert_eq!(error.get("code").and_then(Json::as_str), Some("ENGINE_ERROR"));
    assert!(error.get("message").and_then(Json::as_str).unwrap().contains("引擎内部出错"));
    assert!(crate::installer::protocol::is_english(error.get("messageEn").and_then(Json::as_str).unwrap()));
    let (fine, panicked) = crate::engine::session::guard_request_for_test(Json::str("r2"), || Json::str("ok"));
    assert!(!panicked);
    assert_eq!(fine, Json::str("ok"));
}


/// The engine's half of "one data folder, never two" (`Engine::data_root`; the App's half is
/// `data_root` in `installer/worker.rs`): `Aimloom` wins when it exists, an old
/// `KovaaKConfigInstaller` is adopted by one rename when it does not, and a fresh machine gets
/// `Aimloom` without anything being created by the lookup.
#[test]
fn the_engine_adopts_the_old_data_folder_once_and_never_splits_the_data() {
    let base = super::paths::temp_dir_without_links().join(format!("kvk-data-root-{}", super::store::new_guid()));
    let engine = |local: &Path| super::store::Engine::new(Box::new(TestHost(Rc::new(HostState::default())))).data_root(&local.to_string_lossy()).unwrap();

    let fresh = base.join("fresh");
    std::fs::create_dir_all(&fresh).unwrap();
    assert!(engine(&fresh).ends_with("Aimloom"));
    assert_eq!(std::fs::read_dir(&fresh).unwrap().count(), 0, "resolving creates nothing");

    let old = base.join("old");
    std::fs::create_dir_all(old.join("KovaaKConfigInstaller/backups")).unwrap();
    std::fs::write(old.join("KovaaKConfigInstaller/backups/marker.txt"), b"first protection").unwrap();
    assert!(engine(&old).ends_with("Aimloom"));
    assert_eq!(std::fs::read(old.join("Aimloom/backups/marker.txt")).unwrap(), b"first protection");
    assert!(!old.join("KovaaKConfigInstaller").exists(), "the old folder was renamed, not copied");

    let both = base.join("both");
    std::fs::create_dir_all(both.join("Aimloom")).unwrap();
    std::fs::create_dir_all(both.join("KovaaKConfigInstaller")).unwrap();
    std::fs::write(both.join("KovaaKConfigInstaller/marker.txt"), b"left alone").unwrap();
    assert!(engine(&both).ends_with("Aimloom"));
    assert_eq!(std::fs::read(both.join("KovaaKConfigInstaller/marker.txt")).unwrap(), b"left alone");
    assert!(!both.join("Aimloom/marker.txt").exists());

    let _ = std::fs::remove_dir_all(&base);
}

/// The favourites ride the Profile route: they never need a game folder and never touch it.
#[test]
fn favourites_are_read_and_saved_through_the_worker_boundary() {
    let mut f = Fixture::new(&original());
    let favorites = Json::object(vec![("theme", Json::Array(vec![Json::str("Clean Dark.json")])), ("audio", Json::Array(vec![Json::str("hit.wav")]))]);
    let empty = f.ok("profileFavoritesRead", Json::object(vec![]));
    assert_eq!(empty.to_compact(), r#"{"favorites":{"theme":[],"audio":[]}}"#);
    let saved = f.ok("profileFavoritesSave", Json::object(vec![("favorites", favorites.clone())]));
    assert_eq!(saved.get("favorites"), Some(&favorites));
    assert_eq!(f.ok("profileFavoritesRead", Json::object(vec![])), saved);
    let refused = f.error("profileFavoritesSave", Json::object(vec![("favorites", Json::object(vec![("theme", Json::Array(vec![Json::str("x.wav")])), ("audio", Json::Array(vec![]))]))]));
    assert_eq!(code(&refused), "ENGINE_ERROR");
    assert!(crate::installer::protocol::is_english(english(&refused)));
    assert_eq!(f.bytes(), original(), "the game is untouched");
    assert!(!Path::new(&f.local).join("Aimloom/backups").exists(), "no backup is made");
}

#[test]
fn a_manifest_timestamp_with_a_wide_character_at_the_cut_does_not_panic() {
    let key = |text: &str| super::txn::created_key(&Json::object(vec![("CreatedAt", Json::str(text))]));
    assert_eq!(key("2026-09-30T08:09:10.123Z"), ("2026-09-30T08:09:10".to_string(), "1230000".to_string()));
    // Byte 19 falls inside the three-byte character.
    let wide = format!("{}日.5", "x".repeat(18));
    assert_eq!(key(&wide).0.len(), 18);
    assert_eq!(key("2026-09-30T08:09:1日").0, "2026-09-30T08:09:1");
    assert_eq!(key("").0, "");
}

#[test]
fn an_abandoned_import_preview_is_swept_when_a_session_starts_and_when_the_plan_is_dropped() {
    let mut fixture = Fixture::new(&original());
    let previews = Path::new(&fixture.local).join("Aimloom/import-previews");
    let orphan = previews.join("0123456789abcdef0123456789abcdef");
    std::fs::create_dir_all(orphan.join("themes")).unwrap();
    std::fs::write(orphan.join("PrimaryUserSettings.json"), b"{}").unwrap();
    let other = previews.join("keep-me");
    std::fs::create_dir_all(&other).unwrap();
    fixture.ok("gameState", Json::object(vec![]));
    assert!(!orphan.exists(), "the first request sweeps what an earlier session left");
    assert!(other.exists(), "only 32-hex staging folders are touched");

    let drop = fixture.root.join("drop");
    std::fs::create_dir_all(&drop).unwrap();
    std::fs::write(drop.join("a.wav"), b"RIFF a").unwrap();
    let args = Json::object(vec![("gameRoot", Json::str(&fixture.game)), ("paths", Json::Array(vec![Json::str(drop.join("a.wav").to_string_lossy())])), ("includeSettings", Json::Bool(false)), ("revision", Json::int(1))]);
    let count = || std::fs::read_dir(&previews).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().len() == 32).count();
    let preview = fixture.ok("planImport", args);
    assert_eq!(count(), 1);
    // A plan of another kind replaces it: the held stage goes, and executing the new one still works.
    let enemy = Json::object(vec![("gameRoot", Json::str(&fixture.game)), ("shape", Json::str("Cylindrical")), ("model", Json::str("Ghost")), ("skin", Json::str("Default")), ("revision", Json::int(1))]);
    let _ = fixture.request("planEnemy", enemy);
    assert_eq!(count(), 0, "a dropped Import plan takes its staging folder with it");
    let stale = fixture.error("execute", Fixture::execute_args(preview.get("planId").and_then(Json::as_str).unwrap()));
    assert_eq!(code(&stale), "PLAN_MISSING");
}
