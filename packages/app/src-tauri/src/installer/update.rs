//! The launch update check against the site's latest.json. It never fails: anything but a
//! readable answer means "no update known".
use serde::Serialize;
use serde_json::Value;

use super::net::Http;
use super::protocol::Issue;

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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_support::serve_json;

    #[test]
    fn update_check_reports_a_newer_release() {
        let http = serve_json(200, r#"{"version":"0.1.3"}"#).0;
        let out = update_check_with(&http, "0.1.2", false);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert!(out.newer);
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_reports_up_to_date_with_the_stable_channel() {
        let http = serve_json(200, r#"{"version":"0.1.3"}"#).0;
        let out = update_check_with(&http, "0.1.3", false);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert!(!out.newer);
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_never_fails_on_a_non_200() {
        let http = serve_json(500, "oops").0;
        let out = update_check_with(&http, "0.1.2", false);
        assert_eq!(out.latest, None);
        assert!(!out.newer);
    }

    #[test]
    fn update_check_never_fails_on_an_unparsable_body() {
        let http = serve_json(200, "not json").0;
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
        let http = serve_json(200, r#"{"version":"0.1.3","beta":"0.1.4-beta.1"}"#).0;
        let out = update_check_with(&http, "0.1.3", false);
        // The stable field itself is not newer than the running 0.1.3, so with the switch off
        // nothing is offered even though a newer beta exists in the body.
        assert!(!out.newer);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_offers_the_beta_when_the_switch_is_on() {
        let http = serve_json(200, r#"{"version":"0.1.3","beta":"0.1.4-beta.1"}"#).0;
        let out = update_check_with(&http, "0.1.3", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.4-beta.1"));
        assert!(out.newer);
        assert_eq!(out.channel, "beta");
    }

    #[test]
    fn update_check_treats_a_missing_beta_field_as_no_beta() {
        // Today's site (0.1.3) answers only {"version": ...}.
        let http = serve_json(200, r#"{"version":"0.1.3"}"#).0;
        let out = update_check_with(&http, "0.1.2", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_treats_a_null_beta_field_as_no_beta() {
        let http = serve_json(200, r#"{"version":"0.1.3","beta":null}"#).0;
        let out = update_check_with(&http, "0.1.2", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.3"));
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_offers_a_stable_release_that_outranks_a_running_beta() {
        // A beta player who turns the switch off: their running 0.1.4-beta.1 keeps being offered
        // nothing until a stable 0.1.4 exists, at which point it is offered as the way back.
        let http = serve_json(200, r#"{"version":"0.1.4"}"#).0;
        let out = update_check_with(&http, "0.1.4-beta.1", false);
        assert_eq!(out.latest.as_deref(), Some("0.1.4"));
        assert!(out.newer);
        assert_eq!(out.channel, "stable");
    }

    #[test]
    fn update_check_prefers_whichever_candidate_is_genuinely_newer() {
        // The site is expected to null the beta field once it is not newer than the stable
        // release, but the parser stays correct even if it is not: the newer of the two wins.
        let http = serve_json(200, r#"{"version":"0.1.5","beta":"0.1.4-beta.9"}"#).0;
        let out = update_check_with(&http, "0.1.3", true);
        assert_eq!(out.latest.as_deref(), Some("0.1.5"));
        assert_eq!(out.channel, "stable");
    }
}
