use std::path::Path;
#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::jobs::JobManager;
use super::net::Http;
use super::protocol::{
    validate_read, BackupIndex, Catalog, Confirmation, Discovery, ErrorCode, ExecuteRequest,
    AudioList, CrosshairList, EnemyList, ExportedFile, FileAction, GameState, Issue, Job, Location, Preview, PreviewKind, Reconciliation, SchemeList,
};
use super::report::{Prepared, ReportInput};
use super::worker::{worker_log_path, WorkerClient, WorkerConfig};
use super::profiles::{validate_profile_request, validate_profile_response};

pub struct InstallerRuntime {
    jobs: Arc<Mutex<JobManager>>,
    worker: Mutex<Option<Arc<WorkerClient>>>,
    config: Result<WorkerConfig, Issue>,
    // The one payload `installer_report_preview` last built. A single slot, not a map keyed by
    // some id: the Settings popover composes one report at a time, so a later preview replacing
    // an earlier one — and so invalidating its hash for `installer_report_send` — is exactly the
    // behaviour a fresh edit-then-preview should have.
    report: Mutex<Option<Prepared>>,
}

impl Default for InstallerRuntime {
    fn default() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(JobManager::default())),
            worker: Mutex::new(None),
            config: WorkerConfig::production(),
            report: Mutex::new(None),
        }
    }
}

impl InstallerRuntime {
    #[cfg(test)]
    pub fn for_test(config: WorkerConfig) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(JobManager::default())),
            worker: Mutex::new(None),
            config: Ok(config),
            report: Mutex::new(None),
        }
    }

    fn worker(&self) -> Result<Arc<WorkerClient>, Issue> {
        let mut slot = self.worker.lock().unwrap();
        if let Some(worker) = slot.as_ref() {
            if !worker.protocol_ended() {
                return Ok(worker.clone());
            }
            if !worker.has_exited()? {
                return Err(Issue::worker("the previous worker is still exiting"));
            }
            slot.take();
        }
        let config = self.config.clone()?;
        let worker = WorkerClient::spawn(config, self.jobs.clone())?;
        *slot = Some(worker.clone());
        Ok(worker)
    }

    fn discard_worker(&self) {
        self.worker.lock().unwrap().take();
    }

    fn can_close(&self) -> bool { self.jobs.lock().unwrap().can_close() }

    fn shutdown_idle(&self) {
        if let Some(worker) = self.worker.lock().unwrap().as_ref() { worker.shutdown_idle(); }
    }

    fn read_validated(&self, op: &str, args: Value) -> Result<Value, Issue> {
        if self.jobs.lock().unwrap().has_unresolved() {
            return Err(Issue::plain(ErrorCode::Busy, "an installer operation is still unresolved"));
        }
        let args = validate_read(op, args)?;
        let value = self.worker()?.read(op, args)?;
        self.validate_read_response(op, value)
    }

    fn profile_validated(&self, op: &str, args: Value) -> Result<Value, Issue> {
        if self.jobs.lock().unwrap().has_unresolved() {
            return Err(Issue::new(ErrorCode::Busy, "安装操作尚未完成，请稍后保存配置档", "An install operation is still unfinished. Save the Profile later."));
        }
        let args=validate_profile_request(op,args)?;
        let value=self.worker()?.read(op,args.clone())?;
        validate_profile_response(op,&args,value)
    }

    fn validate_read_response(&self, op: &str, value: Value) -> Result<Value, Issue> {
        match op {
            "discover" => round_trip::<Discovery>(value),
            "locate" => round_trip::<Location>(value),
            "catalog" => round_trip::<Catalog>(value),
            "backups" => round_trip::<BackupIndex>(value),
            "gameState" => round_trip::<GameState>(value),
            "schemeList" => round_trip::<SchemeList>(value),
            "audioList" => round_trip::<AudioList>(value),
            "crosshairList" => round_trip::<CrosshairList>(value),
            "exportFile" => round_trip::<ExportedFile>(value),
            "enemyList" => round_trip::<EnemyList>(value),
            // A scheme preview is an ordinary single-file install preview of the settings
            // file, so it reuses the install plan and execute path unchanged.
            "planInstall" | "planRestore" | "planScheme" | "planAudio" | "planCrosshair" | "planCrosshairAdd" | "planEnemy" | "planFileAdd" | "planProfileApply" => {
                let preview: Preview = decode(value)?;
                let expected = if op == "planRestore" { PreviewKind::Restore } else { PreviewKind::Install };
                if preview.kind != expected {
                    return Err(Issue::worker("worker returned the wrong preview kind"));
                }
                // An import adds one new file and must never overwrite. Refuse any other shape
                // here, before the plan is recorded and so before it could be executed.
                if op == "planFileAdd" && !matches!(preview.rows.as_slice(), [row] if row.action == FileAction::Create) {
                    return Err(Issue::worker("a file import must plan exactly one new file"));
                }
                self.jobs.lock().unwrap().record_plan(
                    preview.plan_id.clone(), preview.location.game_root.clone(), preview.kind.clone(),
                );
                serde_json::to_value(preview).map_err(|e| Issue::worker(e.to_string()))
            }
            _ => Err(Issue::plain(ErrorCode::EngineError, "unsupported installer read operation")),
        }
    }
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T, Issue> {
    serde_json::from_value(value)
        .map_err(|e| Issue::worker(format!("worker returned an invalid response body: {e}")))
}

fn round_trip<T: DeserializeOwned + serde::Serialize>(value: Value) -> Result<Value, Issue> {
    serde_json::to_value(decode::<T>(value)?).map_err(|e| Issue::worker(e.to_string()))
}

#[tauri::command]
pub async fn installer_read(
    state: State<'_, Arc<InstallerRuntime>>,
    op: String,
    args: Value,
) -> Result<Value, Issue> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.read_validated(&op, args))
        .await
        .map_err(|e| Issue::worker(format!("native read task failed: {e}")))?
}

#[tauri::command]
pub async fn installer_profile(
    state: State<'_, Arc<InstallerRuntime>>,
    op: String,
    args: Value,
) -> Result<Value, Issue> {
    let runtime=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.profile_validated(&op,args))
        .await
        .map_err(|e|Issue::new(ErrorCode::WorkerUnavailable, format!("Profile 存取任务失败：{e}"), format!("The Profile storage task failed: {e}")))?
}

#[tauri::command]
pub async fn installer_execute(
    state: State<'_, Arc<InstallerRuntime>>,
    input: ExecuteRequest,
) -> Result<Job, Issue> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || installer_execute_blocking(&runtime, input))
        .await
        .map_err(|e| Issue::worker(format!("native execute task failed: {e}")))?
}

