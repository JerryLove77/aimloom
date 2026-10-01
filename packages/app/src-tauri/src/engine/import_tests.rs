//! Quick import (`planImport`) through the worker's request boundary: what a drop is read as,
//! why a file is not added, and that what is added can be restored to exactly what was there.

use std::path::{Path, PathBuf};

use super::json::Json;
use super::tests::{code, english, original, Fixture};
use crate::installer::protocol::is_english;

fn write(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// The smallest crosshair the engine accepts: an 8-bit RGBA, non-interlaced IHDR, then IEND.
fn png(side: u32) -> Vec<u8> {
    let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&side.to_be_bytes());
    bytes.extend_from_slice(&side.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes.extend_from_slice(b"IEND");
    bytes.extend_from_slice(&[0xAE, 0x42, 0x60, 0x82]);
    bytes
}

fn theme(name: &str) -> Vec<u8> { format!("{{\r\n\t\"themeName\": \"{name}\",\r\n\t\"wallColor\": 1\r\n}}").into_bytes() }

struct Dropped { fixture: Fixture, drop: PathBuf }

impl Dropped {
    fn new() -> Self {
        let fixture = Fixture::new(&original());
        let drop = fixture.root.join("拖入 drop");
        std::fs::create_dir_all(&drop).unwrap();
        Dropped { fixture, drop }
    }

    fn game(&self, relative: &str) -> PathBuf { Path::new(&self.fixture.game).join("FPSAimTrainer").join(relative) }

    fn args(&self, paths: &[&Path], include_settings: bool) -> Json {
        Json::object(vec![
            ("gameRoot", Json::str(&self.fixture.game)),
            ("paths", Json::Array(paths.iter().map(|p| Json::str(p.to_string_lossy())).collect())),
            ("includeSettings", Json::Bool(include_settings)), ("revision", Json::int(1)),
        ])
    }

    fn plan(&mut self, paths: &[&Path], include_settings: bool) -> Json {
        let args = self.args(paths, include_settings);
        self.fixture.ok("planImport", args)
    }

    fn refusal(&mut self, paths: &[&Path], include_settings: bool) -> Json {
        let args = self.args(paths, include_settings);
        self.fixture.error("planImport", args)
    }

    fn execute(&mut self, preview: &Json) -> Json {
        let plan_id = preview.get("planId").and_then(Json::as_str).unwrap().to_string();
        self.fixture.ok("execute", Fixture::execute_args(&plan_id))
    }
}

/// (key, action, reason) for every row, in preview order.
fn rows(preview: &Json) -> Vec<(String, String, Option<String>)> {
    preview.get("rows").and_then(Json::as_array).unwrap().iter().map(|r| (
        r.get("key").and_then(Json::as_str).unwrap().to_string(),
        r.get("action").and_then(Json::as_str).unwrap().to_string(),
        r.get("reason").and_then(Json::as_str).map(str::to_string),
    )).collect()
}

fn row<'a>(preview: &'a Json, key: &str) -> &'a Json {
    preview.get("rows").and_then(Json::as_array).unwrap().iter().find(|r| r.get("key").and_then(Json::as_str) == Some(key)).unwrap_or_else(|| panic!("no row {key}: {}", preview.to_compact()))
}

fn reason(preview: &Json, key: &str) -> Option<String> { row(preview, key).get("reason").and_then(Json::as_str).map(str::to_string) }
fn action(preview: &Json, key: &str) -> String { row(preview, key).get("action").and_then(Json::as_str).unwrap().to_string() }

fn skipped(preview: &Json) -> Vec<String> {
    preview.get("skipped").and_then(Json::as_array).unwrap().iter().map(|s| Path::new(s.as_str().unwrap()).file_name().unwrap().to_string_lossy().into_owned()).collect()
}

fn stages(local: &str) -> usize {
    std::fs::read_dir(Path::new(local).join("Aimloom/import-previews")).map_or(0, |d| d.count())
}

