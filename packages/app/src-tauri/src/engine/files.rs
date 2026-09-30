//! Plans that place one file in the game: a crosshair replaced or added (`kvk-crosshair.ps1`), a
//! theme or sound added from outside (`kvk-import.ps1`), and the one write outside a plan, a
//! saved copy (`Export-KvkFile`). The bytes are copied as they are; nothing is re-encoded.

use std::path::Path;

use super::json::{self, Json};
use super::lists;
use super::paths::{self, assert_safe_path, join};
use super::profiles;
use super::store::{self, Context, Engine};
use super::text::eq_ignore_case;
use super::txn::{self, Plan};
use super::{EngineError, EngineResult};

const MAX_PNG: usize = 2 * 1024 * 1024;

fn fail(zh: impl Into<String>, en: impl Into<String>) -> EngineError { EngineError::coded("ENGINE_ERROR", zh, en) }

fn reserved_stem(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    ["con", "prn", "aux", "nul"].contains(&stem.as_str())
        || (stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

fn bad_name_char(c: char) -> bool { matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 0x20 }

/// The request's base64, as the service checks it: bounded, canonical, standard alphabet.
pub fn decode_base64(encoded: &str, invalid: (&str, &str), undecodable: (&str, &str), not_canonical: (&str, &str)) -> EngineResult<Vec<u8>> {
    let alphabet = |c: u8| c.is_ascii_alphanumeric() || c == b'+' || c == b'/';
    let body = encoded.trim_end_matches('=');
    let padding = encoded.len() - body.len();
    let shape = encoded.len() <= 4 * MAX_PNG.div_ceil(3) && encoded.len() % 4 == 0 && padding <= 2 && body.bytes().all(alphabet);
    if !shape { return Err(fail(invalid.0, invalid.1)); }
    let mut bytes = Vec::with_capacity(encoded.len() / 4 * 3);
    let value = |c: u8| -> u32 { match c { b'A'..=b'Z' => u32::from(c - b'A'), b'a'..=b'z' => u32::from(c - b'a') + 26, b'0'..=b'9' => u32::from(c - b'0') + 52, b'+' => 62, _ => 63 } };
    for chunk in encoded.as_bytes().chunks(4) {
        let pads = chunk.iter().filter(|&&c| c == b'=').count();
        if chunk[..4 - pads].iter().any(|&c| c == b'=') { return Err(fail(undecodable.0, undecodable.1)); }
        let n = chunk.iter().take(4 - pads).enumerate().fold(0u32, |acc, (i, &c)| acc | (value(c) << (18 - 6 * i)));
        let take = 3 - pads;
        if pads == 3 { return Err(fail(undecodable.0, undecodable.1)); }
        for i in 0..take { bytes.push(((n >> (16 - 8 * i)) & 0xFF) as u8); }
    }
    if profiles::base64(&bytes) != encoded { return Err(fail(not_canonical.0, not_canonical.1)); }
    Ok(bytes)
}

// ---- Crosshairs ----------------------------------------------------------------------------

/// `Assert-KvkCrosshairTargetName`.
pub fn assert_crosshair_name(name: &str) -> EngineResult<()> {
    let body_ok = name.to_ascii_lowercase().ends_with(".png") && name.len() > 4 && !name[..name.len() - 4].chars().any(bad_name_char);
    let invalid = name.trim().is_empty() || name.encode_utf16().count() > 128 || !body_ok
        || name.starts_with(['.', ' ']) || name.ends_with(['.', ' ']) || name.contains("..") || reserved_stem(name);
    if invalid {
        return Err(fail(
            format!("准星文件名无效：不能包含 \\ / : * ? \" < > | 或连续的点，不能以点或空格开头结尾，连同 .png 不超过 128 个字符 (invalid file name): {name}"),
            format!("The crosshair file name is not valid: it cannot contain \\ / : * ? < > | a double quote, or consecutive dots, cannot start or end with a dot or a space, and must be at most 128 characters including .png: \"{name}\"."),
        ));
    }
    Ok(())
}

/// `Assert-KvkCrosshairImage`: an 8-bit RGBA, non-interlaced PNG, 1 to 512 pixels a side.
pub fn assert_crosshair_image(bytes: &[u8]) -> EngineResult<(u64, u64)> {
    if bytes.len() < 45 || bytes.len() > MAX_PNG { return Err(fail("准星 PNG 必须在 45 字节到 2 MiB 之间 (size limit)。", "A crosshair PNG must be between 45 bytes and 2 MiB.")); }
    if bytes[..8] != [137, 80, 78, 71, 13, 10, 26, 10] { return Err(fail("准星 PNG 签名不正确 (damaged signature)。", "The crosshair PNG signature is not correct.")); }
    if bytes[12..16] != *b"IHDR" { return Err(fail("准星 PNG 缺少 IHDR。", "The crosshair PNG has no IHDR chunk.")); }
    if bytes[24] != 8 { return Err(fail("准星 PNG 必须是 8 位位深。", "A crosshair PNG must use 8-bit depth.")); }
    if bytes[25] != 6 { return Err(fail("准星 PNG 必须是 RGBA 颜色类型。", "A crosshair PNG must use the RGBA color type.")); }
    if bytes[26] != 0 { return Err(fail("准星 PNG 必须使用 deflate 压缩。", "A crosshair PNG must use deflate compression.")); }
    if bytes[28] != 0 { return Err(fail("准星 PNG 不能是隔行扫描。", "A crosshair PNG must not be interlaced.")); }
    let be = |i: usize| u64::from(u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]));
    let (width, height) = (be(16), be(20));
    if !(1..=512).contains(&width) || !(1..=512).contains(&height) {
        return Err(fail("准星 PNG 尺寸必须在 1 到 512 之间 (image size)。", "A crosshair PNG must be between 1 and 512 pixels on each side."));
    }
    Ok((width, height))
}

