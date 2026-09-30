//! The Rust engine as the App starts it: this crate's own binary with `--worker`, through the
//! App's `WorkerClient`, with `LOCALAPPDATA` pointed at a temporary folder. This is the path every
//! player's write takes from v0.1.6, so it is tested end to end here rather than only through the
//! engine's library API (`engine_parity.rs`) or the separate test worker (`examples/engine_worker`).
#![cfg(feature = "installer-ui")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use app_lib::installer::jobs::JobManager;
use app_lib::installer::protocol::{Confirmation, ExecuteRequest, JobState, PreviewKind};
use app_lib::installer::worker::{WorkerClient, WorkerConfig};
use serde_json::{json, Value};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

fn scratch(name: &str) -> Scratch {
    // The engine refuses paths through links, and macOS's temporary folder sits behind one (/var).
    let dir = app_lib::engine::paths::temp_dir_without_links().join(format!("kvk-rust-worker-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    Scratch(dir)
}

fn start(local: &Path) -> (Arc<WorkerClient>, Arc<Mutex<JobManager>>) {
    let jobs = Arc::new(Mutex::new(JobManager::default()));
    let config = WorkerConfig::rust_worker(PathBuf::from(env!("CARGO_BIN_EXE_app")), Some(local.to_path_buf()));
    (WorkerClient::spawn(config, jobs.clone()).expect("the worker starts"), jobs)
}

fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn the_worker_answers_reads_logs_under_its_own_data_folder_and_exits_when_asked() {
    let dir = scratch("reads");
    let local = dir.0.join("local");
    fs::create_dir_all(&local).unwrap();
    let (worker, _jobs) = start(&local);

    let state = worker.read("gameState", json!({})).expect("gameState answers");
    #[cfg(not(target_os = "windows"))]
    assert_eq!(state, json!("closed"));
    #[cfg(target_os = "windows")]
    assert!(state == json!("closed") || state == json!("running"), "{state}");

    // A development build's runtime root is `scripts/installer`, so the sample pack at the
    // repository root is found the way a release finds one beside `Aimloom.exe`.
    let discovery = worker.read("discover", json!({})).expect("discover answers");
    let pack = discovery["defaultPack"].as_str().expect("a default pack");
    assert!(pack.replace('\\', "/").ends_with("KVK Settings 2025"), "{pack}");

    // The worker was started with this LOCALAPPDATA, and its stderr log is kept under it.
    let log = fs::read_to_string(local.join("Aimloom").join("logs").join("worker.log")).expect("worker.log exists");
    assert!(log.contains("=== worker session "), "{log}");

    worker.shutdown_idle();
    wait_until("the worker to exit", || worker.has_exited().unwrap());
    assert!(worker.read("gameState", json!({})).is_err(), "a stopped worker answers nothing");
}

#[test]
fn a_write_goes_through_plan_execute_and_backup_like_the_app_does_it() {
    let dir = scratch("write");
    let local = dir.0.join("local");
    let game = dir.0.join("game");
    let saves = game.join("FPSAimTrainer").join("Saved").join("SaveGames");
    fs::create_dir_all(&local).unwrap();
    fs::create_dir_all(&saves).unwrap();
    fs::create_dir_all(game.join("FPSAimTrainer").join("sounds")).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../scripts/installer/tests/parity/fixtures/enemy-lf.json");
    let before = fs::read_to_string(&fixture).unwrap();
    let settings = saves.join("PrimaryUserSettings.json");
    fs::write(&settings, &before).unwrap();

    let (worker, jobs) = start(&local);
    let game_root = game.to_string_lossy().into_owned();
    let preview = worker.read("planEnemy", json!({"gameRoot": game_root, "shape": "cylindrical", "model": "Ghost", "skin": "Default", "revision": 1}))
        .expect("planEnemy answers");
    let plan_id = preview["planId"].as_str().expect("a plan id").to_string();

    // As `installer_execute` does: record the plan, reserve the job, send the execute.
    let request = ExecuteRequest { operation_id: "op-1".into(), plan_id: plan_id.clone(), confirmation: Confirmation::Install, allow_conflicts: false };
    {
        let mut guard = jobs.lock().unwrap();
        guard.record_plan(plan_id, game_root.clone(), PreviewKind::Install);
        guard.reserve(request.clone()).unwrap();
    }
    worker.execute(&request).expect("execute is sent");
    wait_until("the job to finish", || jobs.lock().unwrap().get("op-1").unwrap().state != JobState::Running);
    let job = jobs.lock().unwrap().get("op-1").unwrap();
    assert_eq!(job.state, JobState::Finished, "{job:?}");
    let batch = job.result.as_ref().and_then(|result| result.batch_id.clone()).expect("a batch id");

    // Only the cylindrical override changed.
    let after = fs::read_to_string(&settings).unwrap();
    assert_ne!(after, before);
    assert_eq!(after.replacen("\"characterModel\": \"Ghost\"", "\"characterModel\": \"Stylized Ecto\"", 1), before);

    // The backup and its manifest are under the worker's own data folder, and the batch is listed.
    let backups = worker.read("backups", json!({"gameRoot": game_root})).expect("backups answers");
    let record = backups["records"].as_array().unwrap().iter().find(|record| record["id"] == Value::from(batch.clone())).expect("the batch is listed");
    assert_eq!(record["status"], json!("completed"));
    let root = backups["location"]["backupRoot"].as_str().unwrap().replace('\\', "/");
    assert!(root.starts_with(&local.join("Aimloom").to_string_lossy().replace('\\', "/")), "{root}");

    worker.shutdown_idle();
    wait_until("the worker to exit", || worker.has_exited().unwrap());
}
