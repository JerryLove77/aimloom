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
    executable: PathBuf,
    script: PathBuf,
    /// `%LOCALAPPDATA%`, under which the worker's stderr log is kept. `None` discards the log
    /// (tests, and any machine without the variable). The log's folder is resolved at each
    /// spawn, not here, so it always matches the folder the worker is about to use.
    log_root: Option<PathBuf>,
}

impl WorkerConfig {
    pub fn production() -> Result<Self, Issue> {
        #[cfg(not(target_os = "windows"))]
        {
            Err(Issue::plain(
                ErrorCode::UnsupportedPlatform,
                "The installer engine is available only on Windows with PowerShell 7 or newer.",
            ))
        }
        #[cfg(target_os = "windows")]
        {
            let executable = discover_pwsh()?;
            let script = production_worker_path()?;
            // scripts\gui\kvk-gui-worker.ps1 → scripts\. See unblock_own_scripts.
            if let Some(scripts) = script.parent().and_then(Path::parent) {
                unblock_own_scripts(scripts);
            }
            let log_root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
            Ok(Self { executable, script, log_root })
        }
    }

    #[cfg(test)]
    pub fn for_test(executable: impl Into<PathBuf>, script: impl Into<PathBuf>) -> Self {
        Self { executable: executable.into(), script: script.into(), log_root: None }
    }
}

/// Pins a validated interpreter to a stable absolute path.
///
/// `canonicalize` is preferred because resolving links stops a later PATH change from
/// swapping the interpreter out from under a running session. It fails on an MSIX app
/// execution alias — a zero-byte reparse point whose target sits in ACL-protected
/// WindowsApps, reported as os error 1920. Such an alias is exactly how a Store-installed
/// PowerShell is meant to start, and the caller only reaches here after proving the
/// candidate runs and reports version 7 or newer, so fall back to a lexically absolute
/// path rather than rejecting a working interpreter.
#[cfg(any(test, target_os = "windows"))]
fn pin_interpreter(path: &Path) -> Result<PathBuf, Issue> {
    if let Ok(resolved) = fs::canonicalize(path) {
        return Ok(strip_extended_length_prefix(resolved));
    }
    std::path::absolute(path).map_err(|e| {
        Issue::worker(format!("could not resolve the interpreter path \"{}\": {e}", path.display()))
    })
}

/// Removes the `\\?\` extended-length prefix that `fs::canonicalize` adds on Windows.
///
/// PowerShell refuses a script named by a verbatim path: its AuthorizationManager cannot
/// authorize one, so `-File \\?\C:\...` exits with `SecurityError: AuthorizationManager
/// check failed` before running a line. That is not an execution-policy problem — the same
/// script at an ordinary path runs — so the fix belongs here and must not touch policy.
/// Canonicalization is still what proves the script exists and resolves links, so the
/// prefix is stripped from its result rather than the call being dropped. A verbatim path
/// with no ordinary spelling (a `Volume{...}` GUID, say) is returned unchanged; nothing in
/// this tree produces one.
#[cfg(any(test, target_os = "windows"))]
fn strip_extended_length_prefix(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else { return path };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest)
            if rest.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
                && rest.as_bytes().get(1) == Some(&b':') =>
        {
            PathBuf::from(rest)
        }
        _ => path,
    }
}

/// Shown on every section when PowerShell 7 is missing. Most players' Windows ships only
/// Windows PowerShell 5.1, so this is the first thing a new user is likely to hit.
#[cfg(any(test, target_os = "windows"))]
const PWSH_MISSING: &str = "没有找到 PowerShell 7。请先安装，然后重新打开本程序：在「终端」中运行 winget install --id Microsoft.PowerShell，或访问 https://aka.ms/powershell 下载。";
#[cfg(any(test, target_os = "windows"))]
const PWSH_MISSING_EN: &str = "PowerShell 7 was not found. Install it, then reopen Aimloom: run winget install --id Microsoft.PowerShell in Terminal, or download it from https://aka.ms/powershell.";

