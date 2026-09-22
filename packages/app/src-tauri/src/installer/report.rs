//! The report's first half: scrubbing. `scrub` is what stands behind the Privacy page's promise
//! that a sent `worker.log` has the Windows user name and PC name replaced first; `log_tail`
//! reads the bytes it is applied to. The second half, below, is the payload builder: `prepare`
//! builds the exact bytes once, `send` transmits exactly those bytes. Nothing between the two
//! may substitute content — that is the whole promise on the Privacy page.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::net::Http;
use super::protocol::{ErrorCode, Issue};
use super::version::AppVersion;

/// Replaces every case-insensitive occurrence of `user` with `<user>` and of `machine` with
/// `<pc>`, then collapses any remaining `Users\<name>` (or `Users/<name>`) path segment to
/// `Users\<user>` regardless of whose name is there. The literal pass runs first so a name that
/// is only part of a longer path segment (`Player1Backup`) is still fully anonymized once the
/// path pass collapses what is left of that segment; the path pass runs last so it also catches
/// a *different* user's folder that the literal pass never touches. Two boundaries trigger the
/// path pass, not only the brief's drive-letter case, because a name behind `\\SERVER\Users\...`
/// (a UNC path, which Windows also produces) must not survive either: start of text, a path
/// separator, or `:` (the drive-letter case).
pub fn scrub(text: &str, user: &str, machine: &str) -> String {
    let out = replace_ci(text, user, "<user>");
    let out = replace_ci(&out, machine, "<pc>");
    collapse_users_folder(&out)
}

/// Reads the last `max_bytes` of `path`, cut forward to the start of a line so a report never
/// opens mid-line, and decodes lossily so an older log's non-UTF-8 (e.g. GBK) tail can never
/// panic or block a report. `None` only when the file cannot be read (missing, permissions);
/// an empty file is `Some(String::new())`.
pub fn log_tail(path: &Path, max_bytes: usize) -> Option<String> {
    let data = fs::read(path).ok()?;
    let from = data.len().saturating_sub(max_bytes);
    // `from == 0` already starts at the top of the file, i.e. a line start; anything past that
    // is only a line start once we skip to just after the next newline. A tail with no newline
    // in it at all (one very long line) is left as-is — there is no earlier line start to cut to.
    let from = if from == 0 {
        0
    } else {
        match data[from..].iter().position(|&b| b == b'\n') {
            Some(offset) => from + offset + 1,
            None => from,
        }
    };
    Some(String::from_utf8_lossy(&data[from..]).into_owned())
}

/// The backend's per-field caps (`packages/site/src/worker/report-schema.ts`), mirrored here so
/// a player is told in their own language before anything is sent, not after a round trip.
/// `MAX_DESCRIPTION`, `MAX_CONTACT` and `MAX_NAME` are the backend's own JS `string.length` —
/// UTF-16 code units, not Unicode scalar values — because that is what it measures; `MAX_LOG_BYTES`
/// is the backend's raw UTF-8 byte count, because that is what it measures for `log`.
pub const MAX_DESCRIPTION: usize = 2000;
pub const MAX_CONTACT: usize = 200;
pub const MAX_NAME: usize = 64;
pub const MAX_LOG_BYTES: usize = 512 * 1024;
/// The backend's own whole-body cap (`packages/site/src/worker/http.ts`'s `MAX_REQUEST_BYTES`,
/// mirrored in `net.rs`). `prepare` targets a small margin under this — not exactly this — so
/// that JSON-escaping the log (a backslash or a control byte can cost two or more output bytes
/// per raw byte) can never push the finished payload over the wire cap.
const TARGET_BODY_BYTES: usize = 1024 * 1024 - 1024;

/// The backend measures `description`/`contact`/an account `name` the way JavaScript does:
/// `string.length`, which counts UTF-16 code units, not Unicode scalar values. They agree for
/// every character in the Basic Multilingual Plane and diverge only for astral characters (most
/// emoji), which JS counts as 2 and a naive `chars().count()` would count as 1 — undercounting
/// relative to the backend and so accepting locally what the backend would refuse.
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// What the player typed or chose in the report form. Wire shape is camelCase; this is what the
/// Settings popover sends over `installer_report_preview`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportInput {
    pub description: Option<String>,
    pub contact: Option<String>,
    pub attach_log: bool,
    pub account: Option<Account>,
    pub lang_choice: String,
    pub lang: String,
    pub game_found: bool,
}

/// A resolved Steam account, as the player confirmed it. `verified` is never taken from here —
/// `prepare` always writes `false` itself, so nothing the UI sends can claim a verification the
/// native layer did not perform.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub steam_id: String,
    pub name: String,
}

/// Everything the OS supplies that `prepare` needs, gathered by the caller so the builder itself
/// is testable without Windows. `log_tail` and `user`/`machine` are raw — `prepare` is what calls
/// `scrub` on them, not the caller — so a test can hand it an unscrubbed tail and check the
/// output never carries the name through.
#[derive(Debug, Clone)]
pub struct Facts {
    pub windows: String,
    pub display_language: String,
    pub powershell: Option<String>,
    pub version: AppVersion,
    pub log_tail: Option<String>,
    pub user: String,
    pub machine: String,
}

/// The payload the native session built and is keeping: `send` transmits `text` byte for byte,
/// never anything reconstructed from `ReportInput`/`Facts` again. `sha256` is what the UI is
/// shown and echoes back; `bytes` is `text`'s UTF-8 length, already checked against the backend's
/// 1 MiB body cap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub text: String,
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Serialize)]
struct AppOut<'a> {
    label: &'a str,
    commit: &'a str,
    built: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemOut<'a> {
    windows: &'a str,
    display_language: &'a str,
    lang_choice: &'a str,
    lang: &'a str,
    powershell: Option<&'a str>,
}

#[derive(Serialize)]
struct GameOut {
    found: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountOut<'a> {
    steam_id: &'a str,
    name: &'a str,
    verified: bool,
}

/// Field order here is the field order on the wire — `serde_json` serializes a struct in
/// declaration order, not alphabetically — and matches
/// `packages/app/tests/installer/report/contract.fixture.json` top to bottom.
#[derive(Serialize)]
struct ReportBody<'a> {
    app: AppOut<'a>,
    system: SystemOut<'a>,
    game: GameOut,
    account: Option<AccountOut<'a>>,
    description: Option<&'a str>,
    contact: Option<&'a str>,
    log: Option<&'a str>,
}

