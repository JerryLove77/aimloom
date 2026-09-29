//! Handing things to the Windows shell: the backup and logs folders, the site's download and
//! explore pages, and the game through Steam. Every address is built here; the UI never sends one.
use std::path::Path;
use std::sync::Arc;

use tauri::State;

use super::commands::{blocking, InstallerRuntime};
use super::protocol::{ErrorCode, Issue};
use super::worker::worker_log_path;

/// Opens `target` with explorer.exe; `failure` starts the message when Windows refuses.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn open_with_explorer(target: impl AsRef<std::ffi::OsStr>, code: ErrorCode, failure: &str) -> Result<(), Issue> {
    use std::process::{Command, Stdio};
    Command::new("explorer.exe").arg(target).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|e| Issue::plain(code, format!("{failure}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn installer_open_backup(
    state: State<'_, Arc<InstallerRuntime>>,
    game_root: String,
) -> Result<(), Issue> {
    let runtime = state.inner().clone();
    blocking("folder", move || installer_open_backup_blocking(&runtime, game_root)).await
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
        open_with_explorer(path, ErrorCode::BackupInvalid, "could not open backup folder")
    }
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
        open_with_explorer(&dir, ErrorCode::EngineError, "could not open the logs folder")
    }
}

fn installer_open_logs_blocking() -> Result<(), Issue> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| Issue::new(ErrorCode::EngineError, "找不到 LOCALAPPDATA 环境变量。", "The LOCALAPPDATA environment variable is not set."))?;
    open_logs_at(Path::new(&local_app_data))
}

#[tauri::command]
pub async fn installer_open_logs() -> Result<(), Issue> {
    blocking("folder", installer_open_logs_blocking).await
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
        open_with_explorer(&url, ErrorCode::EngineError, "could not open the download page")
    }
}

#[tauri::command]
pub async fn installer_open_download(lang: String, channel: String) -> Result<(), Issue> {
    blocking("folder", move || installer_open_download_blocking(lang, channel)).await
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
        open_with_explorer(&url, ErrorCode::EngineError, "could not open the explorer")
    }
}

#[tauri::command]
pub async fn installer_open_explore(lang: String, kind: String) -> Result<(), Issue> {
    blocking("explorer", move || installer_open_explore_blocking(lang, kind)).await
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
        open_with_explorer(STEAM_LAUNCH_URL, ErrorCode::EngineError, "could not start the game")
    }
}

#[tauri::command]
pub async fn installer_launch_game() -> Result<(), Issue> {
    blocking("launch", installer_launch_game_blocking).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::protocol::has_cjk;

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
}
