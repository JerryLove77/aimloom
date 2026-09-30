//! The typed request boundary (`gui/kvk-gui-service.ps1`) and the JSONL loop
//! (`gui/kvk-gui-worker.ps1`). Replies are built in the PowerShell service's exact shape and key
//! order, since the parity goldens compare them as written.

use std::io::{BufRead, Write};

use super::json::{self, Json};
use super::store::{Context, Engine, Host};
use super::txn::{Observation, Report};
use super::{enemy, english_text, manifest, paths, EngineError, EngineResult};
use crate::installer::protocol::MAX_LINE_BYTES;

/// Every operation of protocol v=1. The ones this engine does not implement yet answer
/// ENGINE_ERROR; the App never sends them here.
const OPERATIONS: [&str; 26] = [
    "discover", "locate", "catalog", "backups", "gameState", "planInstall", "planRestore", "schemeList", "planScheme",
    "audioList", "planAudio", "crosshairList", "planCrosshair", "planCrosshairAdd", "exportFile", "enemyList", "planEnemy",
    "planProfileApply", "planFileAdd", "execute", "profileList", "profileRead", "profileSave", "profileDelete",
    "profileAssetList", "profileAssetRead",
];

enum Adapter { Enemy(enemy::EnemyPlan), Scheme(super::settings::SchemePlan), Audio(super::txn::Plan) }

struct CachedPlan { id: String, kind: &'static str, context: Context, adapter: Adapter }

/// `New-KvkGuiSession`: one engine, one data folder, at most one executable plan.
pub struct Session { engine: Engine, local_data_root: String, plan: Option<CachedPlan> }

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
    pub fn new(host: Box<dyn Host>, local_data_root: &str) -> EngineResult<Self> {
        Ok(Self { engine: Engine::new(host), local_data_root: paths::get_full_path(local_data_root)?, plan: None })
    }

    pub fn engine(&self) -> &Engine { &self.engine }

    fn location(&self, context: &Context) -> Json {
        Json::object(vec![("gameRoot", Json::str(&context.game_root)), ("backupRoot", Json::str(&context.backup_root)), ("gameState", Json::str(self.engine.game_state()))])
    }

    /// `Invoke-KvkGuiRequest`: one request to one reply. Progress lines go to `emit` first.
    pub fn handle(&mut self, request: &Json, emit: &mut dyn FnMut(Json)) -> Json {
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
                    code = match op.as_str() { "locate" => "INVALID_PATH", "catalog" => "INVALID_PACK", "backups" | "planRestore" => "BACKUP_INVALID", _ => "ENGINE_ERROR" }.to_string();
                }
                let english = english_text(&error.message, Some(&error.english()));
                let issue = Json::object(vec![("code", Json::str(code)), ("message", Json::str(&error.message)), ("messageEn", Json::str(english)), ("path", Json::opt_str(error.path.clone()))]);
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
            "locate" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                Ok(self.location(&context))
            }
            "catalog" => {
                assert_fields(args, &["packRoot"], "args")?;
                let files = super::txn::pack_files(string_arg(args, "packRoot")?)?;
                // Group-Object then Sort-Object Name: the fixed category names, alphabetically.
                let mut categories: Vec<(String, i64)> = Vec::new();
                for item in &files.items {
                    match categories.iter_mut().find(|(c, _)| *c == item.category) { Some(entry) => entry.1 += 1, None => categories.push((item.category.clone(), 1)) }
                }
                categories.sort();
                Ok(Json::object(vec![
                    ("packRoot", Json::str(&files.root)),
                    ("categories", Json::Array(categories.into_iter().map(|(c, n)| Json::object(vec![("category", Json::str(c)), ("count", Json::int(n))])).collect())),
                    ("skipped", Json::Array(files.skipped.iter().map(Json::str).collect())),
                ]))
            }
            "schemeList" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                Ok(super::lists::scheme_list_json(&super::lists::installed_themes(&self.engine, &context)?))
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
            "planScheme" => {
                assert_fields(args, &["gameRoot", "file", "revision"], "args")?;
                self.plan = None;
                let (game_root, file) = (string_arg(args, "gameRoot")?, string_arg(args, "file")?);
                let revision = revision_arg(args)?;
                let context = self.engine.context(game_root, &self.local_data_root)?;
                self.engine.assert_game_closed()?;
                if manifest::has_unfinished(&manifest::all(&self.engine, &context)?) {
                    return Err(EngineError::coded("RECOVERY_REQUIRED", "必须先恢复未完成的操作，才能更换背景。", "An unfinished operation must be recovered before changing the scheme."));
                }
                let planned = super::settings::scheme_plan(&self.engine, &context, file)?;
                Ok(self.record_plan(context, &planned.plan.clone(), revision, Adapter::Scheme(planned)))
            }
            "planAudio" => {
                assert_fields(args, &["gameRoot", "event", "names", "revision"], "args")?;
                self.plan = None;
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
            "enemyList" => {
                assert_fields(args, &["gameRoot"], "args")?;
                let context = self.engine.context(string_arg(args, "gameRoot")?, &self.local_data_root)?;
                enemy::list(&self.engine, &context)
            }
            "planEnemy" => {
                assert_fields(args, &["gameRoot", "shape", "model", "skin", "revision"], "args")?;
                self.plan = None;
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
                records.sort_by(|a, b| unfinished(b).cmp(&unfinished(a)).then_with(|| created_key(b).cmp(&created_key(a))));
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
                if confirmation != cached.kind { return Err(EngineError::coded("PLAN_STALE", "确认内容与缓存的清单不一致。", "Confirmation does not match the cached plan.")); }
                if *allow { return Err(EngineError::coded("CONFLICT", "安装清单不接受冲突覆盖许可。", "Install plans do not accept conflict permission.")); }
                let report = match &cached.adapter {
                    Adapter::Enemy(plan) => enemy::execute(&self.engine, &cached.context, plan, observer)?,
                    Adapter::Scheme(plan) => super::settings::scheme_execute(&self.engine, &cached.context, plan, observer)?,
                    Adapter::Audio(plan) => super::txn::install(&self.engine, &cached.context, plan, observer)?,
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

/// `[datetime]$_.CreatedAt` as a sortable key: the seconds part, then the fraction padded to
/// seven digits.
fn created_key(manifest: &Json) -> (String, String) {
    let text = manifest.get("CreatedAt").and_then(Json::as_str).unwrap_or_default();
    let (head, tail) = text.split_at(text.len().min(19));
    let fraction: String = tail.strip_prefix('.').unwrap_or("").chars().take_while(char::is_ascii_digit).collect();
    (head.to_string(), format!("{fraction:0<7}"))
}

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

/// `Start-KvkGuiWorker`: one JSON request per line in, progress lines then one reply out.
/// Ends at end of input.
pub fn run_jsonl(session: &mut Session, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        let mut write = |value: &Json| -> std::io::Result<()> { writeln!(output, "{}", value.to_compact())?; output.flush() };
        if line.len() > MAX_LINE_BYTES { write(&parse_failure("Request exceeds the 16 MiB limit."))?; continue; }
        let request = match json::parse(&line, REQUEST_OPTIONS) {
            Ok(request) => request,
            Err(error) => { write(&parse_failure(&format!("Invalid JSON request: {}", error.0)))?; continue; }
        };
        let mut progress = Vec::new();
        let reply = session.handle(&request, &mut |line| progress.push(line));
        for line in &progress { write(line)?; }
        write(&reply)?;
    }
    Ok(())
}
