//! The two report commands and the OS facts a report carries. The payload itself is built and
//! sent in `report.rs`; this side only holds the one previewed payload and hands it over.
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::path::Path;
#[cfg(target_os = "windows")]
use std::process::Command;

use serde::Serialize;
use tauri::State;

use super::commands::{blocking, InstallerRuntime};
use super::net::Http;
use super::protocol::{ErrorCode, Issue};
use super::report::{Prepared, ReportInput};

#[tauri::command]
pub async fn installer_report_preview(
    state: State<'_, Arc<InstallerRuntime>>,
    input: ReportInput,
) -> Result<Prepared, Issue> {
    let runtime = state.inner().clone();
    blocking("report", move || installer_report_preview_blocking(&runtime, input)).await
}

fn installer_report_preview_blocking(state: &InstallerRuntime, input: ReportInput) -> Result<Prepared, Issue> {
    let facts = gather_facts(input.attach_log, state.engine())?;
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
    blocking("report", move || installer_report_send_blocking(&runtime, sha256)).await
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

/// Best-effort OS facts for the report; nothing here is exercised by this crate's test suite,
/// which runs on macOS. `attach_log` is threaded through so a report that will not carry the log
/// never pays for reading `worker.log`.
#[cfg(target_os = "windows")]
fn gather_facts(attach_log: bool, engine: super::engine_choice::EngineKind) -> Result<super::report::Facts, Issue> {
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
        engine,
        version,
        log_tail,
        user: std::env::var("USERNAME").unwrap_or_default(),
        machine: std::env::var("COMPUTERNAME").unwrap_or_default(),
    })
}
#[cfg(not(target_os = "windows"))]
fn gather_facts(_attach_log: bool, _engine: super::engine_choice::EngineKind) -> Result<super::report::Facts, Issue> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::worker::WorkerConfig;

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
}