#[test]
fn another_session_cannot_sweep_a_live_import_preview() {
    let mut d = Dropped::new();
    let a = d.drop.join("a.wav");
    write(&a, b"RIFF previewed");
    let preview = d.plan(&[&a], false);
    let mut other = super::session::Session::new(
        Box::new(super::tests::TestHost(d.fixture.host.clone())),
        &d.fixture.local, &d.fixture.root.to_string_lossy(),
    ).unwrap();
    other.handle(&Json::object(vec![("v", Json::int(1)), ("requestId", Json::str("other")),
        ("op", Json::str("gameState")), ("args", Json::object(vec![]))]), &mut |_| {});
    assert_eq!(stages(&d.fixture.local), 1, "another session's startup must preserve the held plan");
    let second = other.handle(&Json::object(vec![("v", Json::int(1)), ("requestId", Json::str("other-plan")),
        ("op", Json::str("planImport")), ("args", d.args(&[&a], false))]), &mut |_| {});
    assert_eq!(second.get("ok"), Some(&Json::Bool(true)), "{}", second.to_compact());
    assert_eq!(stages(&d.fixture.local), 2, "planning in another session must also preserve the first preview");
    assert_eq!(d.execute(&preview).get("status").and_then(Json::as_str), Some("completed"));
    assert_eq!(std::fs::read(d.game("sounds/a.wav")).unwrap(), b"RIFF previewed");
    assert_eq!(stages(&d.fixture.local), 1);
    other.discard_plan();
    assert_eq!(stages(&d.fixture.local), 0);
}

#[test]
fn dropping_a_preview_cleans_its_stage_while_the_engine_stays_alive() {
    let d = Dropped::new();
    let a = d.drop.join("a.wav");
    write(&a, b"RIFF previewed");
    let engine = super::store::Engine::new(Box::new(super::tests::TestHost(d.fixture.host.clone())));
    let context = engine.context(&d.fixture.game, &d.fixture.local).unwrap();
    let plan = super::import::import_plan(&engine, &context, &[a.to_string_lossy().into_owned()], false).unwrap();
    let stage = plan.stage.path().to_string();
    drop(plan);
    assert!(!Path::new(&stage).exists(), "the preview owns its temporary files, not the engine");
}

#[test]
fn orphan_cleanup_skips_live_previews_and_dropping_them_cleans_up() {
    for single_file in [false, true] {
        let d = Dropped::new();
        let a = d.drop.join("a.wav");
        write(&a, b"RIFF previewed");
        let owner = super::store::Engine::new(Box::new(super::tests::TestHost(d.fixture.host.clone())));
        let context = owner.context(&d.fixture.game, &d.fixture.local).unwrap();
        let stage = if single_file {
            super::files::file_add_plan(&owner, &context, "sound", &a.to_string_lossy(),
                &super::paths::sha256_hex(b"RIFF previewed"), "a.wav").unwrap().stage
        } else {
            super::import::import_plan(&owner, &context, &[a.to_string_lossy().into_owned()], false).unwrap().stage
        };
        let cleaner = super::store::Engine::new(Box::new(super::tests::TestHost(d.fixture.host.clone())));
        super::import::remove_orphan_stages(&cleaner, &context);
        assert!(Path::new(stage.path()).is_dir());
        let path = stage.path().to_string();
        drop(stage);
        assert!(!Path::new(&path).exists());
    }
}

