use app_lib::installer::protocol::{validate_read, ErrorCode, Issue};
use serde_json::json;

fn crosshair_add(file: &str) -> serde_json::Value {
    json!({"gameRoot":"D:/Game","file":file,"pngBase64":"AAAA","revision":1})
}
fn export(file: &str) -> serde_json::Value {
    json!({"directory":"D:/Exports","fileName":file,"base64":"AAAA","gameRoot":"D:/Game"})
}

#[test]
fn crosshair_names_are_limited_to_128_utf16_units_including_png() {
    // The engine measures the whole file name in characters. A byte limit cut Chinese names
    // short: 100 of 准 is 300 bytes, which the old 200-byte rule refused.
    let chinese = format!("{}.png", "准".repeat(100));
    let longest = format!("{}.png", "a".repeat(124));
    let too_long = format!("{}.png", "a".repeat(125));
    for op in ["planCrosshairAdd", "planCrosshair"] {
        assert!(validate_read(op, crosshair_add(&chinese)).is_ok(), "{op}: a 104-character Chinese name");
        assert!(validate_read(op, crosshair_add(&longest)).is_ok(), "{op}: 128 characters");
        let refused = validate_read(op, crosshair_add(&too_long)).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidPath, "{op}: 129 characters");
    }
    assert!(validate_read("exportFile", export(&chinese)).is_ok());
    assert!(validate_read("exportFile", export(&longest)).is_ok());
    assert_eq!(validate_read("exportFile", export(&too_long)).unwrap_err().code, ErrorCode::InvalidPath);
}

#[test]
fn crosshair_names_still_refuse_paths_and_other_extensions() {
    for bad in ["../escape.png", "a/b.png", "bare", ".hidden.png", "trailing.png ", "note.txt", "x.pn"] {
        assert!(validate_read("planCrosshairAdd", crosshair_add(bad)).is_err(), "{bad:?} must be refused");
    }
}

fn file_add(kind: &str, source: &str, file: &str) -> serde_json::Value {
    json!({"gameRoot":"D:/Game","kind":kind,"sourcePath":source,"sourceSha256":"a".repeat(64),"file":file,"revision":1})
}

#[test]
fn file_add_accepts_a_theme_and_a_sound_and_passes_the_source_through_unchanged() {
    let theme = file_add("theme", r"C:\Users\p\Downloads\Blue Hour.json", "Blue Hour.json");
    assert_eq!(validate_read("planFileAdd", theme.clone()).unwrap(), theme);
    for (source, file) in [("D:/sounds/hit.wav", "hit.wav"), ("D:/sounds/Bell.OGG", "Bell.OGG"), ("/home/p/命中.ogg", "命中.ogg")] {
        let sound = file_add("sound", source, file);
        assert_eq!(validate_read("planFileAdd", sound.clone()).unwrap(), sound, "{source}");
    }
    // The target may be renamed: a byte-for-byte copy under another name is still the original.
    assert!(validate_read("planFileAdd", file_add("theme", "C:/a/Blue.json", "Blue 2.json")).is_ok());
}

#[test]
fn file_add_refuses_unknown_fields_kinds_and_malformed_hashes() {
    let mut extra = file_add("theme", "C:/a/Blue.json", "Blue.json");
    extra["bytes"] = json!("AAAA");
    assert!(validate_read("planFileAdd", extra).is_err(), "the UI must not be able to send bytes");
    for kind in ["crosshair", "Theme", ""] {
        assert!(validate_read("planFileAdd", file_add(kind, "C:/a/Blue.json", "Blue.json")).is_err(), "kind {kind:?}");
    }
    for hash in ["", "abc", &"A".repeat(64), &"g".repeat(64), &"a".repeat(63), &"a".repeat(65)] {
        let mut args = file_add("theme", "C:/a/Blue.json", "Blue.json");
        args["sourceSha256"] = json!(hash);
        assert!(validate_read("planFileAdd", args).is_err(), "hash {hash:?}");
    }
}

#[test]
fn file_add_refuses_sources_that_are_not_plain_local_files_of_the_right_type() {
    for source in ["Blue.json", "../Blue.json", r"\\?\C:\a\Blue.json", r"\\.\pipe\Blue.json", "https://example.com/Blue.json",
                   "C:/a/../Blue.json", "C:/a/con.json", "C:/a/Blue.json ", "C:/a/Blue.wav", "C:/a/Blue"] {
        let refused = validate_read("planFileAdd", file_add("theme", source, "Blue.json")).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidPath, "{source:?}");
    }
    assert!(validate_read("planFileAdd", file_add("sound", "C:/a/hit.json", "hit.wav")).is_err());
    assert!(validate_read("planFileAdd", file_add("sound", "C:/a/hit.mp3", "hit.wav")).is_err());
}