fn crosshairs_directory(engine: &Engine, context: &Context) -> EngineResult<String> {
    engine.assert_context(context)?;
    Ok(join(&context.game_root, "FPSAimTrainer/crosshairs"))
}

fn stage_outside_game(context: &Context, stage: &str, message: &str) -> EngineResult<()> {
    let prefix = format!("{}{}", context.game_root, paths::SEP);
    if stage.to_lowercase().starts_with(&prefix.to_lowercase()) { return Err(EngineError::plain(message)); }
    Ok(())
}

/// A staged crosshair replacement: the pack folder, its metadata's hash and the reviewed plan.
pub struct CrosshairReplacement { pub pack_root: String, pub target_file: String, pub metadata_hash: String, pub plan: Plan }

/// `Read-KvkCrosshairReplacement` + `New-KvkCrosshairReplacementPlan`: the staged pack must hold
/// exactly the declared PNG, byte for byte, replacing a crosshair that exists.
fn replacement_plan(engine: &Engine, context: &Context, pack_root: &str) -> EngineResult<CrosshairReplacement> {
    engine.assert_context(context)?;
    let root = paths::full_path(pack_root)?;
    assert_safe_path(&root)?;
    let path = join(&root, "crosshair-replacement.json");
    assert_safe_path(&path)?;
    let size = std::fs::metadata(&path).ok().filter(|m| m.is_file()).map(|m| m.len());
    if !size.is_some_and(|s| s <= 65_536) { return Err(EngineError::plain("Missing or oversized crosshair replacement metadata.")); }
    let metadata_hash = store::hash(&path)?.unwrap_or_default();
    let text = txn::read_all_text(&std::fs::read(&path).map_err(|e| EngineError::io(&e))?);
    let options = json::ReadOptions { strings: json::Strings::Literal, ..json::ReadOptions::CONVERT_FROM_JSON };
    let m = json::parse(&text, options).map_err(|e| EngineError::plain(e.0))?;
    let one = matches!(m.get("schemaVersion").and_then(Json::number), Some(json::Number::Int(1)) | Some(json::Number::Double(1.0)));
    if !one || m.get("kind").and_then(Json::as_str) != Some("crosshair-replacement") || m.get("requiresConfirmation") != Some(&Json::Bool(true)) || m.get("gameSelectionChanged") != Some(&Json::Bool(false)) {
        return Err(EngineError::plain("Invalid crosshair replacement metadata."));
    }
    let target_file = m.get("targetFileName").and_then(Json::as_str).unwrap_or_default().to_string();
    assert_crosshair_name(&target_file)?;
    let png = m.get("png").cloned().unwrap_or(Json::Null);
    let declared = format!("crosshairs/{target_file}");
    if png.get("file").and_then(Json::as_str) != Some(declared.as_str()) || !png.get("sha256").and_then(Json::as_str).is_some_and(paths::is_hash) {
        return Err(EngineError::plain("Invalid crosshair asset identity."));
    }
    let catalog = txn::pack_files(&root)?;
    if catalog.items.len() != 1 || catalog.items[0].category != "crosshairs" || catalog.items[0].key != declared {
        return Err(EngineError::plain("Replacement pack must contain exactly the declared crosshair asset."));
    }
    let png_path = catalog.items[0].source.clone();
    assert_safe_path(&png_path)?;
    let bytes = std::fs::read(&png_path).map_err(|e| EngineError::io(&e))?;
    let number = |field: &str| png.get(field).and_then(Json::number).and_then(|n| match n { json::Number::Int(i) => Some(i), _ => None });
    if bytes.len() < 45 || bytes.len() > MAX_PNG || number("bytes") != Some(bytes.len() as i64) { return Err(EngineError::plain("Invalid crosshair PNG length.")); }
    if Some(paths::sha256_hex(&bytes).as_str()) != png.get("sha256").and_then(Json::as_str) { return Err(EngineError::plain("PNG differs from replacement preview.")); }
    let header: [u8; 16] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52];
    if bytes[..16] != header || bytes[24] != 8 || bytes[25] != 6 || bytes[26] != 0 || bytes[27] != 0 || bytes[28] != 0 {
        return Err(EngineError::plain("Expected canonical RGBA PNG from preview service."));
    }
    let be = |i: usize| i64::from(u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]));
    let (width, height) = (be(16), be(20));
    if !(1..=512).contains(&width) || !(1..=512).contains(&height) || number("width") != Some(width) || number("height") != Some(height) {
        return Err(EngineError::plain("Crosshair PNG dimensions differ from preview."));
    }
    if store::hash(&path)?.as_deref() != Some(metadata_hash.as_str()) { return Err(EngineError::plain("Replacement metadata changed while reading.")); }
    let game = context.game_root.trim_end_matches(paths::SEP);
    if eq_ignore_case(&root, &context.game_root) || root.to_lowercase().starts_with(&format!("{game}{}", paths::SEP).to_lowercase()) {
        return Err(EngineError::plain("Replacement pack must be outside the game directory."));
    }
    let plan = txn::new_plan(engine, context, &root, &["crosshairs".to_string()])?;
    if plan.items.len() != 1 || plan.items[0].before.is_none() { return Err(EngineError::plain("Replacement target does not exist; use normal install for new crosshairs.")); }
    Ok(CrosshairReplacement { pack_root: root, target_file, metadata_hash, plan })
}