#[test]
fn every_kind_of_drop_is_read_and_anything_else_is_listed_as_not_recognised() {
    let mut d = Dropped::new();
    // A pack folder.
    let pack = d.drop.join("Pack");
    write(&pack.join("Themes/Pack Theme.json"), &theme("Pack Theme"));
    write(&pack.join("sounds/pack hit.wav"), b"RIFF pack");
    write(&pack.join("crosshairs/pack.png"), &png(16));
    write(&pack.join("readme.txt"), b"hello");
    // A kind folder on its own.
    write(&d.drop.join("sounds/kind kill.ogg"), b"OggS kind");
    // What Explorer's Extract All makes: the pack inside a folder of the same name.
    write(&d.drop.join("Extracted/Extracted/Themes/Nested.json"), &theme("Nested"));
    // Loose files, one of each kind, a ZIP and a folder that is none of these.
    write(&d.drop.join("loose 主题.json"), &theme("Loose 主题"));
    write(&d.drop.join("loose.wav"), b"RIFF loose");
    write(&d.drop.join("十字.png"), &png(8));
    write(&d.drop.join("pack.zip"), b"PK");
    write(&d.drop.join("Other/notes.txt"), b"x");
    let paths = [pack.clone(), d.drop.join("sounds"), d.drop.join("Extracted"), d.drop.join("loose 主题.json"), d.drop.join("loose.wav"),
        d.drop.join("十字.png"), d.drop.join("pack.zip"), d.drop.join("Other"), d.drop.join("missing.wav")];
    let refs: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let preview = d.plan(&refs, false);
    let mut keys: Vec<(String, String, Option<String>)> = rows(&preview);
    keys.sort();
    assert_eq!(keys, [
        ("crosshairs/pack.png", "create", None), ("crosshairs/十字.png", "create", None),
        ("sounds/kind kill.ogg", "create", None), ("sounds/loose.wav", "create", None), ("sounds/pack hit.wav", "create", None),
        ("themes/Nested.json", "create", None), ("themes/Pack Theme.json", "create", None), ("themes/loose 主题.json", "create", None),
    ].map(|(k, a, r): (&str, &str, Option<&str>)| (k.to_string(), a.to_string(), r.map(str::to_string))));
    let mut not_recognised = skipped(&preview);
    not_recognised.sort();
    assert_eq!(not_recognised, ["missing.wav", "notes.txt", "pack.zip", "readme.txt"]);
    assert_eq!(preview.get("packRoot"), Some(&Json::Null));
    assert_eq!(preview.get("kind").and_then(Json::as_str), Some("install"));
    // A source is shown where the player has it, never the staging copy.
    assert_eq!(row(&preview, "sounds/loose.wav").get("source").and_then(Json::as_str), Some(d.drop.join("loose.wav").to_string_lossy().as_ref()));
    assert!(!d.game("sounds/loose.wav").exists(), "a preview writes nothing to the game");

    let report = d.execute(&preview);
    assert_eq!(report.get("status").and_then(Json::as_str), Some("completed"), "{}", report.to_compact());
    assert_eq!(std::fs::read(d.game("Saved/SaveGames/Themes/loose 主题.json")).unwrap(), theme("Loose 主题"));
    assert_eq!(std::fs::read(d.game("sounds/kind kill.ogg")).unwrap(), b"OggS kind");
    assert_eq!(std::fs::read(d.game("crosshairs/十字.png")).unwrap(), png(8));
    assert_eq!(std::fs::read(&d.fixture.target).unwrap(), original(), "settings are untouched without Advanced");
    assert_eq!(stages(&d.fixture.local), 0, "the staging folder goes once the import has run");
}

#[test]
fn files_are_read_by_their_format_whatever_the_folders_are_called_down_to_three_levels() {
    let mut d = Dropped::new();
    // A folder of downloads with no pack layout at all, and a sub-folder of crosshairs in it.
    let mine = d.drop.join("我的音效 和背景");
    write(&mine.join("hit.wav"), b"RIFF hit");
    write(&mine.join("kill.OGG"), b"OggS kill");
    write(&mine.join("Night.json"), &theme("Night"));
    write(&mine.join("准星们/dot.png"), &png(8));
    write(&mine.join("a/b/c/deep.wav"), b"RIFF three levels down");
    write(&mine.join("a/b/c/d/too-deep.wav"), b"RIFF four levels down");
    // A png inside a folder called sounds is still a crosshair: the format decides.
    write(&mine.join("sounds/plus.png"), &png(16));
    let preview = d.plan(&[&mine], false);
    let mut keys: Vec<String> = rows(&preview).into_iter().map(|(k, a, _)| format!("{k} {a}")).collect();
    keys.sort();
    assert_eq!(keys, ["crosshairs/dot.png create", "crosshairs/plus.png create", "sounds/deep.wav create", "sounds/hit.wav create", "sounds/kill.OGG create", "themes/Night.json create"]);
    assert_eq!(skipped(&preview), ["d"], "a folder deeper than three levels is listed, not searched");
}

#[test]
fn a_drop_with_too_many_files_is_refused_before_anything_is_staged() {
    let mut d = Dropped::new();
    let many = d.drop.join("many");
    std::fs::create_dir_all(&many).unwrap();
    for i in 0..5001 { std::fs::write(many.join(format!("{i}.txt")), b"x").unwrap(); }
    let error = d.refusal(&[&many], false);
    assert!(english(&error).contains("too many files"), "{}", error.to_compact());
    assert_eq!(stages(&d.fixture.local), 0);
}

