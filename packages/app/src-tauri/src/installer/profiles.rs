//! Validation for ordinary Profile JSON files, separate from game operations.
use std::collections::HashSet;
use serde_json::{Map, Value};
use super::protocol::{is_english, ErrorCode, Issue};

pub const MAX_PROFILE_BYTES: usize = 256 * 1024;

/// Why a Profile request or response was refused, in Chinese and English.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Fault { pub zh: String, pub en: String }

impl Fault {
    /// A failure worded only in English (a serializer error); both languages carry it.
    fn plain(message: String) -> Self { Self { zh: message.clone(), en: message } }
}

fn fault(zh: &str, en: &str) -> Fault { Fault { zh: zh.into(), en: en.into() } }

fn object<'a>(value: &'a Value, required: &[&str], optional: &[&str]) -> Result<&'a Map<String, Value>, Fault> {
    let map=value.as_object().ok_or_else(|| fault("Profile 字段必须是对象", "A Profile field must be an object."))?;
    if required.iter().any(|key| !map.contains_key(*key)) || map.keys().any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str())) {
        return Err(fault("Profile 字段缺失或包含未知字段", "A Profile field is missing or unknown."));
    }
    Ok(map)
}

fn text(value: &Value, limit: usize, single_line: bool) -> Result<&str, Fault> {
    let text=value.as_str().ok_or_else(|| fault("Profile 字段必须是文本", "A Profile field must be text."))?;
    if text.trim_matches(|c: char| c.is_whitespace() || c=='\u{feff}').is_empty() || text.encode_utf16().count()>limit || (single_line && text.contains(['\0','\r','\n'])) {
        return Err(fault("Profile 文本为空、过长或含无效字符", "A Profile text is empty, too long or has invalid characters."));
    }
    Ok(text)
}

/// The English twin of a player-facing row: present, not blank and free of CJK outside
/// double-quoted spans, so an English player never reads a Chinese *sentence* from a per-file
/// error while a quoted Chinese file name still reaches them (see `is_english`).
fn english(value: &Value) -> Result<(), Fault> {
    let message=text(value,4096,false)?;
    if !is_english(message) {return Err(fault("英文错误文本不能在引号外包含中文", "An English error text must not contain Chinese outside quoted names."));}
    Ok(())
}

pub(super) fn safe_id(value: &Value) -> Result<&str, Fault> {
    let id=value.as_str().ok_or_else(|| fault("Profile 标识必须是文本", "The Profile id must be text."))?;
    let allowed=id.len()<=64 && !id.is_empty() && id.as_bytes()[0].is_ascii_alphanumeric()
        && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c==b'_' || c==b'-');
    let reserved=matches!(id,"con"|"prn"|"aux"|"nul") || (id.len()==4 && (id.starts_with("com") || id.starts_with("lpt")) && matches!(id.as_bytes()[3],b'1'..=b'9'));
    if !allowed || reserved {return Err(fault("Profile 标识不是安全的文件名", "The Profile id is not a safe file name."));}
    Ok(id)
}

fn file(value: &Value, extensions: &[&str]) -> Result<(), Fault> {
    let path=text(value,4096,true)?;
    let normalized=path.replace('\\',"/");
    if normalized.starts_with("//?/") || normalized.starts_with("//./") {return Err(fault("不支持设备命名空间路径", "Device namespace paths are not supported."));}
    if let Some(colon)=path.find(':') {
        let prefix=&path[..colon];
        let scheme=!prefix.is_empty() && prefix.as_bytes()[0].is_ascii_alphabetic()
            && prefix.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c,b'+'|b'-'|b'.'));
        let drive=colon==1 && path.as_bytes()[0].is_ascii_alphabetic() && matches!(path.as_bytes().get(2),Some(b'/')|Some(b'\\'));
        if scheme && !drive {return Err(fault("仅支持普通本地文件路径", "Only ordinary local file paths are supported."));}
    }
    let lower=path.to_ascii_lowercase();
    if !extensions.iter().any(|extension| lower.ends_with(extension)) {return Err(fault("Profile 文件扩展名不受支持", "The Profile file extension is not supported."));}
    Ok(())
}

