//! The typed request boundary and the JSONL loop (ported from the PowerShell `gui/kvk-gui-service.ps1`
//! and `gui/kvk-gui-worker.ps1`). Replies keep that service's exact shape and key order, since
//! the frozen parity goldens compare them as written.

use std::io::{BufRead, Write};

use super::json::{self, Json};
use super::store::{Context, Engine, Host};
use super::txn::{Observation, Report};
use super::{enemy, english_text, manifest, paths, EngineError, EngineResult};
use crate::installer::protocol::MAX_LINE_BYTES;

/// Every operation of protocol v=1. The ones this engine does not implement yet answer
/// ENGINE_ERROR; the App never sends them here.
const OPERATIONS: [&str; 27] = [
    "discover", "locate", "backups", "gameState", "planImport", "planRestore", "themeList", "planTheme",
    "audioList", "planAudio", "crosshairList", "planCrosshair", "planCrosshairAdd", "exportFile", "enemyList", "planEnemy",
    "planProfileApply", "planFileAdd", "execute", "profileList", "profileRead", "profileSave", "profileDelete",
    "profileAssetList", "profileAssetRead", "profileFavoritesRead", "profileFavoritesSave",
];

const PROFILE_OPERATIONS: [&str; 8] = ["profileList", "profileRead", "profileSave", "profileDelete", "profileAssetList", "profileAssetRead", "profileFavoritesRead", "profileFavoritesSave"];

enum Adapter {
    Enemy(enemy::EnemyPlan),
    Theme(super::settings::ThemePlan),
    Audio(super::txn::Plan),
    Crosshair(super::files::CrosshairReplacement),
    CrosshairAdd(super::txn::Plan),
    FileAdd(super::files::FileAdd),
    Import(super::import::ImportPlan),
    ProfileApply(super::settings::ProfileApply),
    Restore(super::txn::RestorePlan),
}

struct CachedPlan { id: String, kind: &'static str, context: Context, adapter: Adapter }

/// `New-KvkGuiSession`: one engine, one data folder, at most one executable plan.
pub struct Session { engine: Engine, local_data_root: String, runtime_root: String, plan: Option<CachedPlan>, swept: bool }

fn field_error(message: String) -> EngineError { EngineError::coded("ENGINE_ERROR", message.clone(), format!("{message}.")) }

/// `Assert-KvkGuiFields`: exactly these fields, no more.
fn assert_fields(value: &Json, names: &[&str], label: &str) -> EngineResult<()> {
    let Json::Object(fields) = value else { return Err(EngineError::coded("ENGINE_ERROR", format!("{label} must be a JSON object."), format!("{label} must be a JSON object."))) };
    for name in names {
        if !fields.iter().any(|(k, _)| k == name) { return Err(field_error(format!("{label} is missing field: {name}"))); }
    }
    for (key, _) in fields {
        if !names.contains(&key.as_str()) { return Err(field_error(format!("{label} contains an unknown field: {key}"))); }
    }
    Ok(())
}

fn string_arg<'a>(args: &'a Json, name: &str) -> EngineResult<&'a str> {
    match args.get(name) {
        Some(Json::String(s)) if !s.trim().is_empty() => Ok(s),
        _ => Err(EngineError::coded("ENGINE_ERROR", format!("{name} must be a non-empty string."), format!("{name} must be a non-empty string."))),
    }
}

/// An integer literal that .NET reads as Int32 or Int64.
fn integer(value: Option<&Json>) -> Option<i64> {
    match value { Some(Json::Number(n)) if !n.contains(['.', 'e', 'E']) => n.parse::<i64>().ok(), _ => None }
}

/// `Assert-KvkGuiRevision`, then the `[int]` cast `Set-KvkGuiPlan` applies.
fn revision_arg(args: &Json) -> EngineResult<i64> {
    match integer(args.get("revision")) {
        Some(r) if r >= 0 => {
            if r > i64::from(i32::MAX) { return Err(EngineError::plain(format!("Cannot convert value \"{r}\" to type \"System.Int32\"."))); }
            Ok(r)
        }
        _ => Err(EngineError::coded("ENGINE_ERROR", "revision must be a non-negative integer.", "revision must be a non-negative integer.")),
    }
}