#[test]
fn a_file_already_in_the_game_is_skipped_with_its_reason_and_never_overwritten() {
    let mut d = Dropped::new();
    write(&d.game("sounds/Hit.wav"), b"RIFF game hit");
    write(&d.game("sounds/Kill.ogg"), b"OggS game kill");
    write(&d.game("crosshairs/dot.png"), &png(4));
    write(&d.game("Saved/SaveGames/Themes/Old.json"), &theme("Blue"));
    write(&d.drop.join("same/Hit.wav"), b"RIFF game hit");
    write(&d.drop.join("different/HIT.wav"), b"RIFF another hit");
    write(&d.drop.join("Kill.wav"), b"RIFF a kill");
    write(&d.drop.join("dot.png"), &png(5));
    write(&d.drop.join("New Blue.json"), &theme("blue"));
    let (same, different) = (d.drop.join("same/Hit.wav"), d.drop.join("different/HIT.wav"));
    let (kill, dot, blue) = (d.drop.join("Kill.wav"), d.drop.join("dot.png"), d.drop.join("New Blue.json"));

    let preview = d.plan(&[&same, &kill, &dot, &blue], false);
    assert_eq!(reason(&preview, "sounds/Hit.wav").as_deref(), Some("exists-same"));
    assert_eq!(reason(&preview, "sounds/Kill.wav").as_deref(), Some("sound-stem-taken"));
    assert_eq!(reason(&preview, "crosshairs/dot.png").as_deref(), Some("exists-different"));
    assert_eq!(reason(&preview, "themes/New Blue.json").as_deref(), Some("theme-name-taken"));
    assert!(rows(&preview).iter().all(|(_, a, _)| a == "skip"));
    assert_eq!(preview.get("categories").unwrap().to_compact(), "[]");
    let report = d.execute(&preview);
    assert_eq!(report.get("status").and_then(Json::as_str), Some("no-change"));
    assert_eq!(report.get("batchId"), Some(&Json::Null));

    let preview = d.plan(&[&different], false);
    assert_eq!(reason(&preview, "sounds/HIT.wav").as_deref(), Some("exists-different"), "names compare without case");
    assert!(row(&preview, "sounds/HIT.wav").get("target").and_then(Json::as_str).unwrap().ends_with("Hit.wav"), "the target is the file in the game");
    assert_eq!(std::fs::read(d.game("sounds/Hit.wav")).unwrap(), b"RIFF game hit");
    assert_eq!(std::fs::read(d.game("crosshairs/dot.png")).unwrap(), png(4));
}

#[test]
fn the_first_of_two_files_with_one_name_wins() {
    let mut d = Dropped::new();
    write(&d.drop.join("a/Hit.wav"), b"RIFF first");
    write(&d.drop.join("b/hit.WAV"), b"RIFF second");
    write(&d.drop.join("c/Hit.ogg"), b"OggS third");
    write(&d.drop.join("a/One.json"), &theme("Twin"));
    write(&d.drop.join("b/Two.json"), &theme("twin"));
    let paths = [d.drop.join("a/Hit.wav"), d.drop.join("b/hit.WAV"), d.drop.join("c/Hit.ogg"), d.drop.join("a/One.json"), d.drop.join("b/Two.json")];
    let refs: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let preview = d.plan(&refs, false);
    assert_eq!(rows(&preview), [
        ("sounds/Hit.wav".to_string(), "create".to_string(), None),
        ("themes/One.json".to_string(), "create".to_string(), None),
        ("sounds/hit.WAV".to_string(), "skip".to_string(), Some("duplicate-in-drop".to_string())),
        ("sounds/Hit.ogg".to_string(), "skip".to_string(), Some("duplicate-in-drop".to_string())),
        ("themes/Two.json".to_string(), "skip".to_string(), Some("duplicate-in-drop".to_string())),
    ]);
    d.execute(&preview);
    assert_eq!(std::fs::read(d.game("sounds/Hit.wav")).unwrap(), b"RIFF first");
}