fn stage_png(engine: &Engine, context: &Context, file: &str, png: &[u8], message: &str) -> EngineResult<(String, String)> {
    let stage = join(&engine.data_root(&context.local_data_root)?, &format!("crosshair-previews/{}", store::new_guid()));
    stage_outside_game(context, &stage, message)?;
    store::new_directory(&join(&stage, "crosshairs"))?;
    let png_path = join(&join(&stage, "crosshairs"), file);
    store::write_durable(&png_path, png)?;
    Ok((stage, png_path))
}

/// `New-KvkCrosshairImagePlan`: new pixels for a crosshair that exists.
pub fn image_plan(engine: &Engine, context: &Context, file: &str, png: &[u8]) -> EngineResult<CrosshairReplacement> {
    engine.assert_context(context)?;
    assert_crosshair_name(file)?;
    let (width, height) = assert_crosshair_image(png)?;
    let target = join(&crosshairs_directory(engine, context)?, file);
    assert_safe_path(&target)?;
    if !Path::new(&target).is_file() {
        return Err(fail(format!("游戏目录里没有这个准星文件 (target does not exist): {file}"), format!("The game folder has no such crosshair file: \"{file}\".")));
    }
    let (stage, png_path) = stage_png(engine, context, file, png, "Crosshair preview staging must be outside the game directory.")?;
    let sha = store::hash(&png_path)?.unwrap_or_default();
    // The metadata shape the Node preview service writes, read back by the check above.
    let metadata = Json::object(vec![
        ("schemaVersion", Json::int(1)), ("kind", Json::str("crosshair-replacement")), ("targetFileName", Json::str(file)),
        ("png", Json::object(vec![
            ("file", Json::str(format!("crosshairs/{file}"))), ("sha256", Json::str(sha)), ("bytes", Json::int(png.len() as i64)),
            ("width", Json::int(width as i64)), ("height", Json::int(height as i64)),
        ])),
        ("warnings", Json::Array(Vec::new())), ("requiresConfirmation", Json::Bool(true)), ("gameSelectionChanged", Json::Bool(false)),
    ]);
    store::write_atomic_json(&join(&stage, "crosshair-replacement.json"), &metadata)?;
    let replacement = replacement_plan(engine, context, &stage)?;
    if replacement.target_file != file || replacement.plan.items.len() != 1 || replacement.plan.items[0].key != format!("crosshairs/{file}") {
        return Err(EngineError::coded("PLAN_STALE", "准星预览没有指向所选的文件。", "Crosshair preview did not resolve to the chosen slot."));
    }
    Ok(replacement)
}