fn installer_execute_blocking(
    state: &InstallerRuntime,
    input: ExecuteRequest,
) -> Result<Job, Issue> {
    {
        let mut jobs = state.jobs.lock().unwrap();
        if jobs.is_known(&input.operation_id) {
            // Operation IDs are the idempotency boundary. Exact repeats must remain
            // queryable even after a newer preview replaces the plan or the worker exits.
            return jobs.reserve(input);
        }
    }
    let worker = state.worker()?;
    let (root, kind) = {
        let jobs = state.jobs.lock().unwrap();
        (
            jobs.game_root_for_plan(&input.plan_id)
                .ok_or_else(|| Issue::plain(ErrorCode::PlanMissing, "planId is not owned by this native session"))?,
            jobs.kind_for_plan(&input.plan_id)
                .ok_or_else(|| Issue::plain(ErrorCode::PlanMissing, "planId is not owned by this native session"))?,
        )
    };
    let confirmation_matches = matches!(
        (&kind, &input.confirmation),
        (PreviewKind::Install, Confirmation::Install) | (PreviewKind::Restore, Confirmation::Restore)
    );
    if !confirmation_matches {
        return Err(Issue::plain(ErrorCode::PlanStale, "confirmation does not match the native preview"));
    }
    if kind == PreviewKind::Install && input.allow_conflicts {
        return Err(Issue::plain(ErrorCode::Conflict, "install operations cannot allow restore conflicts"));
    }

    let (known, job) = {
        let mut jobs = state.jobs.lock().unwrap();
        let known = jobs.is_known(&input.operation_id);
        (known, jobs.reserve(input.clone())?)
    };
    if known {
        return Ok(job);
    }
    // The root is deliberately recovered from the validated preview rather than the UI request.
    debug_assert!(!root.is_empty());
    if let Err(issue) = worker.execute(&input) {
        state.jobs.lock().unwrap().mark_unknown(&input.operation_id, issue);
    }
    state.jobs.lock().unwrap().get(&input.operation_id)
}

#[tauri::command]
pub fn installer_job(state: State<'_, Arc<InstallerRuntime>>, operation_id: String) -> Result<Job, Issue> {
    state.jobs.lock().unwrap().get(&operation_id)
}

#[tauri::command]
pub async fn installer_reconcile(
    state: State<'_, Arc<InstallerRuntime>>,
    operation_id: String,
) -> Result<Reconciliation, Issue> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || installer_reconcile_blocking(&runtime, operation_id))
        .await
        .map_err(|e| Issue::worker(format!("native reconcile task failed: {e}")))?
}

fn installer_reconcile_blocking(
    state: &InstallerRuntime,
    operation_id: String,
) -> Result<Reconciliation, Issue> {
    let game_root = {
        let jobs = state.jobs.lock().unwrap();
        let job = jobs.get(&operation_id)?;
        if job.state != super::protocol::JobState::Unknown {
            return Err(Issue::plain(ErrorCode::Busy, "only an unknown operation can be reconciled"));
        }
        jobs.game_root_for_operation(&operation_id)
            .ok_or_else(|| Issue::plain(ErrorCode::PlanMissing, "the operation has no native game root"))?
    };

    if let Some(worker) = state.worker.lock().unwrap().as_ref() {
        if !worker.has_exited()? {
            return Err(Issue::plain(ErrorCode::Busy, "the previous worker may still be writing"));
        }
    }
    state.discard_worker();
    let scan = (|| {
        let args = validate_read("backups", json!({ "gameRoot": game_root }))?;
        let value = state.worker()?.read("backups", args)?;
        state.validate_read_response("backups", value)
    })();
    let (backups, issue) = match scan {
        Ok(value) => (Some(decode::<BackupIndex>(value)?), None),
        Err(issue) => (None, Some(issue)),
    };
    let job = state.jobs.lock().unwrap().mark_reconciled(&operation_id, issue)?;
    Ok(Reconciliation { job, backups })
}

/// Dialog text follows the page language: `lang` is "zh" or "en".
fn folder_title(kind: &str, lang: &str) -> Result<&'static str, Issue> {
    let (zh, en) = match kind {
        "game" => ("选择 KovaaK 游戏目录", "Choose the KovaaK game folder"),
        "pack" => ("选择配置素材包目录", "Choose the settings pack folder"),
        "profile-assets" => ("选择预览配置文件的目录", "Choose a folder of files to preview"),
        "export" => ("选择要保存到的文件夹", "Choose a folder to save to"),
        _ => return Err(Issue::plain(ErrorCode::InvalidPath, "folder kind must be game, pack, profile-assets or export")),
    };
    pick_lang(lang, zh, en)
}

fn pick_lang(lang: &str, zh: &'static str, en: &'static str) -> Result<&'static str, Issue> {
    match lang {
        "zh" => Ok(zh),
        "en" => Ok(en),
        _ => Err(Issue::plain(ErrorCode::InvalidPath, "lang must be zh or en")),
    }
}

#[tauri::command]
pub async fn installer_pick_folder(app: AppHandle, kind: String, lang: String) -> Result<Option<String>, Issue> {
    let title = folder_title(&kind, &lang)?;
    let selected = app.dialog().file().set_title(title).blocking_pick_folder();
    selected.map(|path| path.into_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| Issue::plain(ErrorCode::InvalidPath, e.to_string())))
        .transpose()
}

/// Title, filter name and extensions for the single-file picker, in the page language. The
/// filter is advisory — a player can type any name — so the worker still checks the extension
/// and the content.
fn pick_file_filter(kind: &str, lang: &str) -> Result<(&'static str, &'static str, &'static [&'static str]), Issue> {
    let (title, name, extensions): ((&str, &str), (&str, &str), &'static [&'static str]) = match kind {
        "theme" => (("选择要添加的主题文件", "Choose a theme file to add"), ("主题 JSON", "Theme JSON"), &["json"]),
        "sound" => (("选择要添加的音效文件", "Choose a sound file to add"), ("音效 WAV / OGG", "Sound WAV / OGG"), &["wav", "ogg"]),
        "crosshair" => (("选择准星图片", "Choose a crosshair image"), ("PNG 图片", "PNG image"), &["png"]),
        _ => return Err(Issue::plain(ErrorCode::InvalidPath, "file kind must be theme, sound or crosshair")),
    };
    Ok((pick_lang(lang, title.0, title.1)?, pick_lang(lang, name.0, name.1)?, extensions))
}

#[tauri::command]
pub async fn installer_pick_file(app: AppHandle, kind: String, lang: String) -> Result<Option<String>, Issue> {
    let (title, name, extensions) = pick_file_filter(&kind, &lang)?;
    let selected = app.dialog().file().set_title(title).add_filter(name, extensions).blocking_pick_file();
    selected.map(|path| path.into_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| Issue::plain(ErrorCode::InvalidPath, e.to_string())))
        .transpose()
}

#[tauri::command]
pub async fn installer_open_backup(
    state: State<'_, Arc<InstallerRuntime>>,
    game_root: String,
) -> Result<(), Issue> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || installer_open_backup_blocking(&runtime, game_root))
        .await
        .map_err(|e| Issue::worker(format!("native folder task failed: {e}")))?
}