#[test]
fn a_file_the_game_cannot_use_is_skipped_with_the_engine_s_words_in_both_languages() {
    let mut d = Dropped::new();
    write(&d.drop.join("Broken 坏.json"), b"{ not json");
    write(&d.drop.join("Nameless.json"), b"{\"wallColor\": 1}");
    write(&d.drop.join("semi;colon.wav"), b"RIFF");
    write(&d.drop.join("photo.png"), b"\x89PNG not really a png at all, just some bytes padding it out");
    let mut huge = png(16);
    huge.resize(2 * 1024 * 1024 + 1, 0);
    write(&d.drop.join("huge.png"), &huge);
    write(&d.drop.join("empty.wav"), b"");
    let mut big = b"RIFF".to_vec();
    big.resize(8 * 1024 * 1024 + 1, 0);
    write(&d.drop.join("big.wav"), &big);
    let paths = ["Broken 坏.json", "Nameless.json", "semi;colon.wav", "photo.png", "huge.png", "empty.wav", "big.wav"].map(|n| d.drop.join(n));
    let refs: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let preview = d.plan(&refs, false);
    for (key, _, why) in rows(&preview) {
        assert_eq!(why.as_deref(), Some("invalid"), "{key}");
        let detail = row(&preview, &key).get("detail").unwrap();
        let en = detail.get("messageEn").and_then(Json::as_str).unwrap();
        assert!(is_english(en), "{key}: {en}");
        assert!(!detail.get("message").and_then(Json::as_str).unwrap().is_empty());
    }
    assert_eq!(rows(&preview).len(), 7);
    assert!(row(&preview, "themes/Broken 坏.json").get("detail").unwrap().get("messageEn").and_then(Json::as_str).unwrap().contains("\"Broken 坏.json\""));
}