fn reference(value: &Value, extensions: &[&str]) -> Result<(), Fault> {
    let info = object(value, &["name", "path"], &[])?;
    text(&info["name"], 4096, true)?;
    file(&info["path"], extensions)
}

fn profile(value: &Value) -> Result<(), Fault> {
    // `crosshair` and `enemy` are both OPTIONAL and their values are never looked at. v0.1.3
    // removed the crosshair slot -- a crosshair cannot be switched from outside the game -- and
    // 2026-09-21 removed the enemy slot the same way: a Profile no longer manages the enemy. The
    // App no longer writes either key, but a Profile saved before each removal still carries it
    // and must keep opening. The same rule lives in `profiles/model.ts` and in the engine's
    // `Assert-KvkProfile`, and fixtures under `tests/installer/profiles/` hold all three layers
    // to it. The engine strips both keys on read and on save, so an unvalidated value can never
    // reach the disk.
    let map=object(value,&["schemaVersion","id","name","scheme","audio"],&["crosshair","enemy"])?;
    if map["schemaVersion"].as_f64()!=Some(1.0) {return Err(fault("不支持此 Profile 版本", "This Profile version is not supported."));}
    safe_id(&map["id"])?;text(&map["name"],128,true)?;
    if !map["scheme"].is_null() {
        reference(&map["scheme"], &[".json"])?;
    }
    if !map["audio"].is_null() {
        let audio=object(&map["audio"],&[],&["kill","spawn","mbsGood","mbsOkay","mbsBad","mbsChangeNow"])?;
        for list in audio.values() {
            let files=list.as_array().ok_or_else(|| fault("音效选择必须是数组", "A sound selection must be an array."))?;
            if files.len()>64 {return Err(fault("每个音效事件最多 64 项", "Each sound event holds at most 64 entries."));}
            for item in files {reference(item,&[".wav",".ogg"])?;}
        }
    }
    if serde_json::to_vec(value).map_err(|e| Fault::plain(e.to_string()))?.len()>MAX_PROFILE_BYTES {return Err(fault("Profile JSON 超过 256 KiB", "The Profile JSON is over 256 KiB."));}
    Ok(())
}

const MAX_ASSET_BYTES: usize = 8 * 1024 * 1024;

fn asset_extensions(kind: &Value) -> Result<&'static [&'static str], Fault> {
    match kind.as_str() {
        Some("scheme" | "enemy") => Ok(&[".json"]),
        Some("crosshair") => Ok(&[".png"]),
        Some("audio") => Ok(&[".wav", ".ogg"]),
        _ => Err(fault("资源类型无效", "The asset kind is not valid.")),
    }
}