fn installer_open_backup_blocking(
    state: &InstallerRuntime,
    game_root: String,
) -> Result<(), Issue> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, game_root);
        return Err(Issue::plain(ErrorCode::UnsupportedPlatform, "backup folders can be opened only on Windows"));
    }
    #[cfg(target_os = "windows")]
    {
        let value = state.read_validated("backups", json!({ "gameRoot": game_root }))?;
        let index: BackupIndex = decode(value)?;
        let path = Path::new(&index.location.backup_root);
        if !path.is_dir() {
            return Err(Issue::plain(ErrorCode::BackupInvalid, "the validated backup folder does not exist"));
        }
        Command::new("explorer.exe").arg(path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|e| Issue::plain(ErrorCode::BackupInvalid, format!("could not open backup folder: {e}")))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn installer_report_preview(
    state: State<'_, Arc<InstallerRuntime>>,
    input: ReportInput,
) -> Result<Prepared, Issue> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || installer_report_preview_blocking(&runtime, input))
        .await
        .map_err(|e| Issue::worker(format!("native report task failed: {e}")))?
}

fn installer_report_preview_blocking(state: &InstallerRuntime, input: ReportInput) -> Result<Prepared, Issue> {
    let facts = gather_facts(input.attach_log)?;
    let prepared = super::report::prepare(&input, &facts)?;
    *state.report.lock().unwrap() = Some(prepared.clone());
    Ok(prepared)
}

/// What `installer_report_send` answers. An object, not a bare string: the UI reads `.number`,
/// and the first report sent from a real screen showed an empty number because this used to be
/// `Result<String, _>` while every test went through a fake that returned the object.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportSent {
    pub number: String,
}

#[tauri::command]
pub async fn installer_report_send(state: State<'_, Arc<InstallerRuntime>>, sha256: String) -> Result<ReportSent, Issue> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || installer_report_send_blocking(&runtime, sha256))
        .await
        .map_err(|e| Issue::worker(format!("native report task failed: {e}")))?
}

/// The UI can only echo back a hash; it can never hand over content. A missing or mismatched
/// hash means the session is not holding what the player thinks they are about to send — most
/// often because a later preview (or none at all) has already replaced or cleared the slot.
/// Checked and *taken* under one lock acquisition, deliberately factored out of
/// `installer_report_send_blocking` so it is testable on its own, without a network call: two
/// concurrent sends racing a check against a separate take (a rapid double-invoke, e.g. a double
/// click) could otherwise both pass the check before either cleared the slot, sending the same
/// previewed bytes twice. Whichever call takes the slot here leaves every other caller — racing
/// or not — with nothing to find.
fn take_matching_report(state: &InstallerRuntime, sha256: &str) -> Result<Prepared, Issue> {
    let mut slot = state.report.lock().unwrap();
    match slot.as_ref() {
        Some(p) if p.sha256 == sha256 => Ok(slot.take().unwrap()),
        _ => Err(Issue::plain(ErrorCode::PlanStale, "the report preview no longer matches what the native session holds")),
    }
}

fn installer_report_send_blocking(state: &InstallerRuntime, sha256: String) -> Result<ReportSent, Issue> {
    let prepared = take_matching_report(state, &sha256)?;
    // Consumed either way by the take above: a successful send must not be repeatable from a
    // stale hash, and a failed one requires a fresh preview rather than blindly retrying forever.
    super::report::send(&Http::new(), &prepared).map(|number| ReportSent { number })
}

/// What `installer_account_resolve` answers on success — the Steam account the backend resolved
/// from the pasted profile link. Wire shape is camelCase.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountResolveOut {
    pub steam_id: String,
    pub name: String,
}

/// Maps `/api/steam/resolve`'s `{"code": "..."}` answer to a bilingual `Issue`, mirroring
/// `report.rs`'s `map_backend_issue`: one HTTP call, one status-and-body match, no second style
/// of error handling for a non-2xx backend response.
fn map_steam_issue(status: u16, body: &str) -> Issue {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let code = parsed.as_ref().and_then(|v| v.get("code")).and_then(|c| c.as_str()).unwrap_or("");
    match code {
        "INVALID_STEAM_URL" => Issue::new(
            ErrorCode::InvalidPath,
            "这不是有效的 Steam 个人资料链接，请重新粘贴。",
            "That is not a valid Steam profile link. Please paste it again.",
        ),
        "STEAM_NOT_FOUND" => Issue::new(
            ErrorCode::InvalidPath,
            "没有找到这个 Steam 账号，请检查链接是否正确。",
            "That Steam account could not be found. Check the link and try again.",
        ),
        "STEAM_UNREACHABLE" => Issue::new(
            ErrorCode::WorkerUnavailable,
            "暂时无法访问 Steam，请稍后重试。",
            "Could not reach Steam right now. Please try again later.",
        ),
        "RATE_LIMITED" => Issue::new(
            ErrorCode::WorkerUnavailable,
            "请求过于频繁，请稍后再试。",
            "Too many requests just now. Try again shortly.",
        ),
        "UNKNOWN_CLIENT" => Issue::new(
            ErrorCode::EngineError,
            "客户端未被识别，请更新到最新版本后重试。",
            "The client wasn't recognized. Update to the latest version and try again.",
        ),
        _ => Issue::new(
            ErrorCode::WorkerUnavailable,
            format!("解析 Steam 账号失败（状态码 {status}）。"),
            format!("Resolving the Steam account failed (status {status})."),
        ),
    }
}

/// Posts the pasted link to the backend's Steam resolver and answers the account it found.
/// Takes `Http` so a test can point it at a local server, the same shape `report::send` uses.
fn account_resolve_with(http: &Http, url: &str) -> Result<AccountResolveOut, Issue> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(Issue::new(
            ErrorCode::InvalidPath,
            "请先粘贴 Steam 个人资料链接。",
            "Paste your Steam profile link first.",
        ));
    }
    let body = serde_json::to_string(&json!({ "url": trimmed })).map_err(|e| Issue::worker(e.to_string()))?;
    let (status, response_body) = http.post_json(super::net::STEAM_RESOLVE_PATH, &body)?;
    if status == 200 {
        let value: Value = serde_json::from_str(&response_body)
            .map_err(|_| Issue::worker("the account service returned an invalid response body"))?;
        let steam_id = value.get("steamId").and_then(|v| v.as_str()).map(str::to_string);
        let name = value.get("name").and_then(|v| v.as_str()).map(str::to_string);
        return match (steam_id, name) {
            (Some(steam_id), Some(name)) => Ok(AccountResolveOut { steam_id, name }),
            _ => Err(Issue::worker("the account service returned an incomplete response body")),
        };
    }
    Err(map_steam_issue(status, &response_body))
}

#[tauri::command]
pub async fn installer_account_resolve(url: String) -> Result<AccountResolveOut, Issue> {
    tauri::async_runtime::spawn_blocking(move || account_resolve_with(&Http::new(), &url))
        .await
        .map_err(|e| Issue::worker(format!("native account task failed: {e}")))?
}

/// What `installer_update_check` answers — always, never an `Issue`: a network failure, a
/// non-200 or an unparsable body all collapse to "no update known", exactly like a check that
/// simply hasn't happened. The player is never shown a dismissable error for this. `channel`
/// names which line `latest` belongs to (`stable` when nothing newer was offered either).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateCheckOut {
    pub latest: Option<String>,
    pub newer: bool,
    pub channel: String,
}