impl Session {
    /// `runtime_root` is the folder holding the scripts (`<install>\scripts`), beside which the
    /// sample pack is looked for.
    pub fn new(host: Box<dyn Host>, local_data_root: &str, runtime_root: &str) -> EngineResult<Self> {
        Ok(Self { engine: Engine::new(host), local_data_root: paths::get_full_path(local_data_root)?, runtime_root: paths::get_full_path(runtime_root)?, plan: None, swept: false })
    }

    pub fn engine(&self) -> &Engine { &self.engine }

    /// Drops the held plan; an Import or FileAdd plan takes its staging folder with it.
    pub fn discard_plan(&mut self) {
        let Some(cached) = self.plan.take() else { return };
        let stage = match &cached.adapter { Adapter::Import(import) => &import.stage, Adapter::FileAdd(add) => &add.stage, _ => return };
        super::files::remove_import_stage_in(&self.engine, &self.local_data_root, stage);
    }

    fn location(&self, context: &Context) -> Json {
        Json::object(vec![("gameRoot", Json::str(&context.game_root)), ("backupRoot", Json::str(&context.backup_root)), ("gameState", Json::str(self.engine.game_state()))])
    }

    /// `Invoke-KvkGuiRequest`: one request to one reply. Progress lines go to `emit` first.
    pub fn handle(&mut self, request: &Json, emit: &mut dyn FnMut(Json)) -> Json {
        // Staging folders an earlier session abandoned: swept once, on the first request, when no
        // plan is held. The data folder is resolved here, as the request itself would.
        if !self.swept {
            self.swept = true;
            if self.plan.is_none() { super::import::remove_orphan_stages_in(&self.engine, &self.local_data_root); }
        }
        let mut request_id = Json::Null;
        let mut op = String::new();
        let result = (|| -> EngineResult<Json> {
            assert_fields(request, &["v", "requestId", "op", "args"], "request")?;
            request_id = request.get("requestId").cloned().unwrap_or(Json::Null);
            op = request.get("op").and_then(Json::as_str).unwrap_or_default().to_string();
            if integer(request.get("v")) != Some(1) { return Err(EngineError::coded("ENGINE_ERROR", "Unsupported protocol version.", "Unsupported protocol version.")); }
            string_arg(request, "requestId")?;
            string_arg(request, "op")?;
            if !OPERATIONS.contains(&op.as_str()) { return Err(EngineError::coded("ENGINE_ERROR", format!("Unknown operation: {op}"), format!("Unknown operation: {op}."))); }
            let args = request.get("args").cloned().unwrap_or(Json::Null);
            let operation_id = if op == "execute" { args.get("operationId").cloned().unwrap_or(Json::Null) } else { Json::Null };
            let progress_id = request_id.clone();
            let mut observer = |event: &Observation| {
                emit(Json::object(vec![
                    ("v", Json::int(1)), ("requestId", progress_id.clone()), ("type", Json::str("progress")), ("operationId", operation_id.clone()),
                    ("data", Json::object(vec![
                        ("phase", Json::str(event.phase)),
                        ("completed", event.completed.map_or(Json::Null, |c| Json::int(c as i64))),
                        ("total", Json::int(event.total as i64)),
                        ("currentFile", Json::opt_str(event.current_file.clone())),
                        ("batchId", Json::opt_str(event.batch_id.clone())),
                    ])),
                ]));
            };
            self.operation(&op, &args, &mut observer)
        })();
        match result {
            Ok(data) => Json::object(vec![("v", Json::int(1)), ("requestId", request_id), ("type", Json::str("reply")), ("ok", Json::Bool(true)), ("data", data)]),
            Err(error) => {
                let mut code = error.code.clone();
                if code == "ENGINE_ERROR" && !error.classified {
                    code = match op.as_str() { "locate" => "INVALID_PATH", "backups" | "planRestore" => "BACKUP_INVALID", _ => "ENGINE_ERROR" }.to_string();
                }
                let mut message = error.message.clone();
                let mut english = english_text(&error.message, Some(&error.english()));
                if PROFILE_OPERATIONS.contains(&op.as_str()) && !error.classified {
                    message = "Profile 存储操作失败，请检查文件和目录权限。".to_string();
                    english = "The Profile store could not be read or written. Check the files and folder permissions.".to_string();
                }
                let issue = Json::object(vec![("code", Json::str(code)), ("message", Json::str(message)), ("messageEn", Json::str(english)), ("path", Json::opt_str(error.path.clone()))]);
                Json::object(vec![("v", Json::int(1)), ("requestId", request_id), ("type", Json::str("reply")), ("ok", Json::Bool(false)), ("error", issue)])
            }
        }
    }