/// Trims and empties to `None` — the contract never allows an empty string where a value is
/// optional, only `null`.
fn normalize(field: &Option<String>) -> Option<String> {
    field.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(str::to_string)
}

fn too_long_issue(field: &str, max: usize) -> Issue {
    match field {
        "description" => Issue::new(
            ErrorCode::EngineError,
            format!("描述最多 {max} 个字符，请缩短后再试。"),
            format!("The description can be at most {max} characters. Please shorten it."),
        ),
        "contact" => Issue::new(
            ErrorCode::EngineError,
            format!("联系方式最多 {max} 个字符，请缩短后再试。"),
            format!("The contact info can be at most {max} characters. Please shorten it."),
        ),
        _ => Issue::new(
            ErrorCode::EngineError,
            format!("Steam 账号名称最多 {max} 个字符，请缩短后再试。"),
            format!("The Steam account name can be at most {max} characters. Please shorten it."),
        ),
    }
}

/// Validates the one account the App is allowed to attach: a non-empty name within the
/// backend's UTF-16 length cap, and a `steamId` that is exactly 17 ASCII digits — the backend's
/// own pattern (`/^\d{17}$/`). Checked in `prepare`, not left to a later Steam-account task to
/// get right, because `prepare` is where the payload's correctness is guaranteed.
fn validate_account(account: &Account) -> Result<(), Issue> {
    if account.name.is_empty() {
        return Err(Issue::new(
            ErrorCode::EngineError,
            "Steam 账号名称不能为空。",
            "The Steam account name cannot be empty.",
        ));
    }
    if utf16_len(&account.name) > MAX_NAME {
        return Err(too_long_issue("name", MAX_NAME));
    }
    if account.steam_id.len() != 17 || !account.steam_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Issue::new(
            ErrorCode::EngineError,
            "Steam ID 必须是 17 位数字。",
            "The Steam ID must be exactly 17 digits.",
        ));
    }
    Ok(())
}

/// Cuts `text` down to at most `max_bytes` UTF-8 bytes, keeping the *end* (the most recent lines
/// are the useful ones for a bug report) and cutting forward to the next line start so the kept
/// text never opens mid-line — the same rule `log_tail` applies when it first reads the file.
/// Scrubbing can lengthen a tail that was already exactly at the cap (a short name replaced by
/// the longer `<user>`/`<pc>` placeholder), so this runs *after* `scrub`, not instead of the cap
/// already applied when the file was read.
fn trim_to_byte_cap(text: &str, max_bytes: usize) -> String {
    let bytes = text.as_bytes();
    if bytes.len() <= max_bytes {
        return text.to_string();
    }
    let from = bytes.len() - max_bytes;
    let from = match bytes[from..].iter().position(|&b| b == b'\n') {
        Some(offset) => from + offset + 1,
        // No newline in the kept window at all: fall back to the nearest character boundary so
        // the slice below can never panic, even though the day one very long line is trimmed.
        None => {
            let mut i = from;
            while i < bytes.len() && (bytes[i] & 0xC0) == 0x80 {
                i += 1;
            }
            i
        }
    };
    text[from..].to_string()
}

