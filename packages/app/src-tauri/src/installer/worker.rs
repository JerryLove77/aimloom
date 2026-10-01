use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::jobs::JobManager;
use super::protocol::{
    parse_worker_line, validate_execution, ErrorCode, ExecuteRequest, Execution, Issue, WorkerMessage, WorkerRequest,
    MAX_LINE_BYTES, PROTOCOL_VERSION,
};

#[derive(Clone, Debug)]
pub struct WorkerConfig {
    /// What is started: `Aimloom.exe --worker`, the Rust engine (the only engine the App runs
    /// from v0.1.6).
    program: PathBuf,
    args: Vec<std::ffi::OsString>,
    /// `%LOCALAPPDATA%`, under which the worker's stderr log is kept. `None` discards the log
    /// (tests, and any machine without the variable). The log's folder is resolved at each
    /// spawn, not here, so it always matches the folder the worker is about to use.
    log_root: Option<PathBuf>,
}

impl WorkerConfig {
    /// The Rust engine's worker: `program` started with `--worker`. The App passes its own
    /// executable; integration tests pass the test build of it (`CARGO_BIN_EXE_app`). `log_root` is
    /// the `%LOCALAPPDATA%` the worker is started with and logs under.
    pub fn rust_worker(program: PathBuf, log_root: Option<PathBuf>) -> Self {
        Self { program, args: vec![RUST_WORKER_FLAG.into()], log_root }
    }

    /// `local_app_data` is the runtime's own `%LOCALAPPDATA%`: the worker log goes under it and the
    /// worker is started with it, so a runtime pointed at a test folder never reaches the real one.
    pub fn production(local_app_data: Option<PathBuf>) -> Result<Self, Issue> {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = local_app_data;
            Err(Issue::plain(ErrorCode::UnsupportedPlatform, "The installer engine is available only on Windows."))
        }
        #[cfg(target_os = "windows")]
        {
            // The engine is this executable, started again as a JSONL worker.
            let program = std::env::current_exe().map_err(|e| Issue::worker(format!("could not locate Aimloom.exe: {e}")))?;
            Ok(Self::rust_worker(program, local_app_data))
        }
    }

    /// A configuration that is never started, for tests of the native session around it.
    #[cfg(test)]
    pub fn for_test(program: impl Into<PathBuf>) -> Self {
        Self::rust_worker(program.into(), None)
    }
}

/// Shown when the worker stops before answering: every pending request gets this. The most
/// likely causes are outside the app (antivirus stopping `Aimloom.exe`, a damaged install, or an
/// engine bug), and the log is what shows which one.
const WORKER_EXITED: &str = "后台组件意外退出，这次操作没有完成。请关闭并重新打开 Aimloom；如果仍然出现，请在「设置」里点「发送问题报告…」，或把 %LOCALAPPDATA%\\Aimloom\\logs\\worker.log 发到 feedback@aimloom.dev。";
const WORKER_EXITED_EN: &str = "The background worker stopped unexpectedly and this operation did not finish. Close and reopen Aimloom; if it happens again, use \"Send a report…\" in Settings, or email %LOCALAPPDATA%\\Aimloom\\logs\\worker.log to feedback@aimloom.dev.";

/// Rotate the worker log once it passes this size, so it cannot grow without bound.
const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// The argument that makes `Aimloom.exe` the Rust engine's worker instead of the App.
pub const RUST_WORKER_FLAG: &str = "--worker";

const DATA_FOLDER: &str = "Aimloom";
const LEGACY_DATA_FOLDER: &str = "KovaaKConfigInstaller";