/// Shown when the worker stops before answering: every pending request gets this. The most
/// likely causes are outside the app (a blocked script, a broken PowerShell install), and the
/// log is what shows which one.
const WORKER_EXITED: &str = "后台组件意外退出，这次操作没有完成。请关闭并重新打开 Aimloom；如果仍然出现，请在「设置」里点「发送问题报告…」，或把 %LOCALAPPDATA%\\Aimloom\\logs\\worker.log 发到 feedback@aimloom.dev。";
const WORKER_EXITED_EN: &str = "The background worker stopped unexpectedly and this operation did not finish. Close and reopen Aimloom; if it happens again, use \"Send a report…\" in Settings, or email %LOCALAPPDATA%\\Aimloom\\logs\\worker.log to feedback@aimloom.dev.";

/// Unblocks the app's own scripts.
///
/// A ZIP downloaded in a browser and extracted with Explorer marks every file as coming from
/// the internet (an NTFS `Zone.Identifier` stream). PowerShell's default RemoteSigned policy
/// then refuses the unsigned worker, and every section fails. Observed on 2026-09-19 with the
/// real 0.1.1 download. The scripts ship beside the executable the player chose to run, so the
/// app removes that mark from its own `scripts` folder, and only there. That is what Properties →
/// Unblock does; the execution policy is never changed.
///
/// Best effort: links and junctions are not followed, the walk is bounded, and any failure
/// leaves startup as it was. Returns how many marks were removed.
#[cfg(any(test, target_os = "windows"))]
fn unblock_own_scripts(root: &Path) -> usize {
    let mut removed = 0;
    let mut visited = 0;
    let mut folders = vec![(root.to_path_buf(), 0)];
    while let Some((folder, depth)) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 1000 {
                return removed;
            }
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else { continue };
            if is_link(&meta) {
                continue;
            }
            if meta.is_dir() {
                if depth < 4 {
                    folders.push((path, depth + 1));
                }
            } else if meta.is_file() && remove_download_mark(&path) {
                removed += 1;
            }
        }
    }
    removed
}

#[cfg(target_os = "windows")]
fn is_link(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}
#[cfg(all(test, not(target_os = "windows")))]
fn is_link(meta: &fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

/// Deletes the file's `Zone.Identifier` stream. The file's own bytes are untouched.
#[cfg(target_os = "windows")]
fn remove_download_mark(path: &Path) -> bool {
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    fs::remove_file(stream).is_ok()
}
/// Alternate data streams exist only on NTFS: elsewhere there is nothing to remove, and a file
/// literally named `x:Zone.Identifier` must never be deleted.
#[cfg(all(test, not(target_os = "windows")))]
fn remove_download_mark(_path: &Path) -> bool {
    false
}

/// Rotate the worker log once it passes this size, so it cannot grow without bound.
const MAX_LOG_BYTES: u64 = 1024 * 1024;

const DATA_FOLDER: &str = "Aimloom";
const LEGACY_DATA_FOLDER: &str = "KovaaKConfigInstaller";

/// The data folder under `%LOCALAPPDATA%`: backups, first-protection records, Profiles, locks
/// and this log. It was `KovaaKConfigInstaller` before the product became Aimloom.
///
/// This mirrors `Get-KvkDataRoot` in `kvk-engine.ps1`, and the two must agree, because the rule
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

#[cfg(target_os = "windows")]
fn validated_pwsh(path: &Path) -> bool {
    if !path.is_file() { return false; }
    let output = Command::new(path)
        .args(["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"])
        .stdin(Stdio::null()).stderr(Stdio::null()).output();
    output.ok().and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<u32>().ok()).map(|major| major >= 7).unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn discover_pwsh() -> Result<PathBuf, Issue> {
    let program_files = std::env::var_os("ProgramFiles")
        .map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let normal = program_files.join("PowerShell").join("7").join("pwsh.exe");
    if validated_pwsh(&normal) { return pin_interpreter(&normal); }

    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            let candidate = directory.join("pwsh.exe");
            if validated_pwsh(&candidate) {
                return pin_interpreter(&candidate);
            }
        }
    }
    Err(Issue::new(ErrorCode::WorkerUnavailable, PWSH_MISSING, PWSH_MISSING_EN))
}