    fn operation(&mut self, op: &str, args: &Json, observer: &mut dyn FnMut(&Observation)) -> EngineResult<Json> {
        match op {
            "gameState" => {
                assert_fields(args, &[], "args")?;
                Ok(Json::str(self.engine.game_state()))
            }
            "discover" => {
                assert_fields(args, &[], "args")?;
                Ok(super::discover::discovery_json(&self.engine, &self.local_data_root, &self.runtime_root))
            }
            "profileList" => { assert_fields(args, &[], "args")?; super::profiles::list(&self.engine, &self.local_data_root) }
            "profileRead" => { assert_fields(args, &["id"], "args")?; super::profiles::read(&self.engine, &self.local_data_root, args.get("id")) }
            "profileSave" => { assert_fields(args, &["profile"], "args")?; super::profiles::save(&self.engine, &self.local_data_root, args.get("profile")) }
            "profileDelete" => { assert_fields(args, &["id"], "args")?; super::profiles::delete(&self.engine, &self.local_data_root, args.get("id")) }
            "profileAssetList" => { assert_fields(args, &["kind", "directory"], "args")?; super::profiles::asset_list(args.get("kind"), args.get("directory")) }
            "profileAssetRead" => { assert_fields(args, &["kind", "path"], "args")?; super::profiles::asset_read(args.get("kind"), args.get("path")) }
            "profileFavoritesRead" => { assert_fields(args, &[], "args")?; super::favorites::read(&self.engine, &self.local_data_root) }
            "profileFavoritesSave" => { assert_fields(args, &["favorites"], "args")?; super::favorites::save(&self.engine, &self.local_data_root, args.get("favorites")) }
            "locate" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                Ok(self.location(&context))
            }
            "themeList" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                Ok(super::lists::theme_list_json(&super::lists::installed_themes(&self.engine, &context)?))
            }
            "audioList" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                super::lists::audio_list_json(&self.engine, &context)
            }
            "crosshairList" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                super::lists::crosshair_list_json(&self.engine, &context)
            }
            "planCrosshair" | "planCrosshairAdd" => {
                assert_fields(args, &["gameRoot", "file", "pngBase64", "revision"], "args")?;
                self.discard_plan();
                let (game_root, file, encoded) = (string_arg(args, "gameRoot")?, string_arg(args, "file")?, string_arg(args, "pngBase64")?);
                let revision = revision_arg(args)?;
                let png = super::files::decode_base64(encoded,
                    ("准星 PNG 编码无效或超出大小限制。", "The crosshair PNG encoding is invalid or over the size limit."),
                    ("准星 PNG 编码无效。", "The crosshair PNG encoding is invalid."),
                    ("准星 PNG 编码不是规范 base64。", "The crosshair PNG encoding is not canonical base64."))?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                let adding = op == "planCrosshairAdd";
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(if adding {
                        EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能添加准星。", "An unfinished operation must be recovered before adding a crosshair.")
                    } else {
                        EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能替换准星。", "An unfinished operation must be recovered before replacing a crosshair.")
                    });
                }
                if adding {
                    let plan = super::files::add_plan(&self.engine, &context, file, &png)?;
                    Ok(self.record_plan(context, &plan.clone(), revision, Adapter::CrosshairAdd(plan)))
                } else {
                    let replacement = super::files::image_plan(&self.engine, &context, file, &png)?;
                    Ok(self.record_plan(context, &replacement.plan.clone(), revision, Adapter::Crosshair(replacement)))
                }
            }
            "planFileAdd" => {
                assert_fields(args, &["gameRoot", "kind", "sourcePath", "sourceSha256", "file", "revision"], "args")?;
                self.discard_plan();
                let (game_root, kind, file) = (string_arg(args, "gameRoot")?, string_arg(args, "kind")?, string_arg(args, "file")?);
                let (source_path, source_sha) = (string_arg(args, "sourcePath")?, string_arg(args, "sourceSha256")?);
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "上一次操作没有完成，请先到「备份与恢复」处理，再添加文件 (an unfinished operation must be recovered first)。", "The last operation did not finish. Resolve it in Backup and restore before adding files."));
                }
                let add = super::files::file_add_plan(&self.engine, &context, kind, source_path, source_sha, file)?;
                Ok(self.record_plan(context, &add.plan.clone(), revision, Adapter::FileAdd(add)))
            }
            "planImport" => {
                assert_fields(args, &["gameRoot", "paths", "includeSettings", "revision"], "args")?;
                self.discard_plan();
                let game_root = string_arg(args, "gameRoot")?;
                let Some(Json::Array(paths)) = args.get("paths") else {
                    return Err(EngineError::coded("ENGINE_ERROR", "paths 必须是数组。", "paths must be an array."));
                };
                let paths: Vec<String> = paths.iter().map(|p| p.as_str().map(str::to_string)).collect::<Option<_>>()
                    .ok_or_else(|| EngineError::coded("ENGINE_ERROR", "paths 只能包含字符串。", "paths must contain only strings."))?;
                let Some(Json::Bool(include_settings)) = args.get("includeSettings") else {
                    return Err(EngineError::coded("ENGINE_ERROR", "includeSettings 必须是布尔值。", "includeSettings must be boolean."));
                };
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                // Quick import may replace the settings file, which the game rewrites when it exits.
                self.engine.assert_game_closed()?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "上一次操作没有完成，请先在「备份与恢复」里处理，再导入 (an unfinished operation must be recovered first)。", "The last operation did not finish. Resolve it in Backup and restore before importing."));
                }
                let import = super::import::import_plan(&self.engine, &context, &paths, *include_settings)?;
                let id = super::store::new_guid();
                let preview = self.import_preview(&context, &import, revision, &id);
                self.plan = Some(CachedPlan { id, kind: "install", context, adapter: Adapter::Import(import) });
                Ok(preview)
            }
            "exportFile" => {
                assert_fields(args, &["directory", "fileName", "base64", "gameRoot"], "args")?;
                let (directory, file) = (string_arg(args, "directory")?, string_arg(args, "fileName")?);
                let (encoded, game_root) = (string_arg(args, "base64")?, string_arg(args, "gameRoot")?);
                let bytes = super::files::decode_base64(encoded,
                    ("导出内容编码无效或超出大小限制。", "The export encoding is invalid or over the size limit."),
                    ("导出内容编码无效。", "The export encoding is invalid."),
                    ("导出内容不是规范 base64。", "The export encoding is not canonical base64."))?;
                super::files::export(directory, file, &bytes, game_root)
            }
            "planProfileApply" => {
                assert_fields(args, &["gameRoot", "id", "revision"], "args")?;
                self.discard_plan();
                let (game_root, id) = (string_arg(args, "gameRoot")?, string_arg(args, "id")?);
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                self.engine.assert_game_closed()?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能应用 Profile。", "An unfinished operation must be recovered before applying a Profile."));
                }
                let apply = super::settings::profile_apply_plan(&self.engine, &context, id)?;
                Ok(self.record_plan(context, &apply.plan.clone(), revision, Adapter::ProfileApply(apply)))
            }
            "planTheme" => {
                assert_fields(args, &["gameRoot", "file", "revision"], "args")?;
                self.discard_plan();
                let (game_root, file) = (string_arg(args, "gameRoot")?, string_arg(args, "file")?);
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                self.engine.assert_game_closed()?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能更换背景。", "An unfinished operation must be recovered before changing the theme."));
                }
                let planned = super::settings::theme_plan(&self.engine, &context, file)?;
                Ok(self.record_plan(context, &planned.plan.clone(), revision, Adapter::Theme(planned)))
            }
            "planAudio" => {
                assert_fields(args, &["gameRoot", "event", "names", "revision"], "args")?;
                self.discard_plan();
                let (game_root, event) = (string_arg(args, "gameRoot")?, string_arg(args, "event")?);
                let Some(Json::Array(names)) = args.get("names") else {
                    return Err(EngineError::coded("ENGINE_ERROR", "names must be an array.", "names must be an array."));
                };
                let names: Vec<String> = names.iter().map(powershell_string).collect();
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                self.engine.assert_game_closed()?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能更换音效。", "An unfinished operation must be recovered before changing sounds."));
                }
                let planned = super::settings::audio_plan(&self.engine, &context, event, &names)?;
                Ok(self.record_plan(context, &planned.clone(), revision, Adapter::Audio(planned)))
            }
            "planRestore" => {
                assert_fields(args, &["gameRoot", "sourceId", "revision"], "args")?;
                self.discard_plan();
                let (game_root, source_id) = (string_arg(args, "gameRoot")?, string_arg(args, "sourceId")?);
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                let pending: Vec<String> = manifest::all(&self.engine, &context)?.iter()
                    .filter(|m| m.get("Status").and_then(Json::as_str).is_some_and(|s| manifest::UNFINISHED.contains(&s)))
                    .filter_map(|m| m.get("Id").and_then(Json::as_str).map(str::to_string)).collect();
                if !pending.is_empty() && !pending.iter().any(|p| p == source_id) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "必须先处理未完成的恢复批次，才能再次恢复。", "The pending recovery batch must be handled before another restore."));
                }
                let plan = super::txn::restore_plan(&self.engine, &context, source_id)?;
                let id = super::store::new_guid();
                let preview = self.restore_preview(&context, &plan, revision, &id);
                self.plan = Some(CachedPlan { id, kind: "restore", context, adapter: Adapter::Restore(plan) });
                Ok(preview)
            }
            "enemyList" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                enemy::list(&self.engine, &context)
            }
            "planEnemy" => {
                assert_fields(args, &["gameRoot", "shape", "model", "skin", "revision"], "args")?;
                self.discard_plan();
                let (game_root, shape) = (string_arg(args, "gameRoot")?, string_arg(args, "shape")?);
                let (model, skin) = (string_arg(args, "model")?, string_arg(args, "skin")?);
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                // The game rewrites PrimaryUserSettings.json when it exits; a write made while it runs is lost.
                self.engine.assert_game_closed()?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能更换敌人皮肤。", "An unfinished operation must be recovered before changing the enemy skin."));
                }
                let planned = enemy::plan(&self.engine, &context, shape, model, skin)?;
                Ok(self.record_plan(context, &planned.plan.clone(), revision, Adapter::Enemy(planned)))
            }
            "backups" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                let all = manifest::all(&self.engine, &context)?;
                let mut records: Vec<&Json> = all.iter().filter(|m| m.get("Kind").and_then(Json::as_str) != Some("pristine")).collect();
                let unfinished = |m: &Json| m.get("Status").and_then(Json::as_str).is_some_and(|s| manifest::UNFINISHED.contains(&s));
                // Sort-Object is stable: unfinished batches first, then newest first.
                records.sort_by(|a, b| unfinished(b).cmp(&unfinished(a)).then_with(|| super::txn::created_key(b).cmp(&super::txn::created_key(a))));
                let rows = records.iter().map(|m| Json::object(vec![
                    ("id", m.get("Id").cloned().unwrap_or(Json::Null)),
                    ("createdAt", m.get("CreatedAt").cloned().unwrap_or(Json::Null)),
                    ("kind", m.get("Kind").cloned().unwrap_or(Json::Null)),
                    ("status", m.get("Status").cloned().unwrap_or(Json::Null)),
                    ("categories", m.get("Categories").cloned().unwrap_or(Json::Array(Vec::new()))),
                    ("fileCount", Json::int(m.get("Items").and_then(Json::as_array).map_or(0, Vec::len) as i64)),
                ])).collect();
                let pristine = all.iter().filter(|m| m.get("Kind").and_then(Json::as_str) == Some("pristine")).count() == 1;
                Ok(Json::object(vec![("location", self.location(&context)), ("records", Json::Array(rows)), ("hasPristine", Json::Bool(pristine))]))
            }
            "execute" => {
                assert_fields(args, &["operationId", "planId", "confirmation", "allowConflicts"], "args")?;
                string_arg(args, "operationId")?;
                let plan_id = string_arg(args, "planId")?.to_string();
                let confirmation = string_arg(args, "confirmation")?.to_string();
                let Some(Json::Bool(allow)) = args.get("allowConflicts") else {
                    return Err(EngineError::coded("ENGINE_ERROR", "allowConflicts must be boolean.", "allowConflicts must be boolean."));
                };
                let cached = match self.plan.take() {
                    Some(cached) if cached.id == plan_id => cached,
                    other => {
                        self.plan = other;
                        return Err(EngineError::coded("PLAN_MISSING", "预览已失效，请重新生成。", "The preview is no longer available. Create a new preview."));
                    }
                };
                if confirmation != cached.kind {
                    self.plan = Some(cached);
                    self.discard_plan();
                    return Err(EngineError::coded("PLAN_STALE", "确认内容与缓存的清单不一致。", "Confirmation does not match the cached plan."));
                }
                if let Adapter::Restore(plan) = &cached.adapter {
                    if plan.items.iter().any(|i| i.unowned) { return Err(EngineError::coded("UNOWNED_FILE", "无法确认文件由本工具创建，不能删除。", "Cannot delete a file without proof that this installer created it.")); }
                    if plan.items.iter().any(|i| i.conflict) && !*allow { return Err(EngineError::coded("CONFLICT", "恢复冲突需要明确确认。", "Restore conflicts require explicit confirmation.")); }
                    return Ok(execution(&super::txn::restore(&self.engine, &cached.context, plan, *allow, observer)?));
                }
                if *allow {
                    self.plan = Some(cached);
                    self.discard_plan();
                    return Err(EngineError::coded("CONFLICT", "安装清单不接受冲突覆盖许可。", "Install plans do not accept conflict permission."));
                }
                let report = match &cached.adapter {
                    Adapter::Enemy(plan) => enemy::execute(&self.engine, &cached.context, plan, observer)?,
                    Adapter::Theme(plan) => super::settings::theme_execute(&self.engine, &cached.context, plan, observer)?,
                    Adapter::Audio(plan) => super::txn::install(&self.engine, &cached.context, plan, false, observer)?,
                    Adapter::Crosshair(plan) => super::files::image_execute(&self.engine, &cached.context, plan, observer)?,
                    Adapter::CrosshairAdd(plan) => super::txn::install(&self.engine, &cached.context, plan, true, observer)?,
                    Adapter::FileAdd(add) => super::files::file_add_execute(&self.engine, &cached.context, add, observer)?,
                    Adapter::Import(import) => super::import::import_execute(&self.engine, &cached.context, import, observer)?,
                    Adapter::ProfileApply(apply) => super::settings::profile_apply_execute(&self.engine, &cached.context, apply, observer)?,
                    Adapter::Restore(_) => unreachable_restore(),
                };
                Ok(execution(&report))
            }
            other => Err(EngineError::plain(format!("The Rust engine does not implement {other} yet."))),
        }
    }

    /// `Set-KvkGuiPlan`: records the one plan this session may execute and returns its preview.
    fn record_plan(&mut self, context: Context, plan: &super::txn::Plan, revision: i64, adapter: Adapter) -> Json {
        let id = super::store::new_guid();
        let preview = self.install_preview(&context, plan, revision, &id);
        self.plan = Some(CachedPlan { id, kind: "install", context, adapter });
        preview
    }

    /// `ConvertTo-KvkGuiRestorePreview`.
    fn restore_preview(&self, context: &Context, plan: &super::txn::RestorePlan, revision: i64, id: &str) -> Json {
        let mut categories: Vec<String> = Vec::new();
        let rows = plan.items.iter().map(|i| {
            let category = i.key.split('/').next().unwrap_or_default().to_string();
            if !categories.contains(&category) { categories.push(category.clone()); }
            Json::object(vec![
                ("key", Json::str(&i.key)), ("category", Json::str(category)), ("source", Json::Null), ("target", Json::str(&i.target)),
                ("action", Json::str(&i.action)), ("conflict", Json::Bool(i.conflict)), ("unowned", Json::Bool(i.unowned)),
            ])
        }).collect();
        Json::object(vec![
            ("planId", Json::str(id)), ("revision", Json::int(revision)), ("kind", Json::str("restore")), ("location", self.location(context)),
            ("packRoot", Json::Null), ("categories", Json::Array(categories.into_iter().map(Json::str).collect())),
            ("sourceId", Json::str(&plan.id)), ("rows", Json::Array(rows)), ("skipped", Json::Array(Vec::new())),
        ])
    }

    /// A Quick import preview: an install preview whose rows also say why a file is not added.
    /// Rows the plan adds come first, in plan order, then the skipped files in the order they
    /// were found. `packRoot` is null: the staging folder is the engine's own business.
    fn import_preview(&self, context: &Context, import: &super::import::ImportPlan, revision: i64, id: &str) -> Json {
        let detail = |d: &Option<(String, String)>| d.as_ref().map_or(Json::Null, |(zh, en)| Json::object(vec![("message", Json::str(zh)), ("messageEn", Json::str(english_text(zh, Some(en))))]));
        let mut rows: Vec<Json> = import.plan.iter().flat_map(|p| p.items.iter()).map(|i| Json::object(vec![
            ("key", Json::str(&i.key)), ("category", Json::str(&i.category)), ("source", Json::str(import.original(&i.source))), ("target", Json::str(&i.target)),
            ("action", Json::str(&i.action)), ("conflict", Json::Bool(false)), ("unowned", Json::Bool(false)),
            ("reason", if i.action == "skip" { Json::str(super::import::Reason::ExistsSame.wire()) } else { Json::Null }), ("detail", Json::Null),
        ])).collect();
        rows.extend(import.skips.iter().map(|s| Json::object(vec![
            ("key", Json::str(&s.key)), ("category", Json::str(&s.category)), ("source", Json::str(&s.source)), ("target", Json::str(&s.target)),
            ("action", Json::str("skip")), ("conflict", Json::Bool(false)), ("unowned", Json::Bool(false)),
            ("reason", Json::str(s.reason.wire())), ("detail", detail(&s.detail)),
        ])));
        let categories = import.plan.as_ref().map_or_else(Vec::new, |p| p.categories.iter().map(Json::str).collect());
        Json::object(vec![
            ("planId", Json::str(id)), ("revision", Json::int(revision)), ("kind", Json::str("install")), ("location", self.location(context)),
            ("packRoot", Json::Null), ("categories", Json::Array(categories)),
            ("sourceId", Json::Null), ("rows", Json::Array(rows)), ("skipped", Json::Array(import.unrecognized.iter().map(Json::str).collect())),
        ])
    }

    /// `ConvertTo-KvkGuiInstallPreview`.
    fn install_preview(&self, context: &Context, plan: &super::txn::Plan, revision: i64, id: &str) -> Json {
        let rows = plan.items.iter().map(|i| Json::object(vec![
            ("key", Json::str(&i.key)), ("category", Json::str(&i.category)), ("source", Json::str(&i.source)), ("target", Json::str(&i.target)),
            ("action", Json::str(&i.action)), ("conflict", Json::Bool(false)), ("unowned", Json::Bool(false)),
        ])).collect();
        Json::object(vec![
            ("planId", Json::str(id)), ("revision", Json::int(revision)), ("kind", Json::str("install")), ("location", self.location(context)),
            ("packRoot", Json::str(&plan.pack_root)), ("categories", Json::Array(plan.categories.iter().map(Json::str).collect())),
            ("sourceId", Json::Null), ("rows", Json::Array(rows)), ("skipped", Json::Array(plan.skipped.iter().map(Json::str).collect())),
        ])
    }
}

