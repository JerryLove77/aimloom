use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use super::jobs::JobManager;
use super::protocol::{
    validate_read, BackupIndex, Confirmation, Discovery, ErrorCode, ExecuteRequest,
    AudioList, Category, CrosshairList, EnemyList, ExportedFile, FileAction, GameState, Issue, Job, Location, Preview, PreviewKind, Reconciliation, ThemeList, SkipReason, is_english,
};
use super::report::Prepared;
use super::worker::{WorkerClient, WorkerConfig};
use super::profiles::{validate_profile_request, validate_profile_response};

pub struct InstallerRuntime {
    jobs: Arc<Mutex<JobManager>>,
    worker: Mutex<Option<Arc<WorkerClient>>>,
    config: Result<WorkerConfig, Issue>,
    // The one payload `installer_report_preview` last built. A single slot, not a map keyed by
    // some id: the Settings popover composes one report at a time, so a later preview replacing
    // an earlier one — and so invalidating its hash for `installer_report_send` — is exactly the
    // behaviour a fresh edit-then-preview should have.
    pub(super) report: Mutex<Option<Prepared>>,
}

impl Default for InstallerRuntime {
    fn default() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(JobManager::default())),
            worker: Mutex::new(None),
            config: WorkerConfig::production(std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from)),
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

    pub(super) fn read_validated(&self, op: &str, args: Value) -> Result<Value, Issue> {
        if self.jobs.lock().unwrap().has_unresolved() {
            return Err(Issue::plain(ErrorCode::Busy, "an installer operation is still unresolved"));
        }
        let args = validate_read(op, args)?;
        let include_settings = args.get("includeSettings").and_then(Value::as_bool).unwrap_or(false);
        let value = self.worker()?.read(op, args)?;
        self.validate_response(op, value, include_settings)
    }

    fn profile_validated(&self, op: &str, args: Value) -> Result<Value, Issue> {
        if self.jobs.lock().unwrap().has_unresolved() {
            return Err(Issue::new(ErrorCode::Busy, "安装操作尚未完成，请稍后保存配置档", "An install operation is still unfinished. Save the Profile later."));
        }
        let args=validate_profile_request(op,args)?;
        let value=self.worker()?.read(op,args.clone())?;
        validate_profile_response(op,&args,value)
    }

    fn validate_read_response(&self, op: &str, value: Value) -> Result<Value, Issue> { self.validate_response(op, value, false) }

    /// `include_settings` is the `planImport` request's own flag: what the player asked for
    /// bounds what the preview may plan.
    fn validate_response(&self, op: &str, value: Value, include_settings: bool) -> Result<Value, Issue> {
        match op {
            "discover" => round_trip::<Discovery>(value),
            "locate" => round_trip::<Location>(value),
            "backups" => round_trip::<BackupIndex>(value),
            "gameState" => round_trip::<GameState>(value),
            "themeList" => round_trip::<ThemeList>(value),
            "audioList" => round_trip::<AudioList>(value),
            "crosshairList" => round_trip::<CrosshairList>(value),
            "exportFile" => round_trip::<ExportedFile>(value),
            "enemyList" => round_trip::<EnemyList>(value),
            // A theme preview is an ordinary single-file install preview of the settings
            // file, so it reuses the install plan and execute path unchanged.
            "planImport" | "planRestore" | "planTheme" | "planAudio" | "planCrosshair" | "planCrosshairAdd" | "planEnemy" | "planFileAdd" | "planProfileApply" => {
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
                if op == "planImport" {
                    check_import_preview(&preview, include_settings)?;
                } else if preview.rows.iter().any(|row| row.reason.is_some() || row.detail.is_some()) {
                    return Err(Issue::worker("only a Quick import preview gives skip reasons"));
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

/// Quick import adds and never overwrites: a theme, sound or crosshair row is a `create` or a
/// `skip` with its reason; only the personal settings files may be replaced, and only when the
/// player asked for them. Checked before the plan is recorded, so before it could be executed.
fn check_import_preview(preview: &Preview, include_settings: bool) -> Result<(), Issue> {
    if preview.kind != PreviewKind::Install || preview.source_id.is_some() || preview.pack_root.is_some() {
        return Err(Issue::worker("a Quick import preview must be a plain install preview"));
    }
    for row in &preview.rows {
        let settings = matches!(row.category, Category::Ui | Category::Palette | Category::Primary);
        let reason_ok = match (&row.action, row.reason) {
            (FileAction::Create, None) => !settings || include_settings,
            (FileAction::Replace, None) => settings && include_settings,
            (FileAction::Skip, Some(SkipReason::SettingsNotIncluded)) => settings && !include_settings,
            (FileAction::Skip, Some(SkipReason::ExistsSame | SkipReason::Invalid | SkipReason::DuplicateInDrop)) => !settings || include_settings,
            (FileAction::Skip, Some(SkipReason::ExistsDifferent)) => !settings,
            (FileAction::Skip, Some(SkipReason::ThemeNameTaken)) => row.category == Category::Themes,
            (FileAction::Skip, Some(SkipReason::SoundStemTaken)) => row.category == Category::Sounds,
            _ => false,
        };
        let detail_ok = match (&row.detail, row.reason) {
            (None, _) => true,
            (Some(detail), Some(SkipReason::Invalid)) => !detail.message.trim().is_empty() && is_english(&detail.message_en),
            _ => false,
        };
        if !reason_ok || !detail_ok || row.conflict || row.unowned {
            return Err(Issue::worker(format!("the Quick import preview has a row it may not have: {} {:?} {:?}", row.key, row.action, row.reason)));
        }
    }
    Ok(())
}

pub(super) fn decode<T: DeserializeOwned>(value: Value) -> Result<T, Issue> {
    serde_json::from_value(value)
        .map_err(|e| Issue::worker(format!("worker returned an invalid response body: {e}")))
}

/// Runs a blocking native step off the async runtime; a task that panicked becomes a worker issue
/// naming the step.
pub(super) async fn blocking<T: Send + 'static>(what: &str, f: impl FnOnce() -> Result<T, Issue> + Send + 'static) -> Result<T, Issue> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Issue::worker(format!("native {what} task failed: {e}")))?
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
    blocking("read", move || runtime.read_validated(&op, args)).await
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
    blocking("execute", move || installer_execute_blocking(&runtime, input)).await
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
    blocking("reconcile", move || installer_reconcile_blocking(&runtime, operation_id)).await
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
            super::dialogs::installer_pick_folder,
            super::dialogs::installer_pick_file,
            super::dialogs::installer_pick_files,
            super::shell::installer_open_backup,
            super::reporting::installer_report_preview,
            super::reporting::installer_report_send,
            super::account::installer_account_resolve,
            super::update::installer_update_check,
            super::version::installer_app_info,
            super::shell::installer_open_logs,
            super::shell::installer_open_download,
            super::shell::installer_open_explore,
            super::shell::installer_launch_game,
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
    use super::super::protocol::{Execution, Outcome};

    #[test]
    fn production_runtime_rejects_worker_operations_on_non_windows() {
        #[cfg(not(target_os = "windows"))]
        match InstallerRuntime::default().worker() {
            Err(issue) => assert_eq!(issue.code, ErrorCode::UnsupportedPlatform),
            Ok(_) => panic!("macOS must not start the production game-operation worker"),
        }
    }









    fn cached_runtime() -> (InstallerRuntime, ExecuteRequest) {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/app"));
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
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/app"));
        // An import must never overwrite: a worker that answers with anything but one create
        // row is refused here, before the plan could be executed.
        for rows in [json!([row("replace")]), json!([row("create"), row("create")]), json!([])] {
            assert!(runtime.validate_read_response("planFileAdd", add_preview(rows.clone())).is_err(), "{rows}");
            assert!(runtime.jobs.lock().unwrap().game_root_for_plan("plan-add").is_none(), "a refused preview must not be executable");
        }
        runtime.validate_read_response("planFileAdd", add_preview(json!([row("create")]))).unwrap();
        assert_eq!(runtime.jobs.lock().unwrap().game_root_for_plan("plan-add").as_deref(), Some("D:\\Game"));
    }

    fn import_row(category: &str, action: &str, reason: Option<&str>) -> Value {
        json!({"key":format!("{category}/x"),"category":category,"source":"C:\\Drop\\x","target":"D:\\Game\\x",
            "action":action,"conflict":false,"unowned":false,"reason":reason,"detail":null})
    }
    fn import_preview(rows: Value) -> Value {
        let mut preview = add_preview(rows);
        preview["planId"] = json!("plan-import");
        preview["packRoot"] = Value::Null;
        preview
    }

    #[test]
    fn a_quick_import_preview_adds_and_replaces_only_the_settings_the_player_asked_for() {
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/app"));
        let check = |rows: Value, include: bool| runtime.validate_response("planImport", import_preview(rows), include);
        // What the engine plans.
        let fine = json!([import_row("themes","create",None), import_row("sounds","skip",Some("exists-different")),
            import_row("sounds","skip",Some("sound-stem-taken")), import_row("themes","skip",Some("theme-name-taken")),
            import_row("crosshairs","skip",Some("duplicate-in-drop")), import_row("primary","skip",Some("settings-not-included"))]);
        check(fine, false).unwrap();
        check(json!([import_row("primary","replace",None), import_row("ui","create",None), import_row("palette","skip",Some("exists-same"))]), true).unwrap();
        // What it must never answer: an overwrite of a theme, sound or crosshair; settings the
        // player did not ask for; a skip without its reason; a reason that does not fit.
        for (rows, include) in [
            (json!([import_row("themes","replace",None)]), true),
            (json!([import_row("sounds","replace",None)]), true),
            (json!([import_row("primary","replace",None)]), false),
            (json!([import_row("ui","create",None)]), false),
            (json!([import_row("primary","skip",Some("settings-not-included"))]), true),
            (json!([import_row("themes","skip",None)]), false),
            (json!([import_row("themes","create",Some("exists-same"))]), false),
            (json!([import_row("sounds","skip",Some("theme-name-taken"))]), false),
            (json!([import_row("primary","skip",Some("exists-different"))]), true),
            (json!([import_row("themes","delete",None)]), false),
        ] {
            assert!(check(rows.clone(), include).is_err(), "{rows} include={include}");
        }
        // Words only for an invalid file, and English-safe.
        let mut invalid = import_row("themes","skip",Some("invalid"));
        invalid["detail"] = json!({"message":"主题文件不是有效的 JSON","messageEn":"The theme file is not valid JSON: \"坏.json\"."});
        check(json!([invalid.clone()]), false).unwrap();
        invalid["detail"]["messageEn"] = json!("主题文件不是有效的 JSON");
        assert!(check(json!([invalid]), false).is_err());
        let mut worded = import_row("themes","skip",Some("exists-same"));
        worded["detail"] = json!({"message":"x","messageEn":"x"});
        assert!(check(json!([worded]), false).is_err());
        // Another plan never carries a reason.
        let mut reasoned = row("create");
        reasoned["reason"] = json!("exists-same");
        assert!(runtime.validate_read_response("planFileAdd", add_preview(json!([reasoned]))).is_err());
    }

    #[test]
    fn a_profile_apply_preview_records_which_game_it_may_write() {
        // Applying a Profile is executed like any other plan: the gameRoot comes from this
        // record, never from the UI's execute request. If planProfileApply ever drops out of the
        // plan-op arm, the preview would still render but could not be executed.
        let runtime = InstallerRuntime::for_test(WorkerConfig::for_test("/missing/app"));
        let mut preview = add_preview(json!([{"key":"primary/PrimaryUserSettings.json","category":"primary",
            "source":"C:\\Local\\profile-apply-previews\\x\\PrimaryUserSettings.json",
            "target":"D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\primary\\PrimaryUserSettings.json",
            "action":"replace","conflict":false,"unowned":false}]));
        preview["planId"] = json!("plan-profile");
        preview["categories"] = json!(["primary"]);
        runtime.validate_read_response("planProfileApply", preview).unwrap();
        assert_eq!(runtime.jobs.lock().unwrap().game_root_for_plan("plan-profile").as_deref(), Some("D:\\Game"));
    }



    // ---- installer_account_resolve --------------------------------------------------------






    // ---- installer_update_check ------------------------------------------------------------












    // ---- installer_open_download -----------------------------------------------------------





    // ---- installer_open_explore ------------------------------------------------------------



    // ---- installer_launch_game ---------------------------------------------------------------



    // ---- installer_open_logs -----------------------------------------------------------------


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

        let sent = super::super::reporting::ReportSent { number: "AL-260921-TST1".into() };
        assert_eq!(keys(&serde_json::to_value(&sent).unwrap()), shape("installer_report_send"));

        let account = super::super::account::AccountResolveOut { steam_id: "76561198000000000".into(), name: "Player".into() };
        assert_eq!(keys(&serde_json::to_value(&account).unwrap()), shape("installer_account_resolve"));

        let update = super::super::update::UpdateCheckOut { latest: Some("0.1.2".into()), newer: false, channel: "stable".into() };
        assert_eq!(keys(&serde_json::to_value(&update).unwrap()), shape("installer_update_check"));

        let info = super::super::version::AppInfo { label: "0.1.3".into(), channel: "stable".into() };
        assert_eq!(keys(&serde_json::to_value(&info).unwrap()), shape("installer_app_info"));
    }

}
