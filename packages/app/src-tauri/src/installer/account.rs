//! The optional Steam account: a pasted profile link resolved by the site into an account.
use serde::Serialize;
use serde_json::{json, Value};

use super::commands::blocking;
use super::net::Http;
use super::protocol::{ErrorCode, Issue};

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
    blocking("account", move || account_resolve_with(&Http::new(), &url)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::protocol::has_cjk;
    use super::super::test_support::serve_json;

    #[test]
    fn account_resolve_refuses_an_empty_url_before_any_connection() {
        let http = super::super::net::Http::with_base("http://127.0.0.1:1");
        let issue = account_resolve_with(&http, "   ").unwrap_err();
        assert_eq!(issue.code, ErrorCode::InvalidPath);
    }

    #[test]
    fn account_resolve_answers_the_account_on_success() {
        let http = serve_json(200, r#"{"steamId":"76561198000000000","name":"Player"}"#).0;
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
            let http = serve_json(400, body).0;
            let issue = account_resolve_with(&http, "https://steamcommunity.com/id/player/").unwrap_err();
            assert_eq!(issue.code, *expected, "{body}");
            assert!(has_cjk(&issue.message), "{body}");
            assert!(!has_cjk(&issue.message_en), "{body}");
        }
    }

    #[test]
    fn account_resolve_refuses_an_incomplete_success_body() {
        let http = serve_json(200, r#"{"steamId":"76561198000000000"}"#).0;
        let issue = account_resolve_with(&http, "https://steamcommunity.com/id/player/").unwrap_err();
        assert_eq!(issue.code, ErrorCode::WorkerUnavailable);
    }
}
