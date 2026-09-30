//! End-to-end cases for the Rust engine, run through the same request boundary the worker
//! uses. They port `scripts/installer/tests/enemy.test.ps1` and the Enemy block of
//! `gui-protocol.test.ps1`, plus the write-core cases of `engine.test.ps1` that the Enemy path
//! reaches (rollback, recovery-required, the lock). Exact parity with PowerShell is the job of
//! the goldens (`tests/engine_parity.rs`); these pin behaviour on any host, the Mac included.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use super::json::{self, Json};
use super::session::{self, Session};
use super::store::Host;
use super::{platform, EngineError, EngineResult};

#[derive(Default)]
struct HostState { running_from_call: Cell<Option<usize>>, calls: Cell<usize>, faults: RefCell<Vec<String>> }

struct TestHost(Rc<HostState>);

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
fn fixture_text(cylindrical: &str) -> String {
    let (m, s) = cylindrical.split_once('/').unwrap();
    format!("{{\r\n\t\"floatSettings\":\r\n\t{{\r\n\t\t\"EFloatSettingId::XSens\": 0.91\r\n\t}},\r\n\t\"characterModelOverride\":\r\n\t{{\r\n\t\t\"Cylindrical\":\r\n\t\t{{\r\n\t\t\t\"characterModel\": \"{m}\",\r\n\t\t\t\"characterSkin\": \"{s}\"\r\n\t\t}},\r\n\t\t\"Cuboid\":\r\n\t\t{{\r\n\t\t\t\"characterModel\": \"Ghost\",\r\n\t\t\t\"characterSkin\": \"Default\"\r\n\t\t}},\r\n\t\t\"Spheroid\":\r\n\t\t{{\r\n\t\t\t\"characterModel\": \"Mummy\",\r\n\t\t\t\"characterSkin\": \"Default\"\r\n\t\t}}\r\n\t}},\r\n\t\"currentlySelectedBoundingBoxType\": \"Cuboid\",\r\n\t\"large\": 9007199254740993,\r\n\t\"stringSettings\":\r\n\t{{\r\n\t\t\"unchangedDate\": \"2026-09-15T00:00:00Z\"\r\n\t}}\r\n}}")
}

struct Fixture { root: PathBuf, game: String, local: String, target: PathBuf, host: Rc<HostState>, session: Session, next: u32 }

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        // The temp folder sits behind a link on macOS; the engine refuses links, as PowerShell does.
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
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

    fn request(&mut self, op: &str, args: Json) -> (Json, Vec<Json>) {
        self.next += 1;
        let request = Json::object(vec![("v", Json::int(1)), ("requestId", Json::str(format!("r{}", self.next))), ("op", Json::str(op)), ("args", args)]);
        let mut progress = Vec::new();
        let reply = self.session.handle(&request, &mut |line| progress.push(line));
        (reply, progress)
    }

    fn ok(&mut self, op: &str, args: Json) -> Json {
        let (reply, _) = self.request(op, args);
        assert_eq!(reply.get("ok"), Some(&Json::Bool(true)), "{op} failed: {}", reply.to_compact());
        reply.get("data").cloned().unwrap()
    }

    fn error(&mut self, op: &str, args: Json) -> Json {
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

    fn execute_args(plan_id: &str) -> Json {
        Json::object(vec![("operationId", Json::str("op-1")), ("planId", Json::str(plan_id)), ("confirmation", Json::str("install")), ("allowConflicts", Json::Bool(false))])
    }

    fn bytes(&self) -> Vec<u8> { std::fs::read(&self.target).unwrap() }

    fn backup_root(&self) -> PathBuf {
        let backups = Path::new(&self.local).join("Aimloom/backups");
        std::fs::read_dir(&backups).unwrap().next().unwrap().unwrap().path()
    }

    fn manifest(&self, id: &str) -> (String, Json) {
        let raw = std::fs::read_to_string(self.backup_root().join(id).join("manifest.json")).unwrap();
        let parsed = json::parse(&raw, json::ReadOptions { strings: json::Strings::Literal, ..json::ReadOptions::CONVERT_FROM_JSON }).unwrap();
        (raw, parsed)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); }
}

fn code(error: &Json) -> &str { error.get("code").and_then(Json::as_str).unwrap() }
fn english(error: &Json) -> &str { error.get("messageEn").and_then(Json::as_str).unwrap() }
fn original() -> Vec<u8> { fixture_text("Stylized Ecto/Default").into_bytes() }

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