/// `Invoke-KvkCrosshairImageReplacement`: the staged pack is read again and must still be the
/// one reviewed; the write may run while the game is open (it only places a file).
pub fn image_execute(engine: &Engine, context: &Context, reviewed: &CrosshairReplacement, observer: txn::Observer) -> EngineResult<txn::Report> {
    let fresh = replacement_plan(engine, context, &reviewed.pack_root)?;
    if fresh.metadata_hash != reviewed.metadata_hash || fresh.target_file != reviewed.target_file || reviewed.plan.pack_root != fresh.pack_root
        || reviewed.plan.categories.len() != 1 || reviewed.plan.categories[0] != "crosshairs" {
        return Err(EngineError::plain("Replacement preview is stale or invalid."));
    }
    txn::install(engine, context, &reviewed.plan, true, observer)
}

/// `New-KvkCrosshairAddPlan`: a new crosshair; adding never overwrites.
pub fn add_plan(engine: &Engine, context: &Context, file: &str, png: &[u8]) -> EngineResult<Plan> {
    engine.assert_context(context)?;
    assert_crosshair_name(file)?;
    assert_crosshair_image(png)?;
    let target = join(&crosshairs_directory(engine, context)?, file);
    assert_safe_path(&target)?;
    if Path::new(&target).is_file() {
        return Err(fail(format!("crosshairs 文件夹里已经有「{file}」，新增不会覆盖它；请换一个文件名 (file already exists)。"), format!("The crosshairs folder already has \"{file}\", and adding never overwrites it. Choose another file name.")));
    }
    let (stage, png_path) = stage_png(engine, context, file, png, "Crosshair staging must be outside the game directory.")?;
    let plan = txn::new_plan(engine, context, &stage, &["crosshairs".to_string()])?;
    let fresh = plan.items.len() == 1 && plan.items[0].key == format!("crosshairs/{file}") && plan.items[0].action == "create"
        && plan.items[0].before.is_none() && plan.items[0].after == store::hash(&png_path)?;
    if !fresh {
        return Err(EngineError::coded("PLAN_STALE", "准备新增时，目标文件的状态发生了变化，这次没有写入。请刷新后重试 (add plan did not resolve to a new file)。", "The target file changed while the add was being prepared, so nothing was written. Refresh and try again."));
    }
    Ok(plan)
}