#[cfg(target_os = "windows")]
fn production_worker_path() -> Result<PathBuf, Issue> {
    #[cfg(debug_assertions)]
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/installer/gui/kvk-gui-worker.ps1");
    #[cfg(not(debug_assertions))]
    let path = std::env::current_exe().map_err(|e| Issue::worker(e.to_string()))?
        .parent().ok_or_else(|| Issue::worker("application executable has no parent directory"))?
        .join("scripts").join("gui").join("kvk-gui-worker.ps1");
    fs::canonicalize(&path)
        .map(strip_extended_length_prefix)
        .map_err(|e| Issue::worker(format!("worker script is missing at \"{}\": {e}", path.display())))
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
        let mut command = Command::new(&config.executable);
        command.args(["-NoProfile", "-NonInteractive", "-File"])
            .arg(&config.script)
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
        thread::spawn(move || read_stdout(stdout, pending, jobs, protocol_ended, process));
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
    process: Arc<Mutex<ProcessState>>,
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
                                    process.lock().unwrap().stdin.take();
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
                                    process.lock().unwrap().stdin.take();
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
    process.lock().unwrap().stdin.take();
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
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn eof_without_final_reply_marks_execute_unknown() {
        let pwsh = PathBuf::from("/private/tmp/kvk-b2-pwsh/pwsh");
        if !pwsh.is_file() { return; }
        let dir = std::env::temp_dir().join(format!("kvk-worker-eof-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("eof.ps1");
        fs::write(&script, "$null = [Console]::In.ReadLine(); exit 0\n").unwrap();
        let jobs = Arc::new(Mutex::new(JobManager::default()));
        let request = ExecuteRequest {
            operation_id: "op-eof".into(), plan_id: "plan-eof".into(),
            confirmation: super::super::protocol::Confirmation::Install, allow_conflicts: false,
        };
        jobs.lock().unwrap().reserve(request.clone()).unwrap();
        let worker = WorkerClient::spawn(WorkerConfig::for_test(pwsh, &script), jobs.clone()).unwrap();
        worker.execute(&request).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if jobs.lock().unwrap().get("op-eof").unwrap().state == super::super::protocol::JobState::Unknown { break; }
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(jobs.lock().unwrap().get("op-eof").unwrap().state, super::super::protocol::JobState::Unknown);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn bundled_worker_fixture_speaks_jsonl_over_real_pwsh() {
        let pwsh = PathBuf::from("/private/tmp/kvk-b2-pwsh/pwsh");
        if !pwsh.is_file() { return; }
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../scripts/installer/gui/kvk-gui-worker.ps1");
        if !script.is_file() { return; }

        let jobs = Arc::new(Mutex::new(JobManager::default()));
        let worker = WorkerClient::spawn(WorkerConfig::for_test(pwsh, script), jobs).unwrap();
        let state = worker.read("gameState", serde_json::json!({})).unwrap();
        assert!(matches!(state.as_str(), Some("closed" | "running" | "unknown")));
        worker.shutdown_idle();
    }

    #[test]
    fn malformed_final_report_closes_input_so_worker_can_exit_for_reconciliation() {
        let pwsh = PathBuf::from("/private/tmp/kvk-b2-pwsh/pwsh");
        if !pwsh.is_file() { return; }
        let dir = std::env::temp_dir().join(format!("kvk worker invalid final {}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("invalid-final.ps1");
        fs::write(
            &script,
            "$request=[Console]::In.ReadLine() | ConvertFrom-Json\n[Console]::Out.WriteLine(('{\"v\":1,\"requestId\":\"'+$request.requestId+'\",\"type\":\"reply\",\"ok\":true,\"data\":{\"status\":\"invalid\",\"batchId\":null,\"items\":[],\"errors\":[]}}'))\n[Console]::Out.Flush()\nwhile($null -ne [Console]::In.ReadLine()){}\n",
        ).unwrap();
        let jobs = Arc::new(Mutex::new(JobManager::default()));
        let request = ExecuteRequest {
            operation_id: "op-invalid".into(), plan_id: "plan-invalid".into(),
            confirmation: super::super::protocol::Confirmation::Install, allow_conflicts: false,
        };
        jobs.lock().unwrap().reserve(request.clone()).unwrap();
        let worker = WorkerClient::spawn(WorkerConfig::for_test(pwsh, &script), jobs.clone()).unwrap();
        worker.execute(&request).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if jobs.lock().unwrap().get("op-invalid").unwrap().state == super::super::protocol::JobState::Unknown
                && worker.has_exited().unwrap() { break; }
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(jobs.lock().unwrap().get("op-invalid").unwrap().state, super::super::protocol::JobState::Unknown);
        assert!(worker.has_exited().unwrap(), "worker remained alive waiting for stdin after malformed final report");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pinning_falls_back_when_a_validated_interpreter_cannot_be_canonicalized() {
        // Stands in for an MSIX execution alias: a path that spawns but cannot be
        // canonicalized, which on Windows surfaces as os error 1920.
        let missing = std::env::temp_dir()
            .join(format!("kvk-absent-{}", std::process::id()))
            .join("pwsh.exe");
        assert!(fs::canonicalize(&missing).is_err(), "fixture must not be canonicalizable");

        let pinned = pin_interpreter(&missing).expect("an unresolvable candidate must still pin");
        assert!(pinned.is_absolute(), "pinned interpreter path must be absolute");
        assert!(pinned.ends_with("pwsh.exe"), "pinned path must still name the interpreter");
    }

    #[test]
    fn pinning_prefers_the_canonical_path_when_one_is_available() {
        let real = std::env::current_exe().expect("test binary has a path");
        let pinned = pin_interpreter(&real).expect("an existing file must pin");
        // Compared against the stripped canonical path, not the raw one: on Windows
        // canonicalize returns a `\\?\` path and pinning removes that prefix, so the raw
        // form would make this assertion fail on the only platform that ships.
        assert_eq!(pinned, strip_extended_length_prefix(fs::canonicalize(&real).unwrap()));
    }

    #[test]
    fn a_verbatim_drive_path_loses_the_prefix_powershell_refuses_to_authorize() {
        let stripped = strip_extended_length_prefix(PathBuf::from(
            r"\\?\C:\kvka1\scripts\gui\kvk-gui-worker.ps1",
        ));
        assert_eq!(stripped, PathBuf::from(r"C:\kvka1\scripts\gui\kvk-gui-worker.ps1"));
        assert!(
            !stripped.to_str().unwrap().starts_with(r"\\?\"),
            "a path handed to pwsh -File must never carry the extended-length prefix",
        );
    }

    #[test]
    fn a_verbatim_unc_path_becomes_an_ordinary_unc_path() {
        let stripped = strip_extended_length_prefix(PathBuf::from(r"\\?\UNC\host\share\worker.ps1"));
        assert_eq!(stripped, PathBuf::from(r"\\host\share\worker.ps1"));
    }

    #[test]
    fn paths_that_have_no_ordinary_spelling_are_left_alone() {
        for original in [
            r"C:\kvka1\scripts\gui\kvk-gui-worker.ps1",
            r"\\?\Volume{3a7b0c11-0000-0000-0000-100000000000}\worker.ps1",
            r"\\?\",
            "/private/tmp/kvk/worker.ps1",
        ] {
            let path = PathBuf::from(original);
            assert_eq!(
                strip_extended_length_prefix(path.clone()),
                path,
                "{original} must be returned unchanged",
            );
        }
    }

    fn log_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kvk-worker-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// A browser download extracted with Explorer: every file carries the mark.
    #[cfg(target_os = "windows")]
    fn mark(path: &Path) {
        let mut stream = path.as_os_str().to_owned();
        stream.push(":Zone.Identifier");
        fs::write(stream, "[ZoneTransfer]\r\nZoneId=3\r\n").expect("mark written");
    }
    #[cfg(target_os = "windows")]
    fn marked(path: &Path) -> bool {
        let mut stream = path.as_os_str().to_owned();
        stream.push(":Zone.Identifier");
        fs::metadata(stream).is_ok()
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn unblock_clears_the_download_mark_from_every_file_in_its_own_scripts_folder_only() {
        let root = log_dir("unblock");
        let scripts = root.join("scripts");
        fs::create_dir_all(scripts.join("gui")).unwrap();
        let worker = scripts.join("gui").join("kvk-gui-worker.ps1");
        let engine = scripts.join("kvk-engine.ps1");
        let outside = root.join("elsewhere.ps1");
        for (path, text) in [(&worker, "worker"), (&engine, "engine"), (&outside, "outside")] {
            fs::write(path, text).unwrap();
            mark(path);
        }
        assert_eq!(unblock_own_scripts(&scripts), 2);
        assert!(!marked(&worker) && !marked(&engine), "the app's own scripts must be unblocked");
        assert!(marked(&outside), "nothing outside the scripts folder may be touched");
        assert_eq!(fs::read_to_string(&worker).unwrap(), "worker", "the file itself is unchanged");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn unblock_leaves_unmarked_files_alone() {
        let scripts = log_dir("unmarked").join("scripts");
        fs::create_dir_all(&scripts).unwrap();
        fs::write(scripts.join("kvk-engine.ps1"), "engine").unwrap();
        assert_eq!(unblock_own_scripts(&scripts), 0);
        assert_eq!(fs::read_to_string(scripts.join("kvk-engine.ps1")).unwrap(), "engine");
        let _ = fs::remove_dir_all(scripts.parent().unwrap());
    }

    #[test]
    fn unblock_of_a_missing_folder_is_a_quiet_no_op() {
        assert_eq!(unblock_own_scripts(&log_dir("missing").join("scripts")), 0);
    }

    #[test]
    fn a_worker_that_exits_early_is_explained_in_chinese_with_the_log_to_send() {
        assert!(WORKER_EXITED.starts_with("后台组件意外退出"));
        assert!(WORKER_EXITED.contains(r"%LOCALAPPDATA%\Aimloom\logs\worker.log"));
    }

    /// Naming a log file is not help unless the message also says where to send it. Both ways
    /// out still work with the worker dead: a report is built and sent by the native layer, not
    /// by PowerShell.
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

    // The data folder was renamed KovaaKConfigInstaller -> Aimloom. These mirror
    // scripts/installer/tests/data-root.test.ps1: data is never split across the two names.
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
    fn missing_powershell_message_is_chinese_and_says_how_to_install_it() {
        assert!(PWSH_MISSING.starts_with("没有找到 PowerShell 7。"));
        assert!(PWSH_MISSING.contains("winget install --id Microsoft.PowerShell"));
        assert!(PWSH_MISSING.contains("https://aka.ms/powershell"));
    }

    #[test]
    fn missing_powershell_message_in_english_says_how_to_install_it() {
        assert!(PWSH_MISSING_EN.starts_with("PowerShell 7 was not found."));
        assert!(PWSH_MISSING_EN.contains("winget install --id Microsoft.PowerShell"));
        assert!(PWSH_MISSING_EN.contains("https://aka.ms/powershell"));
        assert!(!super::super::protocol::has_cjk(PWSH_MISSING_EN));
        assert!(!super::super::protocol::has_cjk(WORKER_EXITED_EN));
        assert!(WORKER_EXITED_EN.contains("worker.log"));
    }
}