/// A request value cast with `[string]`, as `[string[]]$names` does in the service.
fn powershell_string(value: &Json) -> String {
    match value {
        Json::String(s) => s.clone(),
        Json::Null => String::new(),
        Json::Bool(b) => (if *b { "True" } else { "False" }).to_string(),
        Json::Number(_) => match value.number() {
            Some(json::Number::Int(i)) => i.to_string(),
            Some(json::Number::Double(d)) => super::text::double_r(d),
            _ => match value { Json::Number(n) => n.clone(), _ => String::new() },
        },
        Json::Array(_) => "System.Object[]".to_string(),
        Json::Object(_) => "System.Collections.Hashtable".to_string(),
    }
}

#[allow(clippy::panic)]
fn unreachable_restore() -> ! { panic!("a restore plan returns before the install dispatch") }

/// `ConvertTo-KvkGuiExecution`.
fn execution(report: &Report) -> Json {
    let items = report.items.iter().map(|item| {
        let state = item.get("State").or_else(|| item.get("Action")).and_then(Json::as_str).unwrap_or_default();
        Json::object(vec![("key", item.get("Key").cloned().unwrap_or(Json::Null)), ("target", item.get("Target").cloned().unwrap_or(Json::Null)), ("state", Json::str(state))])
    }).collect();
    let errors_en: Vec<Json> = report.errors.iter().zip(&report.errors_en).map(|(m, e)| Json::str(english_text(m, Some(e)))).collect();
    Json::object(vec![
        ("status", Json::str(&report.status)), ("batchId", Json::opt_str(report.id.clone())), ("items", Json::Array(items)),
        ("errors", Json::Array(report.errors.iter().map(Json::str).collect())), ("errorsEn", Json::Array(errors_en)),
    ])
}