// ---- A theme or sound added from outside ---------------------------------------------------

/// `Assert-KvkImportFileName`.
fn assert_import_name(kind: &str, file: &str) -> EngineResult<()> {
    let extensions: &[&str] = if kind == "theme" { &[".json"] } else { &[".wav", ".ogg"] };
    let ext = paths::extension(file);
    let mut invalid = file.trim().is_empty() || file.encode_utf16().count() > 128 || file.chars().any(bad_name_char)
        || file.starts_with(['.', ' ']) || file.ends_with(['.', ' ']) || file.contains("..")
        || !extensions.iter().any(|e| eq_ignore_case(&ext, e)) || reserved_stem(file);
    if !invalid {
        let stem = &file[..file.len() - ext.len()];
        invalid = stem.trim().is_empty() || stem.ends_with(['.', ' ']) || (kind == "sound" && stem.contains(';'));
    }
    if invalid {
        let (wanted, wanted_en) = if kind == "theme" { (".json", ".json") } else { (".wav 或 .ogg", ".wav or .ogg") };
        return Err(EngineError::coded("INVALID_PATH",
            format!("文件名无效：必须以 {wanted} 结尾，不能包含 \\ / : * ? \" < > | ; 或连续的点，不能以点或空格开头结尾，总长不超过 128 个字符: {file}"),
            format!("The file name is not valid: it must end with {wanted_en}, cannot contain \\ / : * ? < > | ; a double quote, or consecutive dots, cannot start or end with a dot or a space, and must be at most 128 characters: \"{file}\".")));
    }
    Ok(())
}

/// A reviewed file add: the staged copy's folder, removed once the add has run.
pub struct FileAdd { pub stage: String, pub plan: Plan }

/// `Remove-KvkImportStage`: only ever `<data root>/import-previews/<32 hex>`, best effort.
pub fn remove_import_stage(engine: &Engine, context: &Context, stage: &str) {
    let Ok(base) = engine.data_root(&context.local_data_root).map(|d| join(&d, "import-previews")) else { return };
    let (Ok(base), Ok(full)) = (paths::full_path(&base), paths::full_path(stage)) else { return };
    if paths::directory_name(&full).is_some_and(|p| eq_ignore_case(&p, &base)) && paths::is_lower_hex(&paths::file_name(&full), 32) {
        let _ = std::fs::remove_dir_all(&full);
    }
}