/// `https://aimloom.dev/latest.json` answers `{"version":"0.1.4","beta":"0.1.5-beta.1"}`, where
/// `beta` may be absent (an older site, or today's `0.1.3`) or `null` (no beta is currently newer
/// than `version`). Takes `Http`, the current label and the player's beta switch so a test can
/// drive all three without touching the real site or the exe's own `VERSION.txt`.
///
/// Considers `version` always, and `beta` only when `beta` (the switch) is true; offers whichever
/// considered candidate is newer than `current` and, if both are, whichever of the two is itself
/// the newer semver. When nothing considered is newer, still answers the stable `version` as
/// `latest` with `newer: false` — the "you are on the newest version" line reads this.
fn update_check_with(http: &Http, current: &str, beta: bool) -> UpdateCheckOut {
    let none = UpdateCheckOut { latest: None, newer: false, channel: "stable".to_string() };
    let (status, body) = match http.get(super::net::LATEST_PATH) {
        Ok(pair) => pair,
        Err(_) => return none,
    };
    if status != 200 {
        return none;
    }
    let Ok(parsed) = serde_json::from_str::<Value>(&body) else { return none };
    let Some(stable) = parsed.get("version").and_then(Value::as_str).map(str::to_string) else { return none };

    let stable_newer = super::version::is_newer(&stable, current);
    let mut chosen = (stable.clone(), "stable".to_string(), stable_newer);

    if beta {
        let beta_label = parsed.get("beta").and_then(|v| if v.is_null() { None } else { v.as_str() }).map(str::to_string);
        if let Some(beta_label) = beta_label {
            let beta_newer = super::version::is_newer(&beta_label, current);
            if beta_newer && (!stable_newer || super::version::is_newer(&beta_label, &stable)) {
                chosen = (beta_label, "beta".to_string(), true);
            }
        }
    }

    if chosen.2 {
        UpdateCheckOut { latest: Some(chosen.0), newer: true, channel: chosen.1 }
    } else {
        UpdateCheckOut { latest: Some(stable), newer: false, channel: "stable".to_string() }
    }
}

fn current_version_label() -> String {
    super::version::resolved_version().label.clone()
}

#[tauri::command]
pub async fn installer_update_check(beta: bool) -> Result<UpdateCheckOut, Issue> {
    tauri::async_runtime::spawn_blocking(move || {
        let current = current_version_label();
        update_check_with(&Http::new(), &current, beta)
    })
    .await
    .map_err(|e| Issue::worker(format!("native update-check task failed: {e}")))
}

#[tauri::command]
pub fn installer_app_info() -> super::version::AppInfo {
    super::version::app_info()
}

/// The one folder `installer_open_logs` opens: the *parent* of `worker_log_path`. Resolving it
/// creates nothing — the data-root resolver behind `worker_log_path` is pinned never to create
/// anything on a fresh machine — so a player who has never triggered a worker log sees a bilingual
/// issue, not a folder the App just invented for them.
fn logs_dir(local_app_data: &Path) -> Result<std::path::PathBuf, Issue> {
    worker_log_path(local_app_data)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| Issue::worker("could not resolve the logs folder"))
}

/// Resolves and checks the logs folder for a given data root, without touching the environment
/// or the platform — the piece a test can drive directly, with a temp directory, instead of
/// mutating the process-wide `LOCALAPPDATA` variable (which every test in this binary shares).
fn open_logs_at(local_app_data: &Path) -> Result<(), Issue> {
    let dir = logs_dir(local_app_data)?;
    if !dir.is_dir() {
        return Err(Issue::new(
            ErrorCode::EngineError,
            "日志文件夹还不存在，请先使用本程序一次。",
            "The logs folder does not exist yet. Use the App at least once first.",
        ));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &dir;
        return Err(Issue::plain(ErrorCode::UnsupportedPlatform, "the logs folder can be opened only on Windows"));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe").arg(&dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|e| Issue::plain(ErrorCode::EngineError, format!("could not open the logs folder: {e}")))?;
        Ok(())
    }
}

fn installer_open_logs_blocking() -> Result<(), Issue> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| Issue::new(ErrorCode::EngineError, "找不到 LOCALAPPDATA 环境变量。", "The LOCALAPPDATA environment variable is not set."))?;
    open_logs_at(Path::new(&local_app_data))
}

#[tauri::command]
pub async fn installer_open_logs() -> Result<(), Issue> {
    tauri::async_runtime::spawn_blocking(installer_open_logs_blocking)
        .await
        .map_err(|e| Issue::worker(format!("native folder task failed: {e}")))?
}

/// Validates the language and channel and builds the exact download-page URL; never takes a URL
/// from the UI. A beta channel opens the page's `#beta` section; a channel outside `stable`/`beta`
/// is refused exactly like a bad `lang`.
fn download_url(lang: &str, channel: &str) -> Result<String, Issue> {
    if !matches!(lang, "zh" | "en") {
        return Err(Issue::new(ErrorCode::InvalidPath, "lang 必须是 \"zh\" 或 \"en\"。", "lang must be \"zh\" or \"en\"."));
    }
    match channel {
        "stable" => Ok(format!("https://aimloom.dev/{lang}/download/")),
        "beta" => Ok(format!("https://aimloom.dev/{lang}/download/#beta")),
        _ => Err(Issue::new(ErrorCode::InvalidPath, "channel 必须是 \"stable\" 或 \"beta\"。", "channel must be \"stable\" or \"beta\".")),
    }
}

fn installer_open_download_blocking(lang: String, channel: String) -> Result<(), Issue> {
    let url = download_url(&lang, &channel)?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        return Err(Issue::plain(ErrorCode::UnsupportedPlatform, "the download page can be opened only on Windows"));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe").arg(&url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|e| Issue::plain(ErrorCode::EngineError, format!("could not open the download page: {e}")))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn installer_open_download(lang: String, channel: String) -> Result<(), Issue> {
    tauri::async_runtime::spawn_blocking(move || installer_open_download_blocking(lang, channel))
        .await
        .map_err(|e| Issue::worker(format!("native folder task failed: {e}")))?
}

/// The explorer on aimloom.dev, opened on one kind's tab. Like `download_url`, the address is
/// built here from a fixed language and kind; the UI never sends a URL.
fn explore_url(lang: &str, kind: &str) -> Result<String, Issue> {
    if !matches!(lang, "zh" | "en") {
        return Err(Issue::new(ErrorCode::InvalidPath, "lang 必须是 \"zh\" 或 \"en\"。", "lang must be \"zh\" or \"en\"."));
    }
    if !matches!(kind, "theme" | "sound" | "crosshair") {
        return Err(Issue::new(ErrorCode::InvalidPath, "kind 必须是 \"theme\"、\"sound\" 或 \"crosshair\"。", "kind must be \"theme\", \"sound\" or \"crosshair\"."));
    }
    Ok(format!("https://aimloom.dev/{lang}/explore/?kind={kind}"))
}