#[test]
fn personal_settings_are_planned_only_when_the_player_asks_and_are_restored_exactly() {
    let mut d = Dropped::new();
    let pack = d.drop.join("Pack");
    let mine = br#"{"floatSettings":{"EFloatSettingId::XSens":2.5}}"#.to_vec();
    write(&pack.join("PrimaryUserSettings.json"), &mine);
    write(&pack.join("UI.json"), b"{\"ui\":1}");
    write(&pack.join("Palette.ini"), b"[Palette]");
    write(&pack.join("sounds/new.wav"), b"RIFF new");

    let preview = d.plan(&[&pack], false);
    for key in ["primary/PrimaryUserSettings.json", "ui/UI.json", "palette/Palette.ini"] {
        assert_eq!(reason(&preview, key).as_deref(), Some("settings-not-included"), "{key}");
    }
    assert_eq!(preview.get("categories").unwrap().to_compact(), r#"["sounds"]"#);

    let preview = d.plan(&[&pack], true);
    assert_eq!(action(&preview, "primary/PrimaryUserSettings.json"), "replace");
    assert_eq!(action(&preview, "ui/UI.json"), "create");
    assert_eq!(action(&preview, "palette/Palette.ini"), "create");
    assert_eq!(stages(&d.fixture.local), 1, "a new preview removes the one it replaced");
    let report = d.execute(&preview);
    assert_eq!(report.get("status").and_then(Json::as_str), Some("completed"), "{}", report.to_compact());
    assert_eq!(std::fs::read(&d.fixture.target).unwrap(), mine);
    assert_eq!(std::fs::read(d.game("sounds/new.wav")).unwrap(), b"RIFF new");

    // Restoring the import batch deletes exactly what it added and puts the settings back.
    let batch = report.get("batchId").and_then(Json::as_str).unwrap().to_string();
    let game = d.fixture.game.clone();
    let restore = d.fixture.ok("planRestore", Json::object(vec![("gameRoot", Json::str(&game)), ("sourceId", Json::str(&batch)), ("revision", Json::int(2))]));
    let mut planned: Vec<(String, String)> = restore.get("rows").and_then(Json::as_array).unwrap().iter()
        .map(|r| (r.get("key").and_then(Json::as_str).unwrap().to_string(), r.get("action").and_then(Json::as_str).unwrap().to_string())).collect();
    planned.sort();
    assert_eq!(planned, [("palette/Palette.ini", "delete"), ("primary/PrimaryUserSettings.json", "restore"), ("sounds/new.wav", "delete"), ("ui/UI.json", "delete")]
        .map(|(k, a)| (k.to_string(), a.to_string())));
    let plan_id = restore.get("planId").and_then(Json::as_str).unwrap().to_string();
    let execute = Json::object(vec![("operationId", Json::str("op-restore")), ("planId", Json::str(plan_id)), ("confirmation", Json::str("restore")), ("allowConflicts", Json::Bool(false))]);
    let restored = d.fixture.ok("execute", execute);
    assert_eq!(restored.get("status").and_then(Json::as_str), Some("restored"), "{}", restored.to_compact());
    assert_eq!(std::fs::read(&d.fixture.target).unwrap(), original());
    assert!(!d.game("sounds/new.wav").exists());
    assert!(!d.game("Saved/SaveGames/UI.json").exists());
    assert!(d.game("sounds").is_dir(), "a folder the game already had stays");
}

#[test]
fn a_running_game_an_unfinished_batch_and_a_bad_request_are_refused_before_anything_is_staged() {
    let mut d = Dropped::new();
    write(&d.drop.join("a.wav"), b"RIFF a");
    let a = d.drop.join("a.wav");
    d.fixture.host.running_from_call.set(Some(1));
    let error = d.refusal(&[&a], false);
    assert_eq!(code(&error), "GAME_RUNNING");
    d.fixture.host.running_from_call.set(None);
    assert_eq!(stages(&d.fixture.local), 0);

    let too_many: Vec<PathBuf> = (0..65).map(|i| d.drop.join(format!("{i}.wav"))).collect();
    let refs: Vec<&Path> = too_many.iter().map(PathBuf::as_path).collect();
    let error = d.refusal(&refs, false);
    assert!(english(&error).contains("1 to 64"), "{}", error.to_compact());
    let error = d.refusal(&[], false);
    assert!(is_english(english(&error)));

    // A batch the game interrupted must be recovered first.
    let game = d.fixture.game.clone();
    let enemy = d.fixture.ok("planEnemy", Json::object(vec![("gameRoot", Json::str(&game)), ("shape", Json::str("cylindrical")), ("model", Json::str("Ghost")), ("skin", Json::str("Default")), ("revision", Json::int(1))]));
    let calls = d.fixture.host.calls.get();
    d.fixture.host.running_from_call.set(Some(calls + 3));
    let plan_id = enemy.get("planId").and_then(Json::as_str).unwrap().to_string();
    let data = d.fixture.ok("execute", Fixture::execute_args(&plan_id));
    assert_eq!(data.get("status").and_then(Json::as_str), Some("recovery-required"));
    d.fixture.host.running_from_call.set(None);
    let error = d.refusal(&[&a], false);
    assert_eq!(code(&error), "RECOVERY_REQUIRED");
    assert_eq!(stages(&d.fixture.local), 0);
}

#[test]
fn a_target_that_appears_after_the_preview_stops_the_write_and_a_changed_source_does_not_change_what_is_added() {
    let mut d = Dropped::new();
    write(&d.drop.join("a.wav"), b"RIFF previewed");
    write(&d.drop.join("b.wav"), b"RIFF b");
    let (a, b) = (d.drop.join("a.wav"), d.drop.join("b.wav"));
    let preview = d.plan(&[&a], false);
    write(&d.drop.join("a.wav"), b"RIFF changed later");
    let report = d.execute(&preview);
    assert_eq!(report.get("status").and_then(Json::as_str), Some("completed"));
    assert_eq!(std::fs::read(d.game("sounds/a.wav")).unwrap(), b"RIFF previewed", "what is added is what was previewed");

    let preview = d.plan(&[&b], false);
    write(&d.game("sounds/b.wav"), b"RIFF put there meanwhile");
    let plan_id = preview.get("planId").and_then(Json::as_str).unwrap().to_string();
    let error = d.fixture.error("execute", Fixture::execute_args(&plan_id));
    assert_eq!(code(&error), "PLAN_STALE", "{}", error.to_compact());
    assert_eq!(std::fs::read(d.game("sounds/b.wav")).unwrap(), b"RIFF put there meanwhile");
    assert_eq!(stages(&d.fixture.local), 0);
}

#[cfg(unix)]
#[test]
fn a_link_in_the_drop_refuses_the_whole_import() {
    let mut d = Dropped::new();
    write(&d.drop.join("real/x.wav"), b"RIFF");
    std::os::unix::fs::symlink(d.drop.join("real"), d.drop.join("sounds")).unwrap();
    let link = d.drop.join("sounds");
    let error = d.refusal(&[&link], false);
    assert!(english(&error).contains("Links and junctions"), "{}", error.to_compact());
}

/// The worker stopped while copying a file into the game: the copy sits beside its target under
/// the batch's own temporary name, and no record names it. Recovering the batch removes it, and
/// only it.
#[test]
fn recovering_an_interrupted_import_removes_the_batch_s_unrecorded_temporary_copy() {
    let mut d = Dropped::new();
    for i in 0..3 { write(&d.drop.join(format!("s{i}.wav")), format!("RIFF {i}").as_bytes()); }
    let paths: Vec<PathBuf> = (0..3).map(|i| d.drop.join(format!("s{i}.wav"))).collect();
    let refs: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let preview = d.plan(&refs, false);
    // The game "starts" after the first file: the batch stops part-way.
    let calls = d.fixture.host.calls.get();
    d.fixture.host.running_from_call.set(Some(calls + 4));
    let report = d.execute(&preview);
    d.fixture.host.running_from_call.set(None);
    let batch = report.get("batchId").and_then(Json::as_str).unwrap().to_string();
    assert_ne!(report.get("status").and_then(Json::as_str), Some("completed"), "{}", report.to_compact());
    // What a stop in the middle of a copy leaves: this batch's temp name, never recorded.
    let sounds = d.game("sounds");
    let orphan = sounds.join(format!("s2.wav.kvk-{batch}-{}.tmp", "a".repeat(32)));
    let other_batch = sounds.join(format!("s2.wav.kvk-{}-{}.tmp", "b".repeat(32), "c".repeat(32)));
    let not_ours = sounds.join("s2.wav.backup.tmp");
    for file in [&orphan, &other_batch, &not_ours] { write(file, b"partial"); }

    let game = d.fixture.game.clone();
    let restore = d.fixture.ok("planRestore", Json::object(vec![("gameRoot", Json::str(&game)), ("sourceId", Json::str(&batch)), ("revision", Json::int(2))]));
    let plan_id = restore.get("planId").and_then(Json::as_str).unwrap().to_string();
    let conflicts = restore.get("rows").and_then(Json::as_array).unwrap().iter().any(|r| r.get("conflict") == Some(&Json::Bool(true)));
    let execute = Json::object(vec![("operationId", Json::str("op-recover")), ("planId", Json::str(plan_id)), ("confirmation", Json::str("restore")), ("allowConflicts", Json::Bool(conflicts))]);
    let restored = d.fixture.ok("execute", execute);
    assert_eq!(restored.get("status").and_then(Json::as_str), Some("restored"), "{}", restored.to_compact());
    for i in 0..3 { assert!(!sounds.join(format!("s{i}.wav")).exists(), "s{i}.wav"); }
    assert!(!orphan.exists(), "the batch's own unrecorded temp copy is removed");
    assert!(other_batch.exists() && not_ours.exists(), "nothing that is not this batch's is touched");
}

#[test]
fn a_theme_the_plan_would_refuse_for_case_variant_keys_is_one_invalid_row_not_a_failed_import() {
    let mut d = Dropped::new();
    write(&d.drop.join("Twin.json"), b"{\"themeName\": \"Twin\", \"wallColor\": 1, \"WALLCOLOR\": 2}");
    write(&d.drop.join("Fine.json"), &theme("Fine"));
    let preview = d.plan(&[&d.drop.join("Twin.json"), &d.drop.join("Fine.json")], false);
    assert_eq!(reason(&preview, "themes/Twin.json").as_deref(), Some("invalid"));
    assert_eq!(action(&preview, "themes/Fine.json"), "create");
    let detail = row(&preview, "themes/Twin.json").get("detail").unwrap();
    let en = detail.get("messageEn").and_then(Json::as_str).unwrap();
    assert!(is_english(en) && en.contains("\"Twin.json\""), "{en}");
    assert!(detail.get("message").and_then(Json::as_str).unwrap().contains("Twin.json"));
    assert_eq!(stages(&d.fixture.local), 1);
}

#[test]
fn an_oversized_settings_file_or_duplicate_is_an_invalid_skip_before_it_is_read() {
    let mut d = Dropped::new();
    let mut big = b"{\"a\":\"".to_vec();
    big.resize(8 * 1024 * 1024 + 1, b'x');
    write(&d.drop.join("UI.json"), &big);
    write(&d.game("sounds/dup.wav"), b"RIFF in game");
    let mut dup = b"RIFF".to_vec();
    dup.resize(8 * 1024 * 1024 + 1, 0);
    write(&d.drop.join("dup.wav"), &dup);
    let preview = d.plan(&[&d.drop.join("UI.json"), &d.drop.join("dup.wav")], true);
    assert_eq!(reason(&preview, "ui/UI.json").as_deref(), Some("invalid"));
    assert_eq!(reason(&preview, "sounds/dup.wav").as_deref(), Some("invalid"));
    let en = row(&preview, "ui/UI.json").get("detail").unwrap().get("messageEn").and_then(Json::as_str).unwrap().to_string();
    assert!(en.contains("8 MiB"), "{en}");
}