/// `New-KvkFileAddPlan`: one theme or sound, byte for byte, as the player previewed it. It never
/// overwrites, never adds a second sound with the same name, never a second theme with the same
/// internal name.
pub fn file_add_plan(engine: &Engine, context: &Context, kind: &str, source_path: &str, source_sha: &str, file: &str) -> EngineResult<FileAdd> {
    engine.assert_context(context)?;
    if kind != "theme" && kind != "sound" { return Err(fail("导入类型无效：只能是主题或音效。", "The kind must be theme or sound.")); }
    assert_import_name(kind, file)?;
    if !paths::is_hash(source_sha) { return Err(fail("来源文件的校验值无效。", "The source file's checksum is not valid.")); }
    let is_theme = kind == "theme";
    let asset_kind = Json::str(if is_theme { "scheme" } else { "audio" });
    let source_full = profiles::asset_path(Some(&Json::str(source_path)))?;
    if !Path::new(&source_full).is_file() {
        return Err(EngineError::coded("INVALID_PATH", format!("找不到来源文件，它可能已被移动或删除: {source_full}"), format!("The source file was not found; it may have been moved or deleted: \"{source_full}\".")));
    }
    let (_, bytes) = profiles::asset_bytes(Some(&asset_kind), Some(&Json::str(&source_full)))?;
    let actual = paths::sha256_hex(&bytes);
    if actual != source_sha { return Err(EngineError::coded("PLAN_STALE", "来源文件在预览之后发生了变化，请重新选择这个文件。", "The source file changed after the preview. Choose the file again.")); }
    let (directory, folder) = if is_theme {
        (join(&context.game_root, "FPSAimTrainer/Saved/SaveGames/Themes"), "Themes")
    } else {
        (join(&context.game_root, "FPSAimTrainer/sounds"), "sounds")
    };
    engine.assert_context(context)?;
    if Path::new(&directory).is_dir() {
        if let Some(taken) = store::enumerate_files(&directory, "")?.iter().map(|p| paths::file_name(p)).find(|n| eq_ignore_case(n, file)) {
            return Err(fail(format!("{folder} 文件夹里已经有「{taken}」，添加不会覆盖它；请换一个文件名。"), format!("The {folder} folder already has \"{taken}\", and adding never overwrites it. Choose another file name.")));
        }
    }
    if !is_theme {
        let stem = &file[..file.len() - paths::extension(file).len()];
        let (_, sounds) = lists::installed_sounds(engine, context)?;
        if let Some(same) = sounds.iter().find(|s| eq_ignore_case(&s.name, stem)) {
            let existing = &same.file;
            return Err(fail(
                format!("sounds 文件夹里已经有同名音效「{existing}」。游戏按不含扩展名的名字绑定音效，再添加一个会让两者都无法绑定；请换一个文件名。"),
                format!("The sounds folder already has a sound named \"{existing}\". The game binds sounds by the name without its extension, so adding another would leave neither one bindable. Choose another file name.")));
        }
    }
    let stage = join(&join(&engine.data_root(&context.local_data_root)?, "import-previews"), &store::new_guid());
    let prefix = format!("{}{}", context.game_root, paths::SEP);
    if stage.to_lowercase().starts_with(&prefix.to_lowercase()) { return Err(fail("导入的暂存位置不能在游戏目录里。", "The import staging folder must be outside the game directory.")); }
    let result = (|| -> EngineResult<Plan> {
        store::new_directory(&join(&stage, folder))?;
        let staged = join(&join(&stage, folder), file);
        store::write_durable(&staged, &bytes)?;
        if is_theme {
            let theme_name = lists::read_theme(&staged)?.get("themeName").and_then(Json::as_str).unwrap_or_default().to_string();
            let installed = lists::installed_themes(engine, context)?;
            if let Some(clash) = installed.themes.iter().find(|t| t.readable && t.name.as_deref().is_some_and(|n| eq_ignore_case(n, &theme_name))) {
                let existing = &clash.file;
                return Err(fail(
                    format!("这个主题的内部名称是「{theme_name}」，而游戏里的「{existing}」已经叫这个名字。游戏按内部名称识别主题，再添加一个会让两者都无法应用；没有添加。"),
                    format!("This theme's internal name is \"{theme_name}\", and \"{existing}\" in the game already uses that name. The game identifies themes by their internal name, so adding another would leave neither one applicable. Nothing was added.")));
            }
        }
        let category = folder.to_ascii_lowercase();
        let plan = txn::new_plan(engine, context, &stage, std::slice::from_ref(&category))?;
        let fresh = plan.items.len() == 1 && plan.items[0].key == format!("{category}/{file}") && plan.items[0].action == "create"
            && plan.items[0].before.is_none() && plan.items[0].after.as_deref() == Some(actual.as_str());
        if !fresh {
            return Err(EngineError::coded("PLAN_STALE", "准备添加时，目标文件的状态发生了变化，这次没有写入。请刷新后重试。", "The target file changed while the add was being prepared, so nothing was written. Refresh and try again."));
        }
        Ok(plan)
    })();
    match result {
        Ok(plan) => Ok(FileAdd { stage, plan }),
        Err(error) => { remove_import_stage(engine, context, &stage); Err(error) }
    }
}