/// The data folder under `%LOCALAPPDATA%`: backups, first-protection records, Profiles, locks
/// and this log. It was `KovaaKConfigInstaller` before the product became Aimloom.
///
/// This mirrors `Engine::data_root` in `engine/store.rs`, and the two must agree, because the rule
/// exists to keep the permanent first-protection records from being split across two names:
/// `Aimloom` wins if it exists; otherwise an existing old folder is adopted by one rename (same
/// volume, so atomic); if that rename fails, the old folder is used as it is. The app opens
/// its log before the worker starts, so without this rule it would create `Aimloom` first and
/// the engine would then never adopt the old folder.
fn data_root(local_app_data: &Path) -> PathBuf {
    let current = local_app_data.join(DATA_FOLDER);
    let legacy = local_app_data.join(LEGACY_DATA_FOLDER);
    if current.is_dir() {
        return current;
    }
    // On Windows `fs::rename` replaces an existing file, where the engine's Directory.Move
    // refuses. Anything already at the new name therefore means "do not rename", as it does there.
    let in_the_way = fs::symlink_metadata(&current).is_ok();
    // `symlink_metadata` does not follow links: a linked or junctioned folder is never renamed,
    // and the engine refuses to write through one anyway.
    match fs::symlink_metadata(&legacy) {
        Ok(meta) if meta.is_dir() && !in_the_way => if fs::rename(&legacy, &current).is_ok() { current } else { legacy },
        Ok(_) => legacy,
        Err(_) => current,
    }
}

/// The worker's stderr log, beside the engine's backups in the data folder. A user who reports
/// a problem can attach it; before this, stderr was discarded and a failing worker left
/// nothing to diagnose.
pub(crate) fn worker_log_path(local_app_data: &Path) -> PathBuf {
    data_root(local_app_data).join("logs").join("worker.log")
}