fn installer_open_explore_blocking(lang: String, kind: String) -> Result<(), Issue> {
    let url = explore_url(&lang, &kind)?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        return Err(Issue::plain(ErrorCode::UnsupportedPlatform, "the explorer can be opened only on Windows"));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe").arg(&url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|e| Issue::plain(ErrorCode::EngineError, format!("could not open the explorer: {e}")))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn installer_open_explore(lang: String, kind: String) -> Result<(), Issue> {
    tauri::async_runtime::spawn_blocking(move || installer_open_explore_blocking(lang, kind))
        .await
        .map_err(|e| Issue::worker(format!("native explorer task failed: {e}")))?
}

/// The Steam run URL for KovaaK (appid 824270), built here and nowhere else -- the front end
/// sends no target at all, so there is nothing for the UI to override. Mirrors `download_url`'s
/// role for `installer_open_download`: a fixed, validated address is what ever reaches
/// `explorer.exe`, never a string carried in from a command argument.
const STEAM_LAUNCH_URL: &str = "steam://rungameid/824270";

/// Best effort, deliberately: this answers `Ok(())` once `explorer.exe` accepted the Steam URL,
/// never once KovaaK has actually started -- that is unknowable from here, and a failed launch
/// must never be read as a failed apply. The caller applies the Profile first and only calls this
/// after that apply finished successfully.
fn installer_launch_game_blocking() -> Result<(), Issue> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err(Issue::plain(ErrorCode::UnsupportedPlatform, "the game can be launched only on Windows"));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe").arg(STEAM_LAUNCH_URL).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|e| Issue::plain(ErrorCode::EngineError, format!("could not start the game: {e}")))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn installer_launch_game() -> Result<(), Issue> {
    tauri::async_runtime::spawn_blocking(installer_launch_game_blocking)
        .await
        .map_err(|e| Issue::worker(format!("native launch task failed: {e}")))?
}

/// Best-effort OS facts for the report; nothing here is exercised by this crate's test suite,
/// which runs on macOS. `attach_log` is threaded through so a report that will not carry the log
/// never pays for reading `worker.log`.
#[cfg(target_os = "windows")]
fn gather_facts(attach_log: bool) -> Result<super::report::Facts, Issue> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| Issue::new(ErrorCode::EngineError, "找不到 LOCALAPPDATA 环境变量。", "The LOCALAPPDATA environment variable is not set."))?;
    let local_app_data = Path::new(&local_app_data);
    let version = super::version::resolved_version().clone();
    let log_tail = if attach_log {
        super::report::log_tail(&super::worker::worker_log_path(local_app_data), super::report::MAX_LOG_BYTES)
    } else {
        None
    };
    Ok(super::report::Facts {
        windows: windows_version(),
        display_language: windows_display_language(),
        powershell: windows_powershell_version(),
        version,
        log_tail,
        user: std::env::var("USERNAME").unwrap_or_default(),
        machine: std::env::var("COMPUTERNAME").unwrap_or_default(),
    })
}

#[cfg(not(target_os = "windows"))]
fn gather_facts(_attach_log: bool) -> Result<super::report::Facts, Issue> {
    Err(Issue::new(ErrorCode::UnsupportedPlatform, "报告只能在 Windows 上生成。", "The report can only be prepared on Windows."))
}

/// Finds the first `[`…`]` span in `cmd /c ver`'s output and returns the last whitespace-separated
/// token inside it, provided that token looks like a dotted numeric version. `ver` localises the
/// word before the number -- `Microsoft Windows [Version 10.0.22631.3155]` in English,
/// `Microsoft Windows [版本 10.0.22631.3155]` on zh-CN Windows, the primary audience -- so this
/// reads the bracket span and the number's shape, never the English word. `None` on garbage or no
/// bracket span; pure and OS-independent so it is unit-tested on any host.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_ver_output(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let open = line.find('[')?;
        let close = line[open..].find(']')? + open;
        let inside = &line[open + 1..close];
        let token = inside.split_whitespace().last()?;
        (!token.is_empty() && token.chars().all(|c| c.is_ascii_digit() || c == '.')).then(|| token.to_string())
    })
}