/// `Invoke-KvkFileAdd`: the batch keeps its own copy of the source, so the staging folder goes
/// either way.
pub fn file_add_execute(engine: &Engine, context: &Context, add: &FileAdd, observer: txn::Observer) -> EngineResult<txn::Report> {
    let result = txn::install(engine, context, &add.plan, true, observer);
    remove_import_stage(engine, context, &add.stage);
    result
}

// ---- A saved copy --------------------------------------------------------------------------

/// `Export-KvkFile`: the one write outside a plan. A new file only (never an overwrite), never
/// inside the game folder, a safe name, 1 byte to 2 MiB, verified on read-back.
pub fn export(directory: &str, file: &str, bytes: &[u8], game_root: &str) -> EngineResult<Json> {
    let unsafe_name = file.trim().is_empty() || file.encode_utf16().count() > 200 || file.chars().any(bad_name_char)
        || file.starts_with(['.', ' ']) || file.ends_with(['.', ' ']) || file.contains("..") || reserved_stem(file);
    if unsafe_name { return Err(fail(format!("另存的文件名无效 (unsafe file name): {file}"), format!("The file name for saving a copy is not safe: \"{file}\"."))); }
    let qualified = {
        #[cfg(windows)]
        { let b = directory.as_bytes(); (b.len() >= 2 && matches!(b[0], b'\\' | b'/') && matches!(b[1], b'\\' | b'/')) || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/')) }
        #[cfg(not(windows))]
        { directory.starts_with('/') }
    };
    if directory.trim().is_empty() || !qualified { return Err(fail("另存的文件夹必须是完整路径 (absolute path required)。", "The folder for saving a copy must be a full path.")); }
    let full = paths::full_path(&join(directory, file))?;
    if !game_root.trim().is_empty() {
        let game = paths::full_path(game_root)?;
        let prefix = format!("{}{}", game.trim_end_matches(paths::SEP), paths::SEP);
        if eq_ignore_case(&full, &game) || full.to_lowercase().starts_with(&prefix.to_lowercase()) {
            return Err(fail("不能另存到游戏目录里；要放进游戏，请用「添加到游戏」 (refusing to export inside the game directory)。", "A copy cannot be saved inside the game directory. Use Add to game to put a file in the game."));
        }
    }
    if !Path::new(directory).is_dir() { return Err(fail("另存的文件夹不存在 (directory does not exist)。", "The folder for saving a copy does not exist.")); }
    if bytes.is_empty() || bytes.len() > MAX_PNG { return Err(fail("另存内容的大小必须在 1 字节到大小上限之间 (size out of range)。", "The size of the saved copy must be between 1 byte and the size limit.")); }
    assert_safe_path(&full)?;
    if Path::new(&full).is_file() {
        return Err(fail(format!("这个文件夹里已经有「{file}」，另存不会覆盖它；请换一个文件名 (already exists)。"), format!("This folder already has \"{file}\", and saving a copy never overwrites it. Choose another file name.")));
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut handle = options.open(&full).map_err(|e| EngineError::io(&e))?;
    std::io::Write::write_all(&mut handle, bytes).and_then(|_| handle.sync_all()).map_err(|e| EngineError::io(&e))?;
    drop(handle);
    let Some(sha) = store::hash(&full)? else { return Err(fail("另存后读回校验失败 (read-back failed)。", "Reading the saved copy back for verification failed.")) };
    // The wire names (contracts.ts ExportedFile), which the App decodes exactly.
    Ok(Json::object(vec![("path", Json::str(full)), ("bytes", Json::int(bytes.len() as i64)), ("sha256", Json::str(sha))]))
}