/// Builds the log field, trimmed to fit both the backend's own per-field cap (`MAX_LOG_BYTES`,
/// raw UTF-8 bytes) and `budget`, the JSON-*encoded* byte count (quotes included) the rest of
/// the payload has left under `TARGET_BODY_BYTES`. A log of ordinary text needs none of the
/// second cap; a log dense with backslashes, quotes or raw control bytes — each of which JSON
/// escaping can turn into two to six output bytes — can, so this measures the actual encoded
/// size after each cut and halves the raw window until it fits, rather than assuming a fixed
/// worst-case expansion factor.
fn build_log(input: &ReportInput, env: &Facts, budget: usize) -> Option<String> {
    if !input.attach_log {
        return None;
    }
    let raw = env.log_tail.as_ref()?;
    let scrubbed = scrub(raw, &env.user, &env.machine);
    let mut cap = MAX_LOG_BYTES;
    loop {
        let candidate = trim_to_byte_cap(&scrubbed, cap);
        if candidate.is_empty() {
            return None;
        }
        let encoded_len = serde_json::to_string(&candidate).map(|s| s.len()).unwrap_or(usize::MAX);
        if encoded_len <= budget {
            return Some(candidate);
        }
        if cap == 0 {
            return None;
        }
        cap /= 2;
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Builds the exact JSON the App will send, once. Refuses an over-long `description`/`contact`
/// before any network call — the backend would refuse them too, but only after a round trip, and
/// in no language the player necessarily reads. Two calls with the same `input`/`env` produce
/// the same `text` and therefore the same `sha256`; anything different in either produces a
/// different one, which is the whole basis of the preview-equals-sent check in `send`.
pub fn prepare(input: &ReportInput, env: &Facts) -> Result<Prepared, Issue> {
    let description = normalize(&input.description);
    if let Some(d) = &description {
        if utf16_len(d) > MAX_DESCRIPTION {
            return Err(too_long_issue("description", MAX_DESCRIPTION));
        }
    }
    let contact = normalize(&input.contact);
    if let Some(c) = &contact {
        if utf16_len(c) > MAX_CONTACT {
            return Err(too_long_issue("contact", MAX_CONTACT));
        }
    }
    if let Some(account) = &input.account {
        validate_account(account)?;
    }

    let account = input.account.as_ref().map(|a| AccountOut { steam_id: &a.steam_id, name: &a.name, verified: false });
    let app = AppOut { label: &env.version.label, commit: &env.version.commit, built: &env.version.built };
    let system = SystemOut {
        windows: &env.windows,
        display_language: &env.display_language,
        lang_choice: &input.lang_choice,
        lang: &input.lang,
        powershell: env.powershell.as_deref(),
    };
    let game = GameOut { found: input.game_found };

    // Measured, not assumed: serialize everything except the log first, so the log's budget is
    // the payload's real remaining room — including whatever `description`/`contact`/`account`
    // actually cost once JSON-escaped, not an estimate of their worst case.
    let without_log = ReportBody { app, system, game, account, description: description.as_deref(), contact: contact.as_deref(), log: None };
    let without_log_text =
        serde_json::to_string(&without_log).map_err(|e| Issue::worker(format!("could not serialize the report: {e}")))?;
    // `log: None` already spent 4 bytes on the literal `null`; a real string replaces that, not
    // adds to it, so those bytes are returned to the budget.
    let log_budget = TARGET_BODY_BYTES.saturating_sub(without_log_text.len()).saturating_add(4);
    let log = build_log(input, env, log_budget);

    let body = ReportBody { log: log.as_deref(), ..without_log };
    let text = serde_json::to_string(&body).map_err(|e| Issue::worker(format!("could not serialize the report: {e}")))?;
    let bytes = text.len();
    let sha256 = sha256_hex(text.as_bytes());
    Ok(Prepared { text, sha256, bytes })
}

/// Maps the backend's `{"code": "...", ...}` answer to a bilingual `Issue`. Never forwards the
/// raw body, a URL or a path into the player's text — only the field name on `INVALID_REPORT`,
/// which is one of the report's own schema paths (`description`, `log`, …), never anything the
/// server echoed back verbatim.
fn map_backend_issue(status: u16, body: &str) -> Issue {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let code = parsed.as_ref().and_then(|v| v.get("code")).and_then(|c| c.as_str()).unwrap_or("");
    match code {
        "RATE_LIMITED" => Issue::new(
            ErrorCode::WorkerUnavailable,
            "发送过于频繁，请一分钟后再试。",
            "Too many reports just now. Try again in about a minute.",
        ),
        "DAILY_LIMIT" | "STORAGE_FULL" => Issue::new(
            ErrorCode::WorkerUnavailable,
            "反馈服务今天的额度已满，请改用邮件联系 feedback@aimloom.dev。",
            "The report service is full for today. Please write to \"feedback@aimloom.dev\" instead.",
        ),
        "TOO_LARGE" => Issue::new(
            ErrorCode::EngineError,
            "反馈内容过大，请缩短描述，或不要附加日志。",
            "The report is too large. Shorten the description, or don't attach the log.",
        ),
        "INVALID_REPORT" => {
            let field = parsed.as_ref().and_then(|v| v.get("field")).and_then(|f| f.as_str()).unwrap_or("");
            Issue::new(
                ErrorCode::EngineError,
                format!("这是我们这边的程序错误（字段 \"{field}\"），报告未发送，敬请谅解。"),
                format!("This is a bug on our side (field \"{field}\"). The report was not sent — sorry about that."),
            )
        }
        "UNKNOWN_CLIENT" => Issue::new(
            ErrorCode::EngineError,
            "客户端未被识别，请更新到最新版本后重试。",
            "The client wasn't recognized. Update to the latest version and try again.",
        ),
        _ => Issue::new(
            ErrorCode::WorkerUnavailable,
            format!("发送反馈失败（状态码 {status}），请稍后重试。"),
            format!("Sending the report failed (status {status}). Please try again later."),
        ),
    }
}

/// Transmits exactly `prepared.text` — the bytes `prepare` built and the native session has been
/// holding, never anything rebuilt from a UI request. Recomputes the hash first: a `Prepared`
/// that was not returned by `prepare` (hand-built, or with an altered `sha256`) is refused with
/// `PLAN_STALE` before any byte leaves the machine. The UI-side check (the session's own stored
/// copy against the hash the UI echoes back) is a second, independent instance of the same rule,
/// in `commands.rs`.
pub fn send(http: &Http, prepared: &Prepared) -> Result<String, Issue> {
    if sha256_hex(prepared.text.as_bytes()) != prepared.sha256 {
        return Err(Issue::plain(ErrorCode::PlanStale, "the prepared report's hash no longer matches its bytes"));
    }
    let (status, body) = http.post_json(super::net::REPORTS_PATH, &prepared.text)?;
    if status == 200 {
        let value: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| Issue::worker("the report service returned an invalid response body"))?;
        return value
            .get("number")
            .and_then(|n| n.as_str())
            .map(str::to_string)
            .ok_or_else(|| Issue::worker("the report service returned no report number"));
    }
    Err(map_backend_issue(status, &body))
}

/// Case-insensitive literal replace, character by character rather than by byte length, because
/// `str::to_lowercase` can change a string's byte length for some Unicode and Windows account
/// names are not guaranteed ASCII. A no-op (returns `text` unchanged) when `needle` is empty, so
/// an unset user or machine name scrubs nothing instead of matching every position. A match may
/// have `\r` or `\n` spliced between two of the needle's characters — PowerShell wraps a
/// formatted error record at a fixed width once its output is redirected (which is how
/// `worker.log` is produced), so a long path can be split mid-name; the Privacy page's promise
/// has no exception for that, so the whole matched span, breaks included, is replaced.
fn replace_ci(text: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    let needle: Vec<char> = needle.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if let Some(end) = match_ci_allowing_line_breaks(&chars, i, &needle) {
            out.push_str(replacement);
            i = end;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Matches `needle` case-insensitively starting at `start`, letting a run of `\r`/`\n` — optionally
/// followed by a PowerShell continuation gutter — stand in between two already-matched needle
/// characters. Measured on Windows 2026-09-21: PowerShell 7 does not wrap at a fixed width (a
/// 327-character unwrapped line was observed); it wraps a ConciseView detail line only at a
/// space, prefixing the continuation with a gutter shaped like `"     | "`. An account name may
/// contain a space, which is exactly PowerShell's break point, so that break+gutter can stand in
/// for the needle's own space character — see the two branches below. A break is only ever
/// skipped *between* matched characters (`needle_i > 0`), never before the first one, so this
/// can't start a match on a break unrelated to the name, and a one-character needle — whose match
/// is already complete after that first character — never reaches the skip branch at all.
fn match_ci_allowing_line_breaks(chars: &[char], start: usize, needle: &[char]) -> Option<usize> {
    let mut needle_i = 0;
    let mut i = start;
    while needle_i < needle.len() {
        let c = *chars.get(i)?;
        if (c == '\r' || c == '\n') && needle_i > 0 {
            while matches!(chars.get(i), Some('\r') | Some('\n')) {
                i += 1;
            }
            // The gutter, exactly as observed: a run of spaces/tabs, then optionally one `|`
            // followed by another run of spaces/tabs. Nothing looser — this never fires except
            // right after a break we already decided to skip, so it cannot merge two unrelated
            // words that happen to share a line with some indentation.
            while matches!(chars.get(i), Some(' ') | Some('\t')) {
                i += 1;
            }
            if matches!(chars.get(i), Some('|')) {
                i += 1;
                while matches!(chars.get(i), Some(' ') | Some('\t')) {
                    i += 1;
                }
            }
            // If the needle expects a space right here, the wrap ate it — PowerShell only wraps
            // at a space, so the break+gutter we just consumed *is* that space, not an addition
            // to it; advance past the needle's space without expecting a literal one in the
            // haystack. Any other needle character still has to match literally after the gutter.
            if needle[needle_i] == ' ' {
                needle_i += 1;
            }
            continue;
        }
        if c.to_lowercase().eq(needle[needle_i].to_lowercase()) {
            i += 1;
            needle_i += 1;
        } else {
            return None;
        }
    }
    Some(i)
}

fn chars_eq_ci(a: &[char], b: &[char]) -> bool {
    a.iter().zip(b).all(|(x, y)| x.to_lowercase().eq(y.to_lowercase()))
}

fn is_path_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// Collapses a `Users` path segment's next component to `<user>`, wherever the segment starts:
/// the very beginning of the text, right after a path separator, or right after `:` (the
/// drive-letter case the brief names). Leaves everything else — including a component that is
/// not preceded by a `Users` segment, such as `SteamLibrary` — untouched.
fn collapse_users_folder(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < n {
        let at_boundary = i == 0 || is_path_sep(chars[i - 1]) || chars[i - 1] == ':';
        if at_boundary {
            // "Users" (case-insensitive) is Windows' actual on-disk profile-root folder name no
            // matter the display language — a Chinese or Japanese Windows install still has a
            // `C:\Users\<name>` path underneath its localized Explorer label. Matching this one
            // literal word is therefore not a localisation gap.
            if let Some(after_users) = match_ci_word(&chars, i, "users") {
                if after_users < n && is_path_sep(chars[after_users]) {
                    let comp_start = after_users + 1;
                    let mut comp_end = comp_start;
                    while comp_end < n && !is_path_sep(chars[comp_end]) {
                        comp_end += 1;
                    }
                    // A `<user>` or `<pc>` placeholder here is one the earlier literal passes
                    // already produced (the machine name pass runs before this one); relabeling
                    // it would misrepresent what was actually replaced, so it is left alone.
                    let component: String = chars[comp_start..comp_end].iter().collect();
                    let already_scrubbed = component == "<user>" || component == "<pc>";
                    if comp_end > comp_start && !already_scrubbed {
                        out.extend(&chars[i..after_users]);
                        out.push(chars[after_users]);
                        out.push_str("<user>");
                        i = comp_end;
                        continue;
                    }
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// Matches `word` case-insensitively at `start`, returning the index just past it.
fn match_ci_word(chars: &[char], start: usize, word: &str) -> Option<usize> {
    let word: Vec<char> = word.chars().collect();
    if start + word.len() > chars.len() {
        return None;
    }
    if chars_eq_ci(&chars[start..start + word.len()], &word) {
        Some(start + word.len())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn app_version() -> AppVersion {
        AppVersion { label: "0.1.3".into(), commit: "3ff5be8f6feace4407d898c62f090ee6e3ef0a90".into(), built: "2026-09-21 12:00:00 UTC".into() }
    }

    fn facts() -> Facts {
        Facts {
            windows: "10.0.22631".into(),
            display_language: "zh-CN".into(),
            powershell: Some("7.6.6".into()),
            version: app_version(),
            log_tail: Some("=== worker session 2026-09-21 12:00:00 UTC ===\nC:\\Users\\Player1\\AppData\\Local\\Aimloom\\logs\n".into()),
            user: "Player1".into(),
            machine: "DESKTOP-1".into(),
        }
    }

    fn input() -> ReportInput {
        ReportInput {
            description: Some("应用背景时报错".into()),
            contact: Some("someone@example.com".into()),
            attach_log: true,
            account: Some(Account { steam_id: "76561198000000042".into(), name: "PlayerOne".into() }),
            lang_choice: "system".into(),
            lang: "zh".into(),
            game_found: true,
        }
    }

    /// Every key set (at every level) of `prepare`'s JSON must match the App's contract fixture
    /// exactly — no more, no fewer — built from the fixture file itself, not hand-copied, so a
    /// drift in either place fails loudly instead of silently diverging.
    fn key_set(value: &serde_json::Value, path: &str, out: &mut Vec<String>) {
        if let serde_json::Value::Object(map) = value {
            for (k, v) in map {
                let full = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
                out.push(full.clone());
                key_set(v, &full, out);
            }
        }
    }

    #[test]
    fn the_payload_matches_the_contract_fixture_key_for_key() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/installer/report/contract.fixture.json")).unwrap();
        let mut expected = Vec::new();
        key_set(&fixture, "", &mut expected);
        expected.sort();

        let prepared = prepare(&input(), &facts()).unwrap();
        let produced: serde_json::Value = serde_json::from_str(&prepared.text).unwrap();
        let mut actual = Vec::new();
        key_set(&produced, "", &mut actual);
        actual.sort();

        assert_eq!(actual, expected);
    }

    #[test]
    fn every_optional_field_is_null_never_empty_string() {
        let mut i = input();
        i.description = Some("   ".into());
        i.contact = Some("".into());
        i.attach_log = false;
        i.account = None;
        let prepared = prepare(&i, &facts()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&prepared.text).unwrap();
        assert_eq!(v["description"], serde_json::Value::Null);
        assert_eq!(v["contact"], serde_json::Value::Null);
        assert_eq!(v["log"], serde_json::Value::Null);
        assert_eq!(v["account"], serde_json::Value::Null);
        // Never an empty string anywhere a value is optional.
        for key in ["description", "contact", "log", "account"] {
            assert_ne!(v[key], serde_json::Value::String(String::new()));
        }
    }

    #[test]
    fn a_description_of_exactly_the_cap_is_accepted_and_one_over_is_refused_before_any_network_call() {
        let mut i = input();
        i.description = Some("d".repeat(MAX_DESCRIPTION));
        assert!(prepare(&i, &facts()).is_ok());
        i.description = Some("d".repeat(MAX_DESCRIPTION + 1));
        let issue = prepare(&i, &facts()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::EngineError);
        assert!(!issue.message.is_empty() && !issue.message_en.is_empty());
    }

    #[test]
    fn a_contact_of_exactly_the_cap_is_accepted_and_one_over_is_refused() {
        let mut i = input();
        i.contact = Some("c".repeat(MAX_CONTACT));
        assert!(prepare(&i, &facts()).is_ok());
        i.contact = Some("c".repeat(MAX_CONTACT + 1));
        let issue = prepare(&i, &facts()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::EngineError);
    }

    /// The backend measures with JS `string.length` (UTF-16 code units). An astral character
    /// (outside the Basic Multilingual Plane, e.g. this emoji) is one Unicode scalar value but
    /// two UTF-16 units — `chars().count()` would undercount it and accept what the backend
    /// refuses, so this proves the cap is now measured the backend's way.
    #[test]
    fn a_description_of_astral_characters_is_capped_by_utf16_units_not_scalar_values() {
        let emoji = "\u{1F600}"; // one scalar value, two UTF-16 units
        let mut i = input();
        i.description = Some(emoji.repeat(1000)); // 1000 scalar values == 2000 UTF-16 units: exactly the cap
        assert_eq!(i.description.as_ref().unwrap().chars().count(), 1000);
        assert_eq!(utf16_len(i.description.as_ref().unwrap()), MAX_DESCRIPTION);
        assert!(prepare(&i, &facts()).is_ok(), "exactly the UTF-16 cap must be accepted");

        i.description = Some(emoji.repeat(1001)); // 2002 UTF-16 units: one astral character over
        assert_eq!(utf16_len(i.description.as_ref().unwrap()), MAX_DESCRIPTION + 2);
        let issue = prepare(&i, &facts()).unwrap_err();
        assert_eq!(issue.code, ErrorCode::EngineError, "chars().count() alone would have called this fine");
    }

    #[test]
    fn account_name_must_be_non_empty_and_within_the_utf16_cap() {
        let mut i = input();
        i.account = Some(Account { steam_id: "76561198000000042".into(), name: "".into() });
        assert_eq!(prepare(&i, &facts()).unwrap_err().code, ErrorCode::EngineError);

        i.account = Some(Account { steam_id: "76561198000000042".into(), name: "n".repeat(MAX_NAME) });
        assert!(prepare(&i, &facts()).is_ok());

        i.account = Some(Account { steam_id: "76561198000000042".into(), name: "n".repeat(MAX_NAME + 1) });
        assert_eq!(prepare(&i, &facts()).unwrap_err().code, ErrorCode::EngineError);
    }

    #[test]
    fn account_steam_id_must_be_exactly_17_digits() {
        let mut i = input();
        for bad in ["7656119918144833", "765611980000000429", "7656119918144833x", "", "7656119918144833 "] {
            i.account = Some(Account { steam_id: bad.into(), name: "ok".into() });
            let issue = prepare(&i, &facts()).unwrap_err();
            assert_eq!(issue.code, ErrorCode::EngineError, "{bad:?} should have been refused");
        }
        i.account = Some(Account { steam_id: "76561198000000042".into(), name: "ok".into() });
        assert!(prepare(&i, &facts()).is_ok());
    }

    #[test]
    fn the_log_is_absent_when_attach_log_is_false_or_no_log_exists() {
        let mut i = input();
        i.attach_log = false;
        let v: serde_json::Value = serde_json::from_str(&prepare(&i, &facts()).unwrap().text).unwrap();
        assert_eq!(v["log"], serde_json::Value::Null);

        i.attach_log = true;
        let mut f = facts();
        f.log_tail = None;
        let v: serde_json::Value = serde_json::from_str(&prepare(&i, &f).unwrap().text).unwrap();
        assert_eq!(v["log"], serde_json::Value::Null);
    }

    #[test]
    fn a_512_kib_log_stays_under_the_whole_payload_cap_even_at_maximum_description_and_contact() {
        let mut i = input();
        i.description = Some("d".repeat(MAX_DESCRIPTION));
        i.contact = Some("c".repeat(MAX_CONTACT));
        let mut f = facts();
        // Longer than the cap even before scrub, and scrub only ever adds bytes.
        let mut long = "line without any user or machine name filler text here\n".repeat(20000);
        long.push_str("tail\n");
        f.log_tail = Some(long);
        let prepared = prepare(&i, &f).unwrap();
        assert!(prepared.bytes < 1024 * 1024, "payload was {} bytes", prepared.bytes);
        let v: serde_json::Value = serde_json::from_str(&prepared.text).unwrap();
        let log = v["log"].as_str().unwrap();
        assert!(log.len() <= MAX_LOG_BYTES, "log was {} bytes", log.len());
    }

    /// A real Windows/PowerShell log is backslash-dense (paths) and can carry quotes (a quoted
    /// path in an error record); JSON escaping turns each of those one raw byte into two output
    /// bytes. This is the worst case the reviewer asked for, not the friendlier filler text of
    /// the test above, and it is what actually stresses `build_log`'s escape-aware budget.
    #[test]
    fn a_worst_case_backslash_and_quote_log_at_maximum_description_and_contact_still_fits_under_1_mib() {
        let mut i = input();
        i.description = Some("d".repeat(MAX_DESCRIPTION));
        i.contact = Some("c".repeat(MAX_CONTACT));
        let mut f = facts();
        let mut long = String::with_capacity(2 * MAX_LOG_BYTES);
        while long.len() < 2 * MAX_LOG_BYTES {
            long.push_str(r#"C:\Users\Player1\"AppData"\Local\Aimloom\logs\worker.log\"#);
            long.push('\n');
        }
        f.log_tail = Some(long);
        let prepared = prepare(&i, &f).unwrap();
        assert!(prepared.bytes < 1024 * 1024, "worst-case payload was {} bytes, not under 1 MiB", prepared.bytes);
    }

    /// The pathological case: a log that is *nothing but* backslashes, where JSON escaping
    /// doubles every single byte. `MAX_LOG_BYTES` (512 KiB) raw would escape to ~1 MiB on its
    /// own, before `description`/`contact`/`account` are even counted — this is what actually
    /// forces `build_log`'s halving loop to shrink the raw window below the backend's own cap,
    /// proving the escape-aware budget is load-bearing and not just coincidentally unused.
    #[test]
    fn a_log_of_nothing_but_backslashes_is_shrunk_below_the_raw_cap_to_stay_under_1_mib() {
        let mut i = input();
        i.description = Some("d".repeat(MAX_DESCRIPTION));
        i.contact = Some("c".repeat(MAX_CONTACT));
        let mut f = facts();
        f.log_tail = Some(r"\".repeat(2 * MAX_LOG_BYTES));
        let prepared = prepare(&i, &f).unwrap();
        assert!(prepared.bytes < 1024 * 1024, "payload was {} bytes, not under 1 MiB", prepared.bytes);
        let v: serde_json::Value = serde_json::from_str(&prepared.text).unwrap();
        let log = v["log"].as_str().unwrap();
        // Every byte is a backslash, so raw length is the same as UTF-8 byte length; this must
        // be well below MAX_LOG_BYTES, since at MAX_LOG_BYTES it alone would escape to ~1 MiB.
        assert!(log.len() < MAX_LOG_BYTES, "log was {} raw bytes, the halving loop should have shrunk it", log.len());
    }

    #[test]
    fn a_log_over_the_cap_after_scrubbing_is_trimmed_not_refused() {
        // Chosen so the raw tail is already over the cap, and scrubbing (Player1 replaced by
        // the longer `<user>` placeholder) only makes it longer, not shorter.
        let mut i = input();
        let mut f = facts();
        let mut long = "line for C:\\Users\\Player1\\AppData on DESKTOP-1, some filler text\n".repeat(8100);
        long.push_str("the very last line\n");
        assert!(long.len() > MAX_LOG_BYTES);
        f.log_tail = Some(long);
        i.attach_log = true;
        let prepared = prepare(&i, &f).unwrap();
        let v: serde_json::Value = serde_json::from_str(&prepared.text).unwrap();
        let log = v["log"].as_str().unwrap();
        assert!(log.len() <= MAX_LOG_BYTES);
        assert!(log.ends_with("the very last line\n"));
        assert!(!log.contains("Player1") && !log.contains("DESKTOP-1"), "the names must still be scrubbed after trimming");
    }

    #[test]
    fn account_verified_is_always_false_whatever_the_caller_passes() {
        let prepared = prepare(&input(), &facts()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&prepared.text).unwrap();
        assert_eq!(v["account"]["verified"], serde_json::Value::Bool(false));
    }

    #[test]
    fn the_same_input_twice_gives_the_same_hash_and_a_changed_description_gives_a_different_one() {
        let a = prepare(&input(), &facts()).unwrap();
        let b = prepare(&input(), &facts()).unwrap();
        assert_eq!(a.sha256, b.sha256);
        assert_eq!(a.text, b.text);

        let mut changed = input();
        changed.description = Some("应用背景时报错!".into()); // one character different
        let c = prepare(&changed, &facts()).unwrap();
        assert_ne!(a.sha256, c.sha256);
    }

    fn serve_json(status: u16, body: &'static str) -> (Http, std::sync::mpsc::Receiver<String>) {
        use std::io::{BufRead, BufReader, Read};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
                head.push_str(&line);
            }
            // Every test using this helper sends a POST body (the prepared report). Draining it
            // before responding and letting the thread (and so the stream) end avoids a real,
            // observed flake: closing a socket with unread inbound bytes still sitting in the
            // kernel's receive buffer can make the OS send RST instead of a clean FIN, which the
            // client can then read as a connection failure instead of the response that was
            // actually written — a race, not a logic bug in `Http` or `send`.
            let mut discard = vec![0u8; content_length];
            let _ = reader.read_exact(&mut discard);
            let out = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(out.as_bytes()).unwrap();
            let _ = tx.send(head);
        });
        (Http::with_base(&format!("http://{addr}")), rx)
    }

    #[test]
    fn send_transmits_the_kept_bytes_and_returns_the_report_number_on_success() {
        let (http, _rx) = serve_json(200, r#"{"number":"AL-260921-0001"}"#);
        let prepared = prepare(&input(), &facts()).unwrap();
        let number = send(&http, &prepared).unwrap();
        assert_eq!(number, "AL-260921-0001");
    }

    #[test]
    fn every_backend_code_maps_to_its_own_bilingual_issue_and_never_leaks_the_body_url_or_a_path() {
        let cases: &[(u16, &str, ErrorCode)] = &[
            (429, r#"{"code":"RATE_LIMITED"}"#, ErrorCode::WorkerUnavailable),
            (429, r#"{"code":"DAILY_LIMIT"}"#, ErrorCode::WorkerUnavailable),
            (507, r#"{"code":"STORAGE_FULL"}"#, ErrorCode::WorkerUnavailable),
            (413, r#"{"code":"TOO_LARGE"}"#, ErrorCode::EngineError),
            (400, r#"{"code":"INVALID_REPORT","field":"description"}"#, ErrorCode::EngineError),
            (400, r#"{"code":"UNKNOWN_CLIENT"}"#, ErrorCode::EngineError),
        ];
        // DAILY_LIMIT and STORAGE_FULL deliberately share one message (the brief's own wording
        // groups them: "the service is full today — write to feedback@aimloom.dev"); every other
        // code gets a message none of the others share.
        let mut seen = std::collections::HashSet::new();
        for (status, body, code) in cases {
            let (http, _rx) = serve_json(*status, body);
            let prepared = prepare(&input(), &facts()).unwrap();
            let issue = send(&http, &prepared).unwrap_err();
            assert_eq!(&issue.code, code, "{body}");
            assert!(!issue.message.is_empty() && !issue.message_en.is_empty());
            assert!(super::super::protocol::is_english(&issue.message_en), "{body} -> {:?}", issue.message_en);
            assert!(!issue.message_en.contains("https://") && !issue.message_en.contains("C:\\"), "{body} leaked transport detail");
            if !body.contains("DAILY_LIMIT") && !body.contains("STORAGE_FULL") {
                assert!(seen.insert(issue.message_en.clone()), "duplicate message for {body}");
            }
        }
        // A transport failure (nothing answers) is also its own distinct Issue.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        let http = Http::with_base(&format!("http://{addr}"));
        let prepared = prepare(&input(), &facts()).unwrap();
        let issue = send(&http, &prepared).unwrap_err();
        assert!(seen.insert(issue.message_en.clone()), "transport failure must not collide with a backend code's message");
    }

    #[test]
    fn the_invalid_report_message_names_the_field_without_repeating_a_raw_path() {
        let (http, _rx) = serve_json(400, r#"{"code":"INVALID_REPORT","field":"log"}"#);
        let prepared = prepare(&input(), &facts()).unwrap();
        let issue = send(&http, &prepared).unwrap_err();
        assert!(issue.message_en.contains("\"log\""));
    }

    #[test]
    fn send_refuses_a_prepared_it_did_not_build() {
        let (http, _rx) = serve_json(200, r#"{"number":"AL-260921-0001"}"#);
        let hand_made = Prepared { text: r#"{"description":"hi"}"#.into(), sha256: "not-a-real-hash".into(), bytes: 21 };
        let issue = send(&http, &hand_made).unwrap_err();
        assert_eq!(issue.code, ErrorCode::PlanStale);
    }

    #[test]
    fn send_refuses_a_prepared_whose_hash_was_altered() {
        let (http, _rx) = serve_json(200, r#"{"number":"AL-260921-0001"}"#);
        let mut prepared = prepare(&input(), &facts()).unwrap();
        prepared.sha256.push('0');
        let issue = send(&http, &prepared).unwrap_err();
        assert_eq!(issue.code, ErrorCode::PlanStale);
    }

    #[test]
    fn the_windows_user_name_goes_everywhere_it_appears() {
        let out = scrub(r"C:\Users\Player1\AppData; hello PLAYER1 and player1", "Player1", "DESKTOP-1");
        assert_eq!(out, r"C:\Users\<user>\AppData; hello <user> and <user>");
    }

    #[test]
    fn any_drive_letter_is_covered_even_for_another_user() {
        assert_eq!(scrub(r"D:\Users\SomeoneElse\x", "Player1", "PC"), r"D:\Users\<user>\x");
    }

    #[test]
    fn the_machine_name_goes() {
        assert_eq!(scrub("on DESKTOP-1 now", "u", "DESKTOP-1"), "on <pc> now");
    }

    #[test]
    fn a_steam_library_path_survives_because_support_needs_it() {
        let p = r"D:\SteamLibrary\steamapps\common\FPSAimTrainer";
        assert_eq!(scrub(p, "Player1", "DESKTOP-1"), p);
    }

    #[test]
    fn a_chinese_log_line_is_untouched() {
        assert_eq!(scrub("应用背景失败：主题缺少天花板设置。", "u", "PC"), "应用背景失败：主题缺少天花板设置。");
    }

    #[test]
    fn an_empty_user_name_scrubs_nothing() {
        assert_eq!(scrub("anything", "", ""), "anything");
    }

    #[test]
    fn the_tail_is_the_end_of_the_file_cut_at_a_line_start() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tail.log");
        fs::write(&path, "AAAAA\nBBBBB\nCCCCC\n").unwrap();
        // 18 bytes total; ask for the last 10 -> raw cut lands inside "BBBBB\n", so the real
        // start is right after that line's own newline: just "CCCCC\n".
        let out = log_tail(&path, 10).unwrap();
        assert_eq!(out, "CCCCC\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_bytes_do_not_break_the_tail() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-gbk-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gbk.log");
        let mut f = fs::File::create(&path).unwrap();
        // A GBK-encoded line (not valid UTF-8) followed by a plain ASCII line.
        f.write_all(&[0xC4, 0xE3, 0xBA, 0xC3, b'\n']).unwrap();
        f.write_all(b"ok\n").unwrap();
        drop(f);
        let out = log_tail(&path, 1000).unwrap();
        assert!(out.contains('\u{FFFD}'));
        assert!(out.ends_with("ok\n"));
        let _ = fs::remove_dir_all(&dir);
    }

    // --- adversarial cases beyond the brief ---

    #[test]
    fn a_user_name_that_is_a_substring_of_another_word_only_replaces_the_match() {
        assert_eq!(scrub("Perry and Perrybuilt", "Per", "PC"), "<user>ry and <user>rybuilt");
    }

    #[test]
    fn regex_and_path_special_characters_in_a_name_are_treated_as_literal() {
        assert_eq!(scrub("user a.b here", "a.b", "PC"), "user <user> here");
        assert_eq!(scrub("user a+b here", "a+b", "PC"), "user <user> here");
        assert_eq!(scrub(r"path C:\x here", r"C:\x", "PC"), "path <user> here");
    }

    #[test]
    fn an_empty_machine_name_scrubs_nothing_but_user_still_does() {
        assert_eq!(scrub("u and PC", "u", ""), "<user> and PC");
    }

    #[test]
    fn a_one_character_name_matches_every_occurrence() {
        assert_eq!(scrub("a bab a", "a", "PC"), "<user> b<user>b <user>");
    }

    #[test]
    fn a_name_longer_than_the_text_matches_nothing() {
        assert_eq!(scrub("hi", "a very long user name", "PC"), "hi");
    }

    #[test]
    fn different_cases_of_the_same_name_all_go_within_one_line() {
        assert_eq!(scrub("Player1 PLAYER1 player1 PlaYER1", "Player1", "PC"), "<user> <user> <user> <user>");
    }

    #[test]
    fn forward_slash_windows_paths_are_covered_too() {
        assert_eq!(scrub("C:/Users/Name/x", "nobody", "PC"), "C:/Users/<user>/x");
    }

    #[test]
    fn a_unc_path_is_covered_even_without_a_drive_letter() {
        assert_eq!(scrub(r"\\SERVER\Users\Name\x", "nobody", "PC"), r"\\SERVER\Users\<user>\x");
    }

    #[test]
    fn a_name_that_is_only_part_of_a_users_folder_segment_is_fully_collapsed() {
        // The whole segment is anonymized, not just the substring that matched literally —
        // otherwise "Player1Backup" would leak as "<user>Backup", which still singles out
        // one machine's folder even though the literal user name itself is gone.
        assert_eq!(scrub(r"C:\Users\Player1Backup\x", "Player1", "PC"), r"C:\Users\<user>\x");
    }

    #[test]
    fn log_tail_shorter_than_max_bytes_returns_the_whole_file() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-short-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("short.log");
        fs::write(&path, "one\ntwo\n").unwrap();
        assert_eq!(log_tail(&path, 1000).unwrap(), "one\ntwo\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_exactly_max_bytes_returns_the_whole_file() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-exact-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("exact.log");
        let content = "12345678";
        fs::write(&path, content).unwrap();
        assert_eq!(log_tail(&path, content.len()).unwrap(), content);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_broken_across_a_wrapped_line_is_still_scrubbed() {
        // PowerShell wraps formatted error records when its output is redirected, so a long path
        // can be split mid-name. The promise on the Privacy page has no exception for that.
        assert_eq!(scrub("at C:\\Users\\Play\ner1\\AppData", "Player1", "PC"), "at C:\\Users\\<user>\\AppData");
        assert_eq!(scrub("at C:\\Users\\Play\r\ner1\\AppData", "Player1", "PC"), "at C:\\Users\\<user>\\AppData");
        assert_eq!(scrub("host DESK\nTOP-1 said", "u", "DESKTOP-1"), "host <pc> said");
    }

    #[test]
    fn a_line_break_that_is_not_inside_a_name_survives() {
        assert_eq!(scrub("first line\nsecond line", "Player1", "PC"), "first line\nsecond line");
        assert_eq!(scrub("Player1\nPlayer1", "Player1", "PC"), "<user>\n<user>");
    }

    #[test]
    fn a_one_character_name_does_not_treat_a_line_break_as_part_of_a_match() {
        // A single-character needle finishes matching before the cross-break skip logic could
        // ever run (there is no "next needle character" left to look for past a break), so it
        // can never swallow an entire line the way a multi-character name legitimately can when
        // split by a wrap. Only the literal "A" goes; the newline and "B" are untouched.
        assert_eq!(scrub("A\nB", "A", "PC"), "<user>\nB");
    }

    #[test]
    fn an_already_replaced_pc_token_inside_a_users_segment_is_left_alone() {
        // The machine-name pass runs before the path pass, so "DESKTOP-1" under `Users\` is
        // already `<pc>` by the time the path pass looks at it; the path pass must not then
        // relabel that token as `<user>`, which would misrepresent what was actually replaced.
        assert_eq!(scrub(r"C:\Users\DESKTOP-1\x", "nobody", "DESKTOP-1"), r"C:\Users\<pc>\x");
    }

    #[test]
    fn a_name_wrapped_at_its_own_space_by_powershell_is_still_scrubbed() {
        // Measured on Windows 2026-09-21: PowerShell 7 wraps a ConciseView detail line ONLY at a
        // space, and prefixes the continuation with a gutter like "     | ". An account name may
        // contain a space, which is exactly where it breaks.
        let wrapped = "     | 找不到路径 C:\\Users\\John\n     | Smith\\AppData\\Local";
        assert_eq!(scrub(wrapped, "John Smith", "PC"), "     | 找不到路径 C:\\Users\\<user>\\AppData\\Local");
        assert_eq!(scrub("host DESK\n     | TOP-1 said", "u", "DESK TOP-1"), "host <pc> said");
    }

    #[test]
    fn a_gutter_that_is_not_inside_a_name_survives() {
        let text = "     | first\n     | second";
        assert_eq!(scrub(text, "John Smith", "PC"), text);
    }

    #[test]
    fn a_space_inside_a_name_still_matches_without_any_wrap() {
        assert_eq!(scrub("C:\\Users\\John Smith\\x", "John Smith", "PC"), "C:\\Users\\<user>\\x");
    }

    #[test]
    fn two_unrelated_words_on_one_line_are_not_joined_into_a_match() {
        // Guards against over-widening the gutter/space tolerance into "skip any whitespace
        // anywhere mid-match": a name with no space must not match two separate words that
        // merely happen to be separated by a space on the SAME line (no break involved at all).
        assert_eq!(scrub("A B", "AB", "PC"), "A B");
    }

    #[test]
    fn scrubbing_a_large_log_completes_quickly() {
        let mut text = String::with_capacity(512 * 1024);
        while text.len() < 512 * 1024 {
            text.push_str("line with C:\\Users\\Player1\\AppData and DESKTOP-1 and some filler text\n");
        }
        let started = std::time::Instant::now();
        let out = scrub(&text, "Player1", "DESKTOP-1");
        let elapsed = started.elapsed();
        assert!(!out.contains("Player1"));
        assert!(!out.contains("DESKTOP-1"));
        assert!(elapsed.as_secs() < 2, "scrub of 512 KiB took {:?}, too slow", elapsed);
    }

    #[test]
    fn log_tail_on_an_empty_file_is_some_empty_string() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-empty-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("empty.log");
        fs::write(&path, "").unwrap();
        assert_eq!(log_tail(&path, 100).unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_on_a_missing_file_is_none() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-missing-{}", std::process::id()));
        let path = dir.join("nope.log");
        assert_eq!(log_tail(&path, 100), None);
    }

    #[test]
    fn log_tail_with_no_trailing_newline_on_the_last_line_still_reads_it() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-noeol-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("noeol.log");
        fs::write(&path, "first\nsecond-no-newline").unwrap();
        assert_eq!(log_tail(&path, 6).unwrap(), "ewline");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unpaired_surrogate_style_byte_sequence_does_not_panic() {
        let dir = std::env::temp_dir().join(format!("kvk-report-test-surrogate-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("surrogate.log");
        // CESU-8 style encoding of an unpaired surrogate: invalid in strict UTF-8.
        fs::write(&path, [0xEDu8, 0xA0, 0x80, b'\n', b'o', b'k']).unwrap();
        let out = log_tail(&path, 100).unwrap();
        assert!(out.contains('\u{FFFD}'));
        assert!(out.ends_with("ok"));
        let _ = fs::remove_dir_all(&dir);
    }
}