#[test]
fn file_add_refuses_target_names_that_could_escape_split_a_list_or_change_type() {
    for bad in ["../a.json", "a/b.json", ".hidden.json", "a.json ", "a.txt", "a.wav", &format!("{}.json", "a".repeat(124))] {
        assert!(validate_read("planFileAdd", file_add("theme", "C:/a/Blue.json", bad)).is_err(), "theme {bad:?}");
    }
    // ';' separates sound names in the game's settings, so a stem must never carry one.
    for bad in ["a;b.wav", "../a.wav", "a.mp3", "a.json", ".a.ogg", "a.ogg.", &format!("{}.ogg", "a".repeat(125))] {
        assert!(validate_read("planFileAdd", file_add("sound", "C:/a/hit.wav", bad)).is_err(), "sound {bad:?}");
    }
    assert!(validate_read("planFileAdd", file_add("theme", "C:/a/Blue.json", &format!("{}.json", "准".repeat(100)))).is_ok());
}

#[test]
fn an_installed_theme_with_a_long_chinese_name_can_still_be_selected() {
    // planScheme names a file that already exists, so the limit is the file system's: 255
    // UTF-16 units. A byte limit refused names over about 85 Chinese characters.
    let long = format!("{}.json", "主".repeat(200));
    assert!(validate_read("planScheme", json!({"gameRoot":"D:/Game","file":long,"revision":1})).is_ok());
    let too_long = format!("{}.json", "主".repeat(251));
    assert!(validate_read("planScheme", json!({"gameRoot":"D:/Game","file":too_long,"revision":1})).is_err());
}

fn plan_enemy(shape: &str, model: &str, skin: &str) -> serde_json::Value {
    json!({"gameRoot":"D:/Game","shape":shape,"model":model,"skin":skin,"revision":1})
}

#[test]
fn plan_enemy_accepts_a_catalog_shaped_pair_and_refuses_an_unknown_shape_or_over_long_strings() {
    let args = plan_enemy("cylindrical", "Stylized Ecto", "Default");
    assert_eq!(validate_read("planEnemy", args.clone()).unwrap(), args);
    for shape in ["cuboid", "spheroid"] {
        assert!(validate_read("planEnemy", plan_enemy(shape, "Ghost", "Default")).is_ok(), "{shape}");
    }
    assert_eq!(validate_read("planEnemy", plan_enemy("humanoid", "Ghost", "Default")).unwrap_err().code, ErrorCode::EngineError);
    let longest = "a".repeat(64);
    assert!(validate_read("planEnemy", plan_enemy("cylindrical", &longest, "Default")).is_ok());
    let too_long = "a".repeat(65);
    assert_eq!(validate_read("planEnemy", plan_enemy("cylindrical", &too_long, "Default")).unwrap_err().code, ErrorCode::EngineError);
    assert_eq!(validate_read("planEnemy", plan_enemy("cylindrical", "", "Default")).unwrap_err().code, ErrorCode::EngineError);
    assert_eq!(validate_read("planEnemy", plan_enemy("cylindrical", "Ghost", "")).unwrap_err().code, ErrorCode::EngineError);
    let mut extra = args;
    extra["extra"] = json!(1);
    assert!(validate_read("planEnemy", extra).is_err(), "an unknown field must be refused");
}

#[test]
fn plan_profile_apply_accepts_a_safe_id_and_refuses_an_unsafe_one_or_an_unknown_field() {
    let args = json!({"gameRoot":"D:/Game","id":"combo-1","revision":1});
    assert_eq!(validate_read("planProfileApply", args.clone()).unwrap(), args);
    for id in ["../escape", "CON", "con", "com1", "", "A", &"a".repeat(65)] {
        let refused = validate_read("planProfileApply", json!({"gameRoot":"D:/Game","id":id,"revision":1})).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidPath, "{id:?}");
    }
    let mut extra = args.clone();
    extra["extra"] = json!(1);
    assert!(validate_read("planProfileApply", extra).is_err(), "an unknown field must be refused");
    let mut negative = args;
    negative["revision"] = json!(-1);
    assert!(validate_read("planProfileApply", negative).is_err(), "a negative revision must be refused");
}

#[test]
fn a_plain_issue_accepts_os_localized_text_without_panicking() {
    // `Issue::plain` carries OS text (an io::Error, a serde message), which on a Chinese
    // Windows is localized. `new`'s English debug_assert must not apply to it: a panic here
    // would break every `cargo test` run on a Chinese machine.
    let issue = Issue::plain(ErrorCode::InvalidPath, "系统找不到指定的路径。");
    assert_eq!(issue.message, "系统找不到指定的路径。");
    assert_eq!(issue.message_en, "系统找不到指定的路径。");
}