fn asset_path(value: &Value) -> Result<String, Fault> {
    let path = text(value, 4096, true)?.replace('\\', "/");
    let drive = path.len() >= 3 && path.as_bytes()[0].is_ascii_alphabetic() && path.as_bytes()[1] == b':' && path.as_bytes()[2] == b'/';
    if !(drive || path.starts_with('/')) || path.starts_with("//?/") || path.starts_with("//./")
        || path.chars().enumerate().any(|(i,c)| c.is_control() || "<>\"|?*".contains(c) || (c == ':' && !(drive && i == 1))) {
        return Err(fault("请选择安全的完整资源路径", "Choose a safe, full path to the asset."));
    }
    for part in path.split('/').filter(|p| !p.is_empty()) {
        let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
        let reserved = matches!(stem.as_str(), "con"|"prn"|"aux"|"nul")
            || (stem.len()==4 && (stem.starts_with("com") || stem.starts_with("lpt")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if matches!(part,"."|"..") || part.ends_with([' ','.']) || reserved { return Err(fault("资源路径含不安全文件名", "The asset path contains an unsafe file name.")); }
    }
    Ok(path.trim_end_matches('/').to_string())
}

/// Also guards the source of a file import, which names a local file the same way.
pub(super) fn asset_file(kind: &Value, path: &Value) -> Result<String, Fault> {
    file(path, asset_extensions(kind)?)?;
    asset_path(path)
}

// Validate canonical RFC 4648 bytes without allocating a second 8 MiB buffer.
fn asset_base64(value: &Value) -> Result<(), Fault> {
    let encoded = value.as_str().ok_or_else(|| fault("资源编码必须是文本", "The asset encoding must be text."))?.as_bytes();
    if encoded.is_empty() || encoded.len() % 4 != 0 || encoded.len() > ((MAX_ASSET_BYTES+2)/3)*4 {return Err(fault("资源编码长度无效", "The asset encoding has an invalid length."));}
    let padding = encoded.iter().rev().take_while(|&&b| b==b'=').count();
    if padding>2 {return Err(fault("资源编码填充无效", "The asset encoding has invalid padding."));}
    let length = encoded.len()/4*3-padding;
    if length==0 || length>MAX_ASSET_BYTES {return Err(fault("资源大小超出限制", "The asset is over the size limit."));}
    let digit = |b| match b {b'A'..=b'Z'=>Some(b-b'A'),b'a'..=b'z'=>Some(b-b'a'+26),b'0'..=b'9'=>Some(b-b'0'+52),b'+'=>Some(62),b'/'=>Some(63),_=>None};
    let payload=&encoded[..encoded.len()-padding];
    if payload.iter().any(|&b|digit(b).is_none()) {return Err(fault("资源编码无效", "The asset encoding is not valid."));}
    let last=digit(*payload.last().ok_or_else(|| fault("资源编码为空", "The asset encoding is empty."))?).ok_or_else(|| fault("资源编码无效", "The asset encoding is not valid."))?;
    if (padding==2 && last & 15 != 0) || (padding==1 && last & 3 != 0) {return Err(fault("资源编码非规范", "The asset encoding is not canonical."));}
    Ok(())
}

fn asset_response(op: &str, args: &Value, value: &Value) -> Result<(), Fault> {
    if op=="profileAssetRead" {
        let map=object(value,&["path","mimeType","base64"],&[])?;
        let path=asset_file(&args["kind"],&map["path"])?;
        if path != asset_file(&args["kind"],&args["path"])? {return Err(fault("返回资源路径与请求不一致", "The returned asset path does not match the request."));}
        let lower=path.to_ascii_lowercase();
        let mime=if lower.ends_with(".json") {"application/json"} else if lower.ends_with(".png") {"image/png"} else if lower.ends_with(".wav") {"audio/wav"} else {"audio/ogg"};
        if map["mimeType"].as_str()!=Some(mime) {return Err(fault("资源 MIME 与类型不一致", "The asset MIME type does not match its kind."));}
        return asset_base64(&map["base64"]);
    }
    let map=object(value,&["directory","files","errors"],&[])?;
    let directory=asset_path(&map["directory"])?;
    if directory!=asset_path(&args["directory"])? {return Err(fault("返回目录与请求不一致", "The returned folder does not match the request."));}
    let files=map["files"].as_array().ok_or_else(|| fault("资源列表必须是数组", "The asset list must be an array."))?;
    let errors=map["errors"].as_array().ok_or_else(|| fault("错误列表必须是数组", "The error list must be an array."))?;
    if files.len()+errors.len()>1000 {return Err(fault("资源目录超过 1000 项", "The asset folder has more than 1000 entries."));}
    let mut names=HashSet::new();
    for item in files {
        let entry=object(item,&["name","path"],&[])?;
        let name=text(&entry["name"],4096,true)?;
        let path=asset_file(&args["kind"],&entry["path"])?;
        if name.contains(['/', '\\']) || path!=format!("{directory}/{name}") || !names.insert(name) {return Err(fault("资源文件名或路径无效", "An asset file name or path is not valid."));}
    }
    for error in errors {
        let entry=object(error,&["fileName","message","messageEn"],&[])?;
        let name=text(&entry["fileName"],4096,true)?;
        if name.contains(['/', '\\']) || !names.insert(name) {return Err(fault("资源错误文件名无效", "An asset error names an invalid file."));}
        text(&entry["message"],4096,false)?;english(&entry["messageEn"])?;
    }
    Ok(())
}

pub fn validate_profile_request(op: &str, args: Value) -> Result<Value, Issue> {
    let invalid=|fault: Fault|Issue::new(ErrorCode::EngineError,fault.zh,fault.en);
    match op {
        "profileAssetList" | "profileAssetRead" => {
            let key=if op=="profileAssetList" {"directory"} else {"path"};
            let map=object(&args,&["kind",key],&[]).map_err(invalid)?;
            asset_extensions(&map["kind"]).map_err(invalid)?;
            asset_path(&map[key]).map_err(invalid)?;
            if op=="profileAssetRead" {asset_file(&map["kind"],&map[key]).map_err(invalid)?;}
        }
        "profileList" => {object(&args,&[],&[]).map_err(invalid)?;}
        "profileRead"|"profileDelete" => {
            let map=object(&args,&["id"],&[]).map_err(invalid)?;
            safe_id(&map["id"]).map_err(|fault|Issue::new(ErrorCode::InvalidPath,fault.zh,fault.en))?;
        }
        "profileSave" => {
            let map=object(&args,&["profile"],&[]).map_err(invalid)?;
            if let Some(id)=map["profile"].get("id") {safe_id(id).map_err(|fault|Issue::new(ErrorCode::InvalidPath,fault.zh,fault.en))?;}
            profile(&map["profile"]).map_err(invalid)?;
        }
        _ => return Err(invalid(fault("不支持此 Profile 操作", "This Profile operation is not supported."))),
    }
    Ok(args)
}

fn response(op: &str, args: &Value, value: &Value) -> Result<(), Fault> {
    if matches!(op,"profileAssetList"|"profileAssetRead") {return asset_response(op,args,value);}
    match op {
        "profileList" => {
            let map=object(value,&["directory","profiles","errors"],&[])?;text(&map["directory"],4096,true)?;
            let profiles=map["profiles"].as_array().ok_or_else(|| fault("Profile 列表必须是数组", "The Profile list must be an array."))?;
            let mut ids=HashSet::new();
            for item in profiles {
                profile(item)?;
                if !ids.insert(item["id"].as_str().unwrap()) {return Err(fault("Profile 列表包含重复标识", "The Profile list contains a duplicate id."));}
            }
            for error in map["errors"].as_array().ok_or_else(|| fault("Profile 错误列表必须是数组", "The Profile error list must be an array."))? {
                let entry=object(error,&["fileName","message","messageEn"],&[])?;
                text(&entry["fileName"],4096,true)?;text(&entry["message"],4096,false)?;english(&entry["messageEn"])?;
            }
        }
        "profileRead"|"profileSave" => {
            let map=object(value,&["filePath","profile"],&[])?;
            let id=if op=="profileRead" {safe_id(&args["id"])?} else {safe_id(&args["profile"]["id"])?};
            let path=text(&map["filePath"],4096,true)?;
            if path.replace('\\',"/").rsplit('/').next()!=Some(format!("{id}.json").as_str()) {return Err(fault("Profile 返回路径与请求标识不一致", "The returned Profile path does not match the requested id."));}
            if map["profile"].is_null() {
                if op!="profileRead" {return Err(fault("保存操作没有返回 Profile", "The save did not return the Profile."));}
            } else {
                profile(&map["profile"])?;
                if map["profile"]["id"].as_str()!=Some(id) {return Err(fault("Profile 返回标识与请求不一致", "The returned Profile id does not match the request."));}
            }
        }
        "profileDelete" => {let map=object(value,&["deleted"],&[])?;if !map["deleted"].is_boolean(){return Err(fault("删除结果无效", "The delete result is not valid."));}}
        _ => return Err(fault("不支持此 Profile 响应", "This Profile response is not supported.")),
    }
    Ok(())
}

pub fn validate_profile_response(op: &str, args: &Value, value: Value) -> Result<Value, Issue> {
    response(op,args,&value).map_err(|fault|Issue::new(ErrorCode::WorkerUnavailable,
        format!("Profile 响应无效：{}",fault.zh),format!("The Profile response is not valid: {}",fault.en)))?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use super::super::protocol::has_cjk;

    fn good_profile() -> Value {
        json!({"schemaVersion":1,"id":"p1","name":"P","scheme":null,"audio":null,"crosshair":null,"enemy":null})
    }

    #[test]
    fn every_profile_refusal_is_bilingual() {
        let requests = [
            ("profileList", json!({"x":1})),
            ("profileList", json!([])),
            ("profileRead", json!({"id":"CON"})),
            ("profileRead", json!({"id":5})),
            ("profileRead", json!({"id":"con"})),
            ("profileSave", json!({"profile":{"schemaVersion":2,"id":"p1","name":"P","scheme":null,"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":"","scheme":null,"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":7,"scheme":null,"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":"P","scheme":{"name":"a","path":"//?/C:/a.json"},"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":"P","scheme":{"name":"a","path":"http://x/a.json"},"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":"P","scheme":{"name":"a","path":"C:/a.txt"},"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":"P","scheme":null,"audio":{"kill":{}},"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":{"schemaVersion":1,"id":"p1","name":"P","scheme":null,"audio":{"kill":vec![json!({"name":"a","path":"C:/a.wav"}); 65]},"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":"x"})),
            ("profileAssetList", json!({"kind":"video","directory":"C:/a"})),
            ("profileAssetList", json!({"kind":"scheme","directory":"relative/dir"})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a/con"})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.png"})),
            ("profileNope", json!({})),
        ];
        let mut refused = 0;
        for (op, args) in requests {
            let issue = validate_profile_request(op, args.clone()).expect_err(&format!("{op} {args}"));
            assert!(!issue.message.trim().is_empty(), "{op} {args}");
            assert!(!issue.message_en.trim().is_empty() && !has_cjk(&issue.message_en), "{op} {args}: {:?}", issue.message_en);
            refused += 1;
        }
        let responses = [
            ("profileList", json!({}), json!({"directory":"C:/P","profiles":[good_profile(),good_profile()],"errors":[]})),
            ("profileList", json!({}), json!({"directory":"C:/P","profiles":{},"errors":[]})),
            ("profileList", json!({}), json!({"directory":"C:/P","profiles":[],"errors":{}})),
            ("profileList", json!({}), json!({"directory":"C:/P","profiles":[],"errors":[{"fileName":"a.json","message":"坏了"}]})),
            ("profileList", json!({}), json!({"directory":"C:/P","profiles":[],"errors":[{"fileName":"a.json","message":"坏了","messageEn":"文件坏了"}]})),
            ("profileRead", json!({"id":"p1"}), json!({"filePath":"C:/P/p2.json","profile":null})),
            ("profileRead", json!({"id":"p1"}), json!({"filePath":"C:/P/p1.json","profile":{"schemaVersion":1,"id":"p2","name":"P","scheme":null,"audio":null,"crosshair":null,"enemy":null}})),
            ("profileSave", json!({"profile":good_profile()}), json!({"filePath":"C:/P/p1.json","profile":null})),
            ("profileDelete", json!({"id":"p1"}), json!({"deleted":"yes"})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.json"}), json!({"path":"C:/a/c.json","mimeType":"application/json","base64":"AAAA"})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.json"}), json!({"path":"C:/a/b.json","mimeType":"image/png","base64":"AAAA"})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.json"}), json!({"path":"C:/a/b.json","mimeType":"application/json","base64":"A==="})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.json"}), json!({"path":"C:/a/b.json","mimeType":"application/json","base64":"AB=="})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.json"}), json!({"path":"C:/a/b.json","mimeType":"application/json","base64":"A!AA"})),
            ("profileAssetRead", json!({"kind":"scheme","path":"C:/a/b.json"}), json!({"path":"C:/a/b.json","mimeType":"application/json","base64":""})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/b","files":[],"errors":[]})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/a","files":{},"errors":[]})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/a","files":[],"errors":{}})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/a","files":[{"name":"b.json","path":"C:/x/b.json"}],"errors":[]})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/a","files":[],"errors":[{"fileName":"a/b","message":"x","messageEn":"x"}]})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/a","files":[],"errors":[{"fileName":"b.json","message":"坏了"}]})),
            ("profileAssetList", json!({"kind":"scheme","directory":"C:/a"}), json!({"directory":"C:/a","files":[],"errors":[{"fileName":"b.json","message":"坏了","messageEn":"  "}]})),
            ("profileNope", json!({}), json!({})),
        ];
        for (op, args, value) in responses {
            let issue = validate_profile_response(op, &args, value.clone()).expect_err(&format!("{op} {value}"));
            assert!(has_cjk(&issue.message), "{op}: {:?}", issue.message);
            assert!(!issue.message_en.trim().is_empty() && !has_cjk(&issue.message_en), "{op} {value}: {:?}", issue.message_en);
            refused += 1;
        }
        assert!(refused > 30);
    }

    #[test]
    fn every_file_add_source_refusal_is_bilingual() {
        for (kind, path) in [("video", "C:/a.json"), ("scheme", "C:/a.txt"), ("scheme", "relative.json"), ("audio", "C:/con/a.wav")] {
            let fault = asset_file(&Value::from(kind), &Value::from(path)).unwrap_err();
            assert!(has_cjk(&fault.zh) && !fault.en.is_empty() && !has_cjk(&fault.en), "{kind} {path}: {fault:?}");
        }
    }
    /// The Rust third of `tests/installer/profiles/profile.saved.fixture.json` — what TypeScript
    /// really writes today. Earlier branches removed `crosshair`, then `enemy`, from that output
    /// while this validator still required one or the other, so every save on Windows would have
    /// failed; `good_profile()` above hand-writes both keys and therefore never noticed. The
    /// fixture is pinned to the serialiser by `saved-shape.test.ts` and to the engine by
    /// `profiles.test.ps1`.
    #[test]
    fn the_profile_typescript_really_saves_is_accepted() {
        let saved: Value = serde_json::from_str(include_str!("../../../tests/installer/profiles/profile.saved.fixture.json")).unwrap();
        assert!(saved.get("crosshair").is_none() && saved.get("enemy").is_none(), "the fixture must be what TypeScript writes today");
        validate_profile_request("profileSave", json!({ "profile": saved })).expect("a Profile saved by the App must validate");
    }

    /// A Profile written by v0.1.2 still carries a crosshair record. It must keep opening.
    #[test]
    fn a_profile_saved_before_the_crosshair_slot_was_removed_is_still_accepted() {
        validate_profile_request("profileSave", json!({ "profile": good_profile() })).expect("an old Profile must still validate");
    }

    /// A Profile written before 2026-09-21 still carries both a crosshair and an enemy record
    /// (`profile.legacy.fixture.json`, `tests/installer/profiles/`). It must keep opening in
    /// every layer: here, in `saved-shape.test.ts` and in `profiles.test.ps1`.
    #[test]
    fn a_profile_with_both_legacy_slots_is_still_accepted() {
        let legacy: Value = serde_json::from_str(include_str!("../../../tests/installer/profiles/profile.legacy.fixture.json")).unwrap();
        assert!(!legacy["crosshair"].is_null() && !legacy["enemy"].is_null(), "the fixture must actually carry both legacy slots");
        validate_profile_request("profileSave", json!({ "profile": legacy })).expect("a Profile with both legacy slots must still validate");
    }

}