/// `"unknown"` on any failure — never blocks a report on this being unreadable.
#[cfg(target_os = "windows")]
fn windows_version() -> String {
    Command::new("cmd").args(["/c", "ver"]).output().ok()
        .filter(|o| o.status.success())
        .and_then(|o| parse_ver_output(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(target_os = "windows")]
fn windows_display_language() -> String {
    Command::new("reg").args(["query", r"HKCU\Control Panel\International", "/v", "LocaleName"]).output().ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout).lines().find_map(|line| {
                let line = line.trim();
                line.strip_prefix("LocaleName").map(|rest| rest.rsplit(' ').next().unwrap_or("").trim().to_string())
            })
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(target_os = "windows")]
fn windows_powershell_version() -> Option<String> {
    Command::new("pwsh").args(["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]).output().ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn notify_close_blocked(app: &AppHandle) {
    let _ = app.emit("installer-close-blocked", json!({
        "message": "An install result is still unresolved. Keep this window open or check the execution result."
    }));
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(InstallerRuntime::default()))
        .invoke_handler(tauri::generate_handler![
            installer_read,
            installer_profile,
            installer_execute,
            installer_job,
            installer_reconcile,
            installer_pick_folder,
            installer_pick_file,
            installer_open_backup,
            installer_report_preview,
            installer_report_send,
            installer_account_resolve,
            installer_update_check,
            installer_app_info,
            installer_open_logs,
            installer_open_download,
            installer_open_explore,
            installer_launch_game,
        ])
        .setup(|app| {
            // The window is declared in tauri.installer.conf.json with the plain "Aimloom"
            // title; a beta or test build relabels it here, once, before the player sees it.
            if let Some(window) = app.get_webview_window("installer") {
                let info = super::version::app_info();
                let _ = window.set_title(super::version::window_title(&info.channel));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the isolated installer application");

    app.run(|handle, event| match event {
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. }
            if label == "installer" => {
                let runtime = handle.state::<Arc<InstallerRuntime>>();
                if runtime.can_close() { runtime.shutdown_idle(); }
                else { api.prevent_close(); notify_close_blocked(handle); }
            }
        tauri::RunEvent::ExitRequested { api, .. } => {
            let runtime = handle.state::<Arc<InstallerRuntime>>();
            if !runtime.can_close() { api.prevent_exit(); notify_close_blocked(handle); }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::protocol::{has_cjk, Execution, Outcome};

    #[test]
    fn production_runtime_rejects_worker_operations_on_non_windows() {
        #[cfg(not(target_os = "windows"))]
        match InstallerRuntime::default().worker() {
            Err(issue) => assert_eq!(issue.code, ErrorCode::UnsupportedPlatform),
            Ok(_) => panic!("macOS must not start the production game-operation worker"),
        }
    }

    fn some_prepared(sha: &str) -> Prepared {
        Prepared { text: format!(r#"{{"sha":"{sha}"}}"#), sha256: sha.to_string(), bytes: 10 }
    }

    #[test]
    fn report_send_refuses_when_nothing_is_held() {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1"));
        let issue = installer_report_send_blocking(&runtime, "any-hash".into()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::PlanStale);
    }

    #[test]
    fn report_send_refuses_when_the_ui_hash_does_not_match_what_the_session_holds() {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1"));
        *runtime.report.lock().unwrap() = Some(some_prepared("held-hash"));
        let issue = installer_report_send_blocking(&runtime, "a-different-hash".into()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::PlanStale);
    }

    #[test]
    fn a_later_preview_invalidates_the_earlier_hash() {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1"));
        *runtime.report.lock().unwrap() = Some(some_prepared("first-hash"));
        // A second preview (an edit, then "see what will be sent" again) replaces the slot.
        *runtime.report.lock().unwrap() = Some(some_prepared("second-hash"));
        let issue = installer_report_send_blocking(&runtime, "first-hash".into()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::PlanStale);
    }

    #[test]
    fn parses_ver_output_regardless_of_windows_display_language() {
        assert_eq!(
            parse_ver_output("\r\nMicrosoft Windows [Version 10.0.22631.3155]\r\n\r\n"),
            Some("10.0.22631.3155".to_string()),
        );
        // zh-CN Windows localises the word before the number, not the number itself.
        assert_eq!(
            parse_ver_output("\r\nMicrosoft Windows [版本 10.0.22631.3155]\r\n\r\n"),
            Some("10.0.22631.3155".to_string()),
        );
    }

    #[test]
    fn parses_ver_output_none_on_garbage() {
        assert_eq!(parse_ver_output(""), None);
        assert_eq!(parse_ver_output("not a ver line at all"), None);
        assert_eq!(parse_ver_output("Microsoft Windows [no digits here]"), None);
        assert_eq!(parse_ver_output("Microsoft Windows []"), None);
    }

    /// The actual race is "two `installer_report_send` invocations for the same hash, at the
    /// same instant" — not expressible end to end without a real network call (that function
    /// always ends by calling `Http::new()` against the live site, which this suite must not
    /// do). What *is* expressible without any network is the piece that used to be racy: the
    /// check-then-take on `state.report`. Two threads hammer `take_matching_report` with the
    /// same held hash; exactly one may ever get the value out, no matter how they interleave,
    /// because the check and the take now happen under one lock acquisition.
    #[test]
    fn only_one_concurrent_caller_can_take_the_same_held_report() {
        let runtime = Arc::new(InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1")));
        *runtime.report.lock().unwrap() = Some(some_prepared("shared-hash"));
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let runtime = runtime.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    take_matching_report(&runtime, "shared-hash")
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let ok_count = results.iter().filter(|r| r.is_ok()).count();
        let stale_count = results.iter().filter(|r| matches!(r, Err(i) if i.code == ErrorCode::PlanStale)).count();
        assert_eq!(ok_count, 1, "exactly one racing caller must take the report, got {ok_count}");
        assert_eq!(stale_count, 1, "the loser must see PLAN_STALE, not a second success");
        assert!(runtime.report.lock().unwrap().is_none(), "the slot must end up empty either way");
    }

    #[test]
    fn report_preview_is_unsupported_off_windows() {
        #[cfg(not(target_os = "windows"))]
        {
            let issue = installer_report_preview_blocking(
                &InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1")),
                super::super::report::ReportInput {
                    description: None, contact: None, attach_log: false, account: None,
                    lang_choice: "system".into(), lang: "en".into(), game_found: false,
                },
            ).unwrap_err();
            assert_eq!(issue.code, ErrorCode::UnsupportedPlatform);
        }
    }

    fn cached_runtime() -> (InstallerRuntime, ExecuteRequest) {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test(
            "/definitely/missing/pwsh", "/definitely/missing/worker.ps1",
        ));
        let request = ExecuteRequest {
            operation_id: "op-cached".into(),
            plan_id: "plan-old".into(),
            confirmation: Confirmation::Install,
            allow_conflicts: false,
        };
        let mut jobs = runtime.jobs.lock().unwrap();
        jobs.record_plan("plan-old".into(), "C:\\Game".into(), PreviewKind::Install);
        jobs.reserve(request.clone()).unwrap();
        jobs.mark_finished("op-cached", Execution {
            status: Outcome::Completed, batch_id: Some("batch-1".into()), items: vec![], errors: vec![], errors_en: vec![],
        });
        jobs.record_plan("plan-new".into(), "D:\\Game".into(), PreviewKind::Install);
        drop(jobs);
        (runtime, request)
    }

    #[test]
    fn exact_duplicate_returns_cached_job_before_worker_or_current_plan_lookup() {
        let (runtime, request) = cached_runtime();
        let job = installer_execute_blocking(&runtime, request).unwrap();
        assert_eq!(job.operation_id, "op-cached");
        assert_eq!(job.result.unwrap().batch_id.as_deref(), Some("batch-1"));
    }

    #[test]
    fn changed_duplicate_is_rejected_before_worker_lookup() {
        let (runtime, mut request) = cached_runtime();
        request.plan_id = "different-plan".into();
        let issue = installer_execute_blocking(&runtime, request).unwrap_err();
        assert_eq!(issue.code, ErrorCode::PlanStale);
    }

    fn add_preview(rows: serde_json::Value) -> Value {
        json!({"planId":"plan-add","revision":1,"kind":"install",
            "location":{"gameRoot":"D:\\Game","backupRoot":"C:\\Backups","gameState":"closed"},
            "packRoot":"C:\\Stage","categories":["themes"],"sourceId":null,"rows":rows,"skipped":[]})
    }
    fn row(action: &str) -> Value {
        json!({"key":"themes/Blue.json","category":"themes","source":"C:\\Stage\\Themes\\Blue.json",
            "target":"D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\Themes\\Blue.json","action":action,"conflict":false,"unowned":false})
    }

    #[test]
    fn a_file_add_preview_is_recorded_only_when_it_is_exactly_one_new_file() {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1"));
        // An import must never overwrite: a worker that answers with anything but one create
        // row is refused here, before the plan could be executed.
        for rows in [json!([row("replace")]), json!([row("create"), row("create")]), json!([])] {
            assert!(runtime.validate_read_response("planFileAdd", add_preview(rows.clone())).is_err(), "{rows}");
            assert!(runtime.jobs.lock().unwrap().game_root_for_plan("plan-add").is_none(), "a refused preview must not be executable");
        }
        runtime.validate_read_response("planFileAdd", add_preview(json!([row("create")]))).unwrap();
        assert_eq!(runtime.jobs.lock().unwrap().game_root_for_plan("plan-add").as_deref(), Some("D:\\Game"));
    }

    #[test]
    fn a_profile_apply_preview_records_which_game_it_may_write() {
        // Applying a Profile is executed like any other plan: the gameRoot comes from this
        // record, never from the UI's execute request. If planProfileApply ever drops out of the
        // plan-op arm, the preview would still render but could not be executed.
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/pwsh", "/missing/worker.ps1"));
        let mut preview = add_preview(json!([{"key":"primary/PrimaryUserSettings.json","category":"primary",
            "source":"C:\\Local\\profile-apply-previews\\x\\PrimaryUserSettings.json",
            "target":"D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\primary\\PrimaryUserSettings.json",
            "action":"replace","conflict":false,"unowned":false}]));
        preview["planId"] = json!("plan-profile");
        preview["categories"] = json!(["primary"]);
        runtime.validate_read_response("planProfileApply", preview).unwrap();
        assert_eq!(runtime.jobs.lock().unwrap().game_root_for_plan("plan-profile").as_deref(), Some("D:\\Game"));
    }

    #[test]
    fn the_file_picker_filters_by_what_is_being_added() {
        assert_eq!(pick_file_filter("theme", "zh").unwrap().2, &["json"]);
        assert_eq!(pick_file_filter("sound", "zh").unwrap().2, &["wav", "ogg"]);
        assert_eq!(pick_file_filter("crosshair", "zh").unwrap().2, &["png"]);
        assert_eq!(pick_file_filter("enemy", "zh").unwrap_err().code, ErrorCode::InvalidPath);
    }

    #[test]
    fn the_file_picker_speaks_the_page_language() {
        assert_eq!(pick_file_filter("crosshair", "zh").unwrap(), ("选择准星图片", "PNG 图片", &["png"][..]));
        assert_eq!(pick_file_filter("crosshair", "en").unwrap(), ("Choose a crosshair image", "PNG image", &["png"][..]));
        for kind in ["theme", "sound", "crosshair"] {
            let (title, name, _) = pick_file_filter(kind, "en").unwrap();
            assert!(!has_cjk(title) && !has_cjk(name), "{kind}");
        }
        assert_eq!(pick_file_filter("theme", "fr").unwrap_err().code, ErrorCode::InvalidPath);
        for kind in ["game", "pack", "profile-assets", "export"] {
            assert!(has_cjk(folder_title(kind, "zh").unwrap()), "{kind}");
            assert!(!has_cjk(folder_title(kind, "en").unwrap()), "{kind}");
        }
        assert_eq!(folder_title("game", "de").unwrap_err().code, ErrorCode::InvalidPath);
        assert_eq!(folder_title("other", "en").unwrap_err().code, ErrorCode::InvalidPath);
    }

    // ---- installer_account_resolve --------------------------------------------------------

    /// Minimal one-shot JSON test server, the same shape `report.rs`'s `serve_json` uses (that
    /// one is private to `report`'s own test module, so this is its own small copy rather than
    /// a cross-module dependency for one helper).
    fn serve_json(status: u16, body: &'static str) -> super::super::net::Http {
        use std::io::{BufRead, BufReader, Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" { break; }
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
            let mut discard = vec![0u8; content_length];
            let _ = reader.read_exact(&mut discard);
            let out = format!("HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}", body.len());
            stream.write_all(out.as_bytes()).unwrap();
        });
        super::super::net::Http::with_base(&format!("http://{addr}"))
    }

    #[test]
    fn account_resolve_refuses_an_empty_url_before_any_connection() {
        let http = super::super::net::Http::with_base("http://127.0.0.1:1");
        let issue = account_resolve_with(&http, "   ").unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
    }

    #[test]
    fn account_resolve_answers_the_account_on_success() {
        let http = serve_json(200, r#"{"steamId":"76561198000000000","name":"Player"}"#);
        let account = account_resolve_with(&http, "https://steamcommunity.com/id/player/").unwrap();
        assert_eq!(account.steam_id, "76561198000000000");
        assert_eq!(account.name, "Player");
    }

    #[test]
    fn account_resolve_maps_each_backend_code_to_a_bilingual_issue() {
        let cases: &[(&str, ErrorCode)] = &[
            (r#"{"code":"INVALID_STEAM_URL"}"#, ErrorCode::InvalidPath),
            (r#"{"code":"STEAM_NOT_FOUND"}"#, ErrorCode::InvalidPath),
            (r#"{"code":"STEAM_UNREACHABLE"}"#, ErrorCode::WorkerUnavailable),
            (r#"{"code":"RATE_LIMITED"}"#, ErrorCode::WorkerUnavailable),
            (r#"{"code":"UNKNOWN_CLIENT"}"#, ErrorCode::EngineError),
            (r#"{"code":"SOMETHING_ELSE"}"#, ErrorCode::WorkerUnavailable),
        ];
        for (body, expected) in cases {
            let http = serve_json(400, body);
            let issue = account_resolve_with(&http, "https://steamcommunity.com/id/player/").unwrap_err();
            assert_eq!(issue.code, *expected, "{body}");
            assert!(has_cjk(&issue.message), "{body}");
            assert!(!has_cjk(&issue.message_en), "{body}");
        }
    }

    #[test]
    fn account_resolve_refuses_an_incomplete_success_body() {
        let http = serve_json(200, r#"{"steamId":"76561198000000000"}"#);
        let issue = account_resolve_with(&http, "https://steamcommunity.com/id/player/").unwrap_err();
        assert_eq!(issue.code, ErrorCode::WorkerUnavailable);
    }

    // ---- installer_update_check ------------------------------------------------------------

    #[test]
    fn update_check_reports_a_newer_release() {
        let http = serve_json(200, r#"{"version":"0.1.3"}"#);
        let out = update_check_with(&http, "0.1.2", false);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert!(out.newer);
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_reports_up_to_date_with_the_stable_channel() {
        let http = serve_json(200, r#"{"version":"0.1.3"}"#);
        let out = update_check_with(&http, "0.1.3", false);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert!(!out.newer);
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_never_fails_on_a_non_200() {
        let http = serve_json(500, "oops");
        let out = update_check_with(&http, "0.1.2", false);
        assert_eq!(out.latest, None);
        assert!(!out.newer);
    }

    #[test]
    fn update_check_never_fails_on_an_unparsable_body() {
        let http = serve_json(200, "not json");
        let out = update_check_with(&http, "0.1.2", false);
        assert_eq!(out.latest, None);
        assert!(!out.newer);
    }

    #[test]
    fn update_check_never_fails_on_an_unreachable_host() {
        // Nothing is listening on this port.
        let http = super::super::net::Http::with_base("http://127.0.0.1:1");
        let out = update_check_with(&http, "0.1.2", false);
        assert_eq!(out.latest, None);
        assert!(!out.newer);
    }

    #[test]
    fn update_check_ignores_the_beta_field_when_the_switch_is_off() {
        let http = serve_json(200, r#"{"version":"0.1.3","beta":"0.1.4-beta.1"}"#);
        let out = update_check_with(&http, "0.1.3", false);
        // The stable field itself is not newer than the running 0.1.3, so with the switch off
        // nothing is offered even though a newer beta exists in the body.
        assert!(!out.newer);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_offers_the_beta_when_the_switch_is_on() {
        let http = serve_json(200, r#"{"version":"0.1.3","beta":"0.1.4-beta.1"}"#);
        let out = update_check_with(&http, "0.1.3", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.4-beta.1"));
        assert!(out.newer);
        assert_eq!(out.channel, "beta");
    }

    #[test]
    fn update_check_treats_a_missing_beta_field_as_no_beta() {
        // Today's site (0.1.3) answers only {"version": ...}.
        let http = serve_json(200, r#"{"version":"0.1.3"}"#);
        let out = update_check_with(&http, "0.1.2", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_treats_a_null_beta_field_as_no_beta() {
        let http = serve_json(200, r#"{"version":"0.1.3","beta":null}"#);
        let out = update_check_with(&http, "0.1.2", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_offers_a_stable_release_that_outranks_a_running_beta() {
        // A beta player who turns the switch off: their running 0.1.4-beta.1 keeps being offered
        // nothing until a stable 0.1.4 exists, at which point it is offered as the way back.
        let http = serve_json(200, r#"{"version":"0.1.4"}"#);
        let out = update_check_with(&http, "0.1.4-beta.1", false);
        assert_eq!(out.latest.as_deref(), Some("0.1.4"));
        assert!(out.newer);
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_prefers_whichever_candidate_is_genuinely_newer() {
        // The site is expected to null the beta field once it is not newer than the stable
        // release, but the parser stays correct even if it is not: the newer of the two wins.
        let http = serve_json(200, r#"{"version":"0.1.5","beta":"0.1.4-beta.9"}"#);
        let out = update_check_with(&http, "0.1.3", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.5"));
        assert_eq!(out.channel, "stable");
    }

    // ---- installer_open_download -----------------------------------------------------------

    #[test]
    fn download_url_accepts_only_zh_or_en_and_stable_or_beta() {
        assert_eq!(download_url("zh", "stable").unwrap(), "https://aimloom.dev/zh/download/");
        assert_eq!(download_url("en", "stable").unwrap(), "https://aimloom.dev/en/download/");
        assert_eq!(download_url("zh", "beta").unwrap(), "https://aimloom.dev/zh/download/#beta");
        assert_eq!(download_url("en", "beta").unwrap(), "https://aimloom.dev/en/download/#beta");
        let issue = download_url("fr", "stable").unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
        assert!(!has_cjk(&issue.message_en));
    }

    #[test]
    fn download_url_refuses_a_channel_outside_stable_or_beta() {
        let issue = download_url("en", "test").unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
        assert!(!has_cjk(&issue.message_en));
    }

    #[test]
    fn open_download_refuses_an_invalid_language_before_touching_the_platform_arm() {
        let issue = installer_open_download_blocking("fr".into(), "stable".into()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
    }

    #[test]
    fn open_download_refuses_an_invalid_channel_before_touching_the_platform_arm() {
        let issue = installer_open_download_blocking("en".into(), "nightly".into()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
    }

    // ---- installer_open_explore ------------------------------------------------------------

    #[test]
    fn explore_url_opens_one_kind_in_one_language_and_nothing_else() {
        assert_eq!(explore_url("zh", "theme").unwrap(), "https://aimloom.dev/zh/explore/?kind=theme");
        assert_eq!(explore_url("en", "sound").unwrap(), "https://aimloom.dev/en/explore/?kind=sound");
        assert_eq!(explore_url("en", "crosshair").unwrap(), "https://aimloom.dev/en/explore/?kind=crosshair");
        for (lang, kind) in [("fr", "theme"), ("en", "enemy"), ("en", "https://evil.example/"), ("zh", "theme&x=1")] {
            let issue = explore_url(lang, kind).unwrap_err();
            assert_eq!(issue.code, ErrorCode::InvalidPath);
            assert!(!has_cjk(&issue.message_en));
        }
    }

    #[test]
    fn open_explore_refuses_a_bad_kind_before_touching_the_platform_arm() {
        let issue = installer_open_explore_blocking("en".into(), "enemy".into()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
    }

    // ---- installer_launch_game ---------------------------------------------------------------

    #[test]
    fn steam_launch_url_is_the_kovaak_run_url_and_nothing_else() {
        assert_eq!(STEAM_LAUNCH_URL, "steam://rungameid/824270");
    }

    #[test]
    fn launch_game_is_unsupported_off_windows() {
        #[cfg(not(target_os = "windows"))]
        {
            let issue = installer_launch_game_blocking().unwrap_err();
            assert_eq!(issue.code, ErrorCode::UnsupportedPlatform);
        }
    }

    // ---- installer_open_logs -----------------------------------------------------------------

    #[test]
    fn open_logs_creates_nothing_and_reports_a_missing_folder() {
        let dir = std::env::temp_dir().join(format!("kvk-open-logs-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("LOCALAPPDATA", &dir);
        let issue = installer_open_logs_blocking().unwrap_err();
        assert!(!dir.exists(), "resolving the logs folder must create nothing on a fresh machine");
        // Not UnsupportedPlatform here: the missing-folder check must fire before the
        // platform-specific arm, on every platform this crate builds for.
        assert_ne!(issue.code, ErrorCode::UnsupportedPlatform);
        std::env::remove_var("LOCALAPPDATA");
    }

    #[test]
    fn logs_dir_is_the_parent_of_the_worker_log_path() {
        let local = Path::new("C:\\Users\\Player\\AppData\\Local");
        assert_eq!(logs_dir(local).unwrap(), worker_log_path(local).parent().unwrap());
    }
    /// The Rust half of `tests/installer/report/command-shapes.fixture.json` — see that test's
    /// comment. A command's output must serialise to exactly the fixture's keys, so neither side
    /// can change a shape alone. This is what would have caught `installer_report_send` answering
    /// a bare string while the UI read `.number`.
    #[test]
    fn every_data_command_serialises_to_the_shape_the_ui_reads() {
        let fixture: Value = serde_json::from_str(include_str!("../../../tests/installer/report/command-shapes.fixture.json")).unwrap();
        let keys = |v: &Value| { let mut k: Vec<String> = v.as_object().expect("an object, not a bare value").keys().cloned().collect(); k.sort(); k };
        let shape = |name: &str| keys(&fixture[name]);

        let preview = super::super::report::Prepared { text: "t".into(), sha256: "0".repeat(64), bytes: 1 };
        assert_eq!(keys(&serde_json::to_value(&preview).unwrap()), shape("installer_report_preview"));

        let sent = ReportSent { number: "AL-260921-TST1".into() };
        assert_eq!(keys(&serde_json::to_value(&sent).unwrap()), shape("installer_report_send"));

        let account = AccountResolveOut { steam_id: "76561198000000000".into(), name: "Player".into() };
        assert_eq!(keys(&serde_json::to_value(&account).unwrap()), shape("installer_account_resolve"));

        let update = UpdateCheckOut { latest: Some("0.1.2".into()), newer: false, channel: "stable".into() };
        assert_eq!(keys(&serde_json::to_value(&update).unwrap()), shape("installer_update_check"));

        let info = super::super::version::AppInfo { label: "0.1.3".into(), channel: "stable".into() };
        assert_eq!(keys(&serde_json::to_value(&info).unwrap()), shape("installer_app_info"));
    }

}