/// The request parser: `ConvertFrom-Json -AsHashtable -Depth 32 -DateKind String`.
pub const REQUEST_OPTIONS: json::ReadOptions = json::ReadOptions { strings: json::Strings::Literal, keys: json::Keys::KeepCaseVariants, max_depth: 32 };

fn parse_failure(message: &str) -> Json {
    let issue = Json::object(vec![("code", Json::str("ENGINE_ERROR")), ("message", Json::str(message)), ("messageEn", Json::str(english_text(message, Some(message)))), ("path", Json::Null)]);
    Json::object(vec![("v", Json::int(1)), ("requestId", Json::Null), ("type", Json::str("reply")), ("ok", Json::Bool(false)), ("error", issue)])
}

/// The worker's parse of one request line: `ConvertFrom-Json`, and for a Profile operation a
/// second, strict parse (Profile strings are literal editor data). The error is the text after
/// "Invalid JSON request: ".
pub fn parse_request(line: &str) -> Result<Json, String> {
    let request = json::parse(line, REQUEST_OPTIONS).map_err(|e| e.0)?;
    let profile_op = request.get("op").and_then(Json::as_str).is_some_and(|op| PROFILE_OPERATIONS.contains(&op));
    if matches!(request, Json::Object(_)) && profile_op {
        return super::profiles::parse_strict(line, 32).map_err(|e| e.map_or_else(|| "The JSON value could not be read as a Profile request.".to_string(), |coded| coded.message));
    }
    Ok(request)
}