/// Opens the worker log for appending and writes one header line for this session. A log
/// over [`MAX_LOG_BYTES`] is first moved to `worker.log.1`, replacing any older one.
///
/// Returns `None` on any failure: logging must never stop the worker from starting.
fn open_worker_log(path: &Path, now: SystemTime) -> Option<fs::File> {
    fs::create_dir_all(path.parent()?).ok()?;
    if fs::metadata(path).is_ok_and(|meta| meta.len() > MAX_LOG_BYTES) {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
    let mut file = fs::OpenOptions::new().create(true).append(true).open(path).ok()?;
    writeln!(file, "=== worker session {} ===", format_utc(now)).ok()?;
    Some(file)
}

/// Formats a moment as `YYYY-MM-DD HH:MM:SS UTC` without a date library. The day arithmetic
/// is Howard Hinnant's `civil_from_days`, valid across the whole proleptic Gregorian range.
fn format_utc(moment: SystemTime) -> String {
    let seconds = moment.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, time) = ((seconds / 86_400) as i64, seconds % 86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC", time / 3_600, time % 3_600 / 60, time % 60)
}

enum Pending {
    Read(mpsc::Sender<Result<Value, Issue>>),
    Execute { operation_id: String },
}

struct ProcessState {
    child: Child,
    stdin: Option<ChildStdin>,
}

pub struct WorkerClient {
    process: Arc<Mutex<ProcessState>>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    jobs: Arc<Mutex<JobManager>>,
    protocol_ended: Arc<AtomicBool>,
    next_request: AtomicU64,
}

impl WorkerClient {
    pub fn spawn(config: WorkerConfig, jobs: Arc<Mutex<JobManager>>) -> Result<Arc<Self>, Issue> {
        let mut command = Command::new(&config.program);
        command.args(&config.args);
        if let Some(root) = &config.log_root { command.env("LOCALAPPDATA", root); }
        command
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        // Resolved now, before the worker starts: this is what renames an older data folder, and
        // the open log then keeps the folder from being renamed away while this session uses it.
        let log = config.log_root.as_deref().and_then(|root| open_worker_log(&worker_log_path(root), SystemTime::now()));
        let mut child = command.spawn().map_err(|e| Issue::worker(format!("could not start worker: {e}")))?;
        let stdin = child.stdin.take().ok_or_else(|| Issue::worker("worker stdin was not available"))?;
        let stdout = child.stdout.take().ok_or_else(|| Issue::worker("worker stdout was not available"))?;
        let stderr = child.stderr.take().ok_or_else(|| Issue::worker("worker stderr was not available"))?;

        let pending = Arc::new(Mutex::new(HashMap::new()));
        let protocol_ended = Arc::new(AtomicBool::new(false));
        let client = Arc::new(Self {
            process: Arc::new(Mutex::new(ProcessState { child, stdin: Some(stdin) })),
            pending: pending.clone(),
            jobs: jobs.clone(),
            protocol_ended: protocol_ended.clone(),
            next_request: AtomicU64::new(1),
        });

        thread::spawn(move || {
            // Drain stderr either way: a full pipe would block the worker.
            let mut reader = BufReader::new(stderr);
            let _ = match log {
                Some(mut file) => std::io::copy(&mut reader, &mut file),
                None => std::io::copy(&mut reader, &mut std::io::sink()),
            };
        });
        let process = client.process.clone();
        let close_input = move || { process.lock().unwrap().stdin.take(); };
        thread::spawn(move || read_stdout(stdout, pending, jobs, protocol_ended, close_input));
        Ok(client)
    }

    fn next_request_id(&self) -> String {
        format!("native-{}", self.next_request.fetch_add(1, Ordering::Relaxed))
    }

    fn write_request(&self, request_id: &str, op: &str, args: Value) -> Result<(), Issue> {
        if self.protocol_ended.load(Ordering::Acquire) {
            return Err(Issue::worker("worker is no longer available"));
        }
        let request = WorkerRequest { v: PROTOCOL_VERSION, request_id, op, args };
        let mut bytes = serde_json::to_vec(&request).map_err(|e| Issue::worker(e.to_string()))?;
        if bytes.len() > MAX_LINE_BYTES {
            return Err(Issue::plain(ErrorCode::EngineError, "request exceeded the 16 MiB protocol limit"));
        }
        bytes.push(b'\n');
        let mut process = self.process.lock().unwrap();
        let stdin = process.stdin.as_mut().ok_or_else(|| Issue::worker("worker input is closed"))?;
        stdin.write_all(&bytes).and_then(|_| stdin.flush())
            .map_err(|e| Issue::worker(format!("could not send request to worker: {e}")))
    }

    pub fn read(&self, op: &str, args: Value) -> Result<Value, Issue> {
        let request_id = self.next_request_id();
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(request_id.clone(), Pending::Read(tx));
        if let Err(issue) = self.write_request(&request_id, op, args) {
            self.pending.lock().unwrap().remove(&request_id);
            return Err(issue);
        }
        match rx.recv_timeout(Duration::from_secs(120)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Closing stdin asks the persistent worker to exit after its current read.
                // It does not terminate the process or interrupt an engine operation.
                self.process.lock().unwrap().stdin.take();
                Err(Issue::worker("worker did not reply within 120 seconds"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(Issue::worker("worker reply channel closed"))
            }
        }
    }

    pub fn execute(&self, input: &ExecuteRequest) -> Result<(), Issue> {
        let request_id = self.next_request_id();
        self.pending.lock().unwrap().insert(
            request_id.clone(), Pending::Execute { operation_id: input.operation_id.clone() },
        );
        let args = serde_json::to_value(input).map_err(|e| Issue::worker(e.to_string()))?;
        if let Err(issue) = self.write_request(&request_id, "execute", args) {
            self.pending.lock().unwrap().remove(&request_id);
            return Err(issue);
        }
        Ok(())
    }

    pub fn has_exited(&self) -> Result<bool, Issue> {
        self.process.lock().unwrap().child.try_wait()
            .map(|status| status.is_some())
            .map_err(|e| Issue::worker(format!("could not inspect worker state: {e}")))
    }

    pub fn protocol_ended(&self) -> bool {
        self.protocol_ended.load(Ordering::Acquire)
    }

    pub fn shutdown_idle(&self) {
        if self.jobs.lock().unwrap().can_close() {
            self.process.lock().unwrap().stdin.take();
        }
    }
}

fn read_limited_line<R: BufRead>(reader: &mut R) -> Result<Option<Vec<u8>>, Issue> {
    let mut bytes = Vec::new();
    let read = reader.by_ref().take((MAX_LINE_BYTES + 2) as u64).read_until(b'\n', &mut bytes)
        .map_err(|e| Issue::worker(format!("could not read worker output: {e}")))?;
    if read == 0 { return Ok(None); }
    if bytes.last() != Some(&b'\n') || bytes.len() > MAX_LINE_BYTES + 1 {
        return Err(Issue::worker("worker response exceeded the 16 MiB line limit"));
    }
    bytes.pop();
    if bytes.last() == Some(&b'\r') { bytes.pop(); }
    Ok(Some(bytes))
}

fn read_stdout(
    stdout: impl Read,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    jobs: Arc<Mutex<JobManager>>,
    protocol_ended: Arc<AtomicBool>,
    // Closes the worker's stdin, asking it to exit after its current request. A closure so the
    // protocol handling can be tested without a process.
    close_input: impl Fn(),
) {
    let mut reader = BufReader::new(stdout);
    let result = (|| -> Result<(), Issue> {
        while let Some(line) = read_limited_line(&mut reader)? {
            match parse_worker_line(&line)? {
                WorkerMessage::Reply { request_id, result } => {
                    let request = pending.lock().unwrap().remove(&request_id)
                        .ok_or_else(|| Issue::worker("worker replied with an unknown requestId"))?;
                    match request {
                        Pending::Read(tx) => { let _ = tx.send(result); }
                        Pending::Execute { operation_id } => match result {
                            Ok(value) => match serde_json::from_value::<Execution>(value)
                                .map_err(|error| Issue::worker(format!("worker final report was invalid: {error}")))
                                .and_then(|execution| validate_execution(&execution).map(|()| execution)) {
                                Ok(execution) => jobs.lock().unwrap().mark_finished(&operation_id, execution),
                                Err(error) => {
                                    jobs.lock().unwrap().mark_unknown(&operation_id, error);
                                    // The worker completed its current request, but the final report is
                                    // unusable. Close only stdin so it exits naturally and reconciliation
                                    // can verify that exit before starting a replacement worker.
                                    close_input();
                                }
                            },
                            Err(issue) => {
                                let safely_rejected = matches!(
                                    issue.code,
                                    ErrorCode::PlanStale | ErrorCode::PlanMissing | ErrorCode::Conflict |
                                    ErrorCode::UnownedFile | ErrorCode::GameRunning | ErrorCode::GameStateUnknown |
                                    ErrorCode::RecoveryRequired | ErrorCode::Busy
                                );
                                if safely_rejected { jobs.lock().unwrap().mark_failed(&operation_id, issue); }
                                else {
                                    jobs.lock().unwrap().mark_unknown(&operation_id, issue);
                                    // Finish the current call and let the persistent worker exit on stdin EOF.
                                    // This makes later reconciliation possible without killing a process that may write.
                                    close_input();
                                }
                            }
                        },
                    }
                }
                WorkerMessage::Progress { request_id, operation_id, data } => {
                    let guard = pending.lock().unwrap();
                    match guard.get(&request_id) {
                        Some(Pending::Execute { operation_id: expected }) if expected == &operation_id => {
                            jobs.lock().unwrap().update_progress(&operation_id, data);
                        }
                        _ => return Err(Issue::worker("worker progress did not match an active execute request")),
                    }
                }
            }
        }
        Err(Issue::new(ErrorCode::WorkerUnavailable, WORKER_EXITED, WORKER_EXITED_EN))
    })();

    protocol_ended.store(true, Ordering::Release);
    close_input();
    let issue = result.err().unwrap_or_else(|| Issue::worker("worker protocol ended"));
    let remaining = std::mem::take(&mut *pending.lock().unwrap());
    for (_, request) in remaining {
        match request {
            Pending::Read(tx) => { let _ = tx.send(Err(issue.clone())); }
            Pending::Execute { operation_id } => jobs.lock().unwrap().mark_unknown(&operation_id, issue.clone()),
        }
    }
}

#[cfg(test)]
mod protocol_tests {
    //! What the App does with each kind of worker output, driven through `read_stdout` without a
    //! process. These replaced tests that needed a real PowerShell at a fixed path and so were
    //! skipped on every machine.
    use super::*;
    use crate::installer::protocol::{Confirmation, JobState};
    use std::sync::atomic::AtomicUsize;

    struct Run { jobs: Arc<Mutex<JobManager>>, closes: usize, ended: bool, read: Option<Result<Value, Issue>> }

    /// One execute (`r1`, operation `op-1`) and one read (`r2`) are pending; `lines` is everything
    /// the worker writes before it exits.
    fn run(lines: &[&str]) -> Run {
        let jobs = Arc::new(Mutex::new(JobManager::default()));
        {
            let mut guard = jobs.lock().unwrap();
            guard.record_plan("plan-1".into(), "C:\\Game".into(), crate::installer::protocol::PreviewKind::Install);
            guard.reserve(ExecuteRequest { operation_id: "op-1".into(), plan_id: "plan-1".into(), confirmation: Confirmation::Install, allow_conflicts: false }).unwrap();
        }
        let (tx, rx) = mpsc::channel();
        let pending = Arc::new(Mutex::new(HashMap::from([
            ("r1".to_string(), Pending::Execute { operation_id: "op-1".into() }),
            ("r2".to_string(), Pending::Read(tx)),
        ])));
        let ended = Arc::new(AtomicBool::new(false));
        let closes = Arc::new(AtomicUsize::new(0));
        let counter = closes.clone();
        let output = lines.iter().map(|line| format!("{line}\n")).collect::<String>();
        read_stdout(std::io::Cursor::new(output.into_bytes()), pending, jobs.clone(), ended.clone(), move || { counter.fetch_add(1, Ordering::SeqCst); });
        let read = rx.try_recv().ok();
        Run { jobs, closes: closes.load(Ordering::SeqCst), ended: ended.load(Ordering::SeqCst), read }
    }
    fn state(run: &Run) -> JobState { run.jobs.lock().unwrap().get("op-1").unwrap().state }
    const FINAL: &str = r#"{"v":1,"requestId":"r1","type":"reply","ok":true,"data":{"status":"completed","batchId":"b1","items":[],"errors":[],"errorsEn":[]}}"#;
    const READ: &str = r#"{"v":1,"requestId":"r2","type":"reply","ok":true,"data":"closed"}"#;

    #[test]
    fn a_valid_final_report_finishes_the_job_and_input_closes_only_at_exit() {
        let run = run(&[FINAL, READ]);
        assert_eq!(state(&run), JobState::Finished);
        assert_eq!(run.read.unwrap().unwrap(), Value::from("closed"));
        assert_eq!(run.closes, 1, "only the end of output closes the input");
        assert!(run.ended);
    }

    #[test]
    fn a_worker_that_exits_with_an_execute_pending_leaves_it_unknown() {
        let run = run(&[READ]);
        assert_eq!(state(&run), JobState::Unknown);
        let error = run.jobs.lock().unwrap().get("op-1").unwrap().error.unwrap();
        assert_eq!(error.code, ErrorCode::WorkerUnavailable);
        assert_eq!(error.message, WORKER_EXITED);
        assert!(run.ended);
    }

    #[test]
    fn a_pending_read_gets_the_exit_issue() {
        let run = run(&[FINAL]);
        assert_eq!(run.read.unwrap().unwrap_err().code, ErrorCode::WorkerUnavailable);
    }

    #[test]
    fn a_malformed_final_report_is_unknown_and_closes_the_input_at_once() {
        let run = run(&[r#"{"v":1,"requestId":"r1","type":"reply","ok":true,"data":{"status":"invalid"}}"#, READ]);
        assert_eq!(state(&run), JobState::Unknown);
        assert_eq!(run.closes, 2, "closed after the bad report, and again at exit");
    }

    #[test]
    fn a_safely_rejected_execute_fails_without_closing_the_input() {
        let run = run(&[r#"{"v":1,"requestId":"r1","type":"reply","ok":false,"error":{"code":"GAME_RUNNING","message":"游戏正在运行","messageEn":"The game is running.","path":null}}"#, READ]);
        assert_eq!(state(&run), JobState::Failed);
        assert_eq!(run.closes, 1);
    }

    #[test]
    fn an_engine_error_on_execute_is_unknown_and_closes_the_input() {
        let run = run(&[r#"{"v":1,"requestId":"r1","type":"reply","ok":false,"error":{"code":"ENGINE_ERROR","message":"出错了","messageEn":"Something failed.","path":null}}"#, READ]);
        assert_eq!(state(&run), JobState::Unknown);
        assert_eq!(run.closes, 2);
    }

    #[test]
    fn a_reply_to_an_unknown_request_or_stray_progress_ends_the_protocol() {
        // The progress line names the execute's operation but arrives on the read's request id.
        for line in [
            r#"{"v":1,"requestId":"nobody","type":"reply","ok":true,"data":null}"#,
            r#"{"v":1,"requestId":"r2","type":"progress","operationId":"op-1","data":{"phase":"installing","completed":1,"total":1,"currentFile":null,"batchId":null}}"#,
        ] {
            let run = run(&[line, FINAL]);
            assert!(run.ended);
            assert_eq!(state(&run), JobState::Unknown, "{line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn log_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kvk-worker-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_worker_that_exits_early_is_explained_in_chinese_with_the_log_to_send() {
        assert!(WORKER_EXITED.starts_with("后台组件意外退出"));
        assert!(WORKER_EXITED.contains(r"%LOCALAPPDATA%\Aimloom\logs\worker.log"));
    }

    /// Naming a log file is not help unless the message also says where to send it. Both ways
    /// out still work with the worker dead: a report is built and sent by the native layer, not
    /// by the worker.
    #[test]
    fn a_worker_that_exits_early_names_both_ways_to_reach_us_in_both_languages() {
        for text in [WORKER_EXITED, WORKER_EXITED_EN] {
            assert!(text.contains("feedback@aimloom.dev"), "no address in: {text}");
        }
        assert!(WORKER_EXITED.contains("发送问题报告"), "the Chinese text must name the Settings action");
        assert!(WORKER_EXITED_EN.contains("Send a report"), "the English text must name the Settings action");
    }

    #[test]
    fn worker_log_lives_beside_the_backups_in_the_data_folder() {
        let local = log_dir("path");
        assert_eq!(worker_log_path(&local), local.join("Aimloom").join("logs").join("worker.log"));
    }

    // The data folder was renamed KovaaKConfigInstaller -> Aimloom. These mirror the engine's
    // `the_engine_adopts_the_old_data_folder_once_and_never_splits_the_data`: data is never split
    // across the two names.
    #[test]
    fn data_root_is_aimloom_on_a_fresh_machine_and_resolving_creates_nothing() {
        let local = log_dir("fresh");
        fs::create_dir_all(&local).unwrap();
        assert_eq!(data_root(&local), local.join("Aimloom"));
        assert!(!local.join("Aimloom").exists() && !local.join("KovaaKConfigInstaller").exists());
        let _ = fs::remove_dir_all(&local);
    }

    #[test]
    fn data_root_adopts_the_old_folder_by_renaming_it() {
        let local = log_dir("adopt");
        let old = local.join("KovaaKConfigInstaller");
        fs::create_dir_all(old.join("backups")).unwrap();
        fs::write(old.join("backups").join("manifest.json"), b"kept").unwrap();
        assert_eq!(data_root(&local), local.join("Aimloom"));
        assert!(!old.exists(), "the old folder must be renamed, not copied");
        assert_eq!(fs::read(local.join("Aimloom").join("backups").join("manifest.json")).unwrap(), b"kept");
        assert_eq!(data_root(&local), local.join("Aimloom"));
        let _ = fs::remove_dir_all(&local);
    }

    #[test]
    fn data_root_prefers_aimloom_and_leaves_the_old_folder_alone_when_both_exist() {
        let local = log_dir("both");
        fs::create_dir_all(local.join("Aimloom")).unwrap();
        fs::create_dir_all(local.join("KovaaKConfigInstaller")).unwrap();
        fs::write(local.join("KovaaKConfigInstaller").join("keep.txt"), b"old").unwrap();
        assert_eq!(data_root(&local), local.join("Aimloom"));
        assert_eq!(fs::read(local.join("KovaaKConfigInstaller").join("keep.txt")).unwrap(), b"old");
        assert!(!local.join("Aimloom").join("keep.txt").exists(), "nothing may be merged");
        let _ = fs::remove_dir_all(&local);
    }

    /// An older build that is still running keeps its log open in the old folder. Windows then
    /// refuses the rename, and the new build must work from the same folder rather than start
    /// a second one beside it.
    #[cfg(target_os = "windows")]
    #[test]
    fn data_root_stays_on_the_old_folder_while_a_running_instance_holds_its_log_open() {
        let local = log_dir("held-open");
        let old = local.join("KovaaKConfigInstaller");
        let held = open_worker_log(&old.join("logs").join("worker.log"), UNIX_EPOCH).expect("log opens");
        assert_eq!(data_root(&local), old);
        assert!(!local.join("Aimloom").exists(), "no second folder may appear");
        drop(held);
        assert_eq!(data_root(&local), local.join("Aimloom"));
        assert!(!old.exists());
        let _ = fs::remove_dir_all(&local);
    }

    #[test]
    fn data_root_stays_on_the_old_folder_when_something_is_in_the_way() {
        let local = log_dir("rename-fails");
        fs::create_dir_all(local.join("KovaaKConfigInstaller").join("backups")).unwrap();
        fs::write(local.join("Aimloom"), b"a file is in the way").unwrap();
        assert_eq!(data_root(&local), local.join("KovaaKConfigInstaller"));
        // The log must follow the data, never start a second folder.
        assert_eq!(worker_log_path(&local), local.join("KovaaKConfigInstaller").join("logs").join("worker.log"));
        assert!(local.join("KovaaKConfigInstaller").join("backups").is_dir());
        let _ = fs::remove_dir_all(&local);
    }

    #[test]
    fn worker_log_is_created_with_its_folders_and_appends_one_header_per_session() {
        let dir = log_dir("append");
        let path = dir.join("logs").join("worker.log");
        let first = UNIX_EPOCH + Duration::from_secs(1_726_617_600);
        let mut file = open_worker_log(&path, first).expect("log opens");
        writeln!(file, "stderr line").unwrap();
        drop(file);
        drop(open_worker_log(&path, first + Duration::from_secs(61)).expect("log reopens"));
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(
            text,
            "=== worker session 2024-09-18 00:00:00 UTC ===\nstderr line\n=== worker session 2024-09-18 00:01:01 UTC ===\n",
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn worker_log_over_one_mebibyte_is_rotated_before_the_new_session() {
        let dir = log_dir("rotate");
        let path = dir.join("worker.log");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, vec![b'x'; (MAX_LOG_BYTES + 1) as usize]).unwrap();
        drop(open_worker_log(&path, UNIX_EPOCH).expect("log opens after rotation"));
        assert_eq!(fs::metadata(dir.join("worker.log.1")).unwrap().len(), MAX_LOG_BYTES + 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), "=== worker session 1970-01-01 00:00:00 UTC ===\n");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn worker_log_that_cannot_be_created_gives_none_rather_than_an_error() {
        let dir = log_dir("blocked");
        fs::create_dir_all(&dir).unwrap();
        // A file where the logs folder should be: logging must fail quietly, never stop the worker.
        let blocker = dir.join("logs");
        fs::write(&blocker, b"not a folder").unwrap();
        assert!(open_worker_log(&blocker.join("worker.log"), UNIX_EPOCH).is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn utc_timestamps_are_formatted_without_a_date_library() {
        for (seconds, expected) in [
            (0, "1970-01-01 00:00:00 UTC"),
            (951_782_400, "2000-02-29 00:00:00 UTC"),
            (1_709_210_096, "2024-02-29 12:34:56 UTC"),
            (1_726_617_600, "2024-09-18 00:00:00 UTC"),
        ] {
            assert_eq!(format_utc(UNIX_EPOCH + Duration::from_secs(seconds)), expected, "{seconds}");
        }
    }

    #[test]
    fn the_english_exit_message_is_english_and_names_the_log() {
        assert!(!super::super::protocol::has_cjk(WORKER_EXITED_EN));
        assert!(WORKER_EXITED_EN.contains("worker.log"));
    }
}