/// Runs one request. A panic (an engine bug, such as an index out of range) becomes a bilingual
/// `ENGINE_ERROR` reply to that request instead of ending the worker, as the PowerShell worker
/// caught each request's errors: a failed read then fails alone, and an execute still becomes
/// `unknown` in the App (an `ENGINE_ERROR` is not a safe refusal), which leads to reconciliation.
/// The default panic hook has already written the panic to stderr, which the App keeps in
/// `worker.log`. Returns the reply and whether it panicked.
fn guard_request(request_id: Json, handle: impl FnOnce() -> Json) -> (Json, bool) {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(handle)) {
        Ok(reply) => (reply, false),
        Err(_) => {
            let issue = Json::object(vec![
                ("code", Json::str("ENGINE_ERROR")),
                ("message", Json::str("引擎内部出错，这次操作没有完成。请在「设置」里点「发送问题报告…」并附上日志。")),
                ("messageEn", Json::str("The engine hit an internal error and this operation did not finish. Use \"Send a report…\" in Settings and attach the log.")),
                ("path", Json::Null),
            ]);
            (Json::object(vec![("v", Json::int(1)), ("requestId", request_id), ("type", Json::str("reply")), ("ok", Json::Bool(false)), ("error", issue)]), true)
        }
    }
}

#[cfg(test)]
pub(crate) fn guard_request_for_test(request_id: Json, handle: impl FnOnce() -> Json) -> (Json, bool) { guard_request(request_id, handle) }

/// `Start-KvkGuiWorker`: one JSON request per line in, progress lines then one reply out.
/// Ends at end of input.
pub fn run_jsonl(session: &mut Session, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        let request = if line.len() > MAX_LINE_BYTES { Err("Request exceeds the 16 MiB limit.".to_string()) } else {
            parse_request(&line).map_err(|error| format!("Invalid JSON request: {error}"))
        };
        let reply = match request {
            Err(message) => parse_failure(&message),
            // Progress goes out as it happens, flushed, as the PowerShell worker writes it
            // (AutoFlush): the App shows it during a long batch.
            Ok(request) => {
                let mut failed = None;
                let request_id = request.get("requestId").cloned().unwrap_or(Json::Null);
                let (reply, panicked) = guard_request(request_id, || session.handle(&request, &mut |progress| {
                    if failed.is_none() { if let Err(e) = writeln!(output, "{}", progress.to_compact()).and_then(|_| output.flush()) { failed = Some(e); } }
                }));
                // A plan made before an engine bug is not trusted afterwards.
                if panicked { session.discard_plan(); }
                if let Some(error) = failed { return Err(error); }
                reply
            }
        };
        writeln!(output, "{}", reply.to_compact())?;
        output.flush()?;
    }
    session.discard_plan();
    Ok(())
}
