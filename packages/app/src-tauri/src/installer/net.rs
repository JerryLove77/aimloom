//! The App's only network client: one origin, hard caps, no redirects. Every caller (report
//! send, Steam resolve, `latest.json`) goes through `Http`; nothing else in the native layer
//! opens a socket. The WebView cannot reach the network at all (see the CSP) — this is the
//! whole story of how bytes leave the machine.

use std::io::Read;
use std::time::Duration;

use super::protocol::{ErrorCode, Issue};
use super::version::label_for_user_agent;

/// The one host the App is allowed to talk to. Never taken from the UI or from user input.
pub const ORIGIN: &str = "https://aimloom.dev";
/// The three paths the App calls. They are constants, and `tests/installer/report/
/// backend-paths.test.ts` checks each against the Worker deployed from this repository, because
/// the first real report went to a path that did not exist and nothing had compared the two.
pub const REPORTS_PATH: &str = "/api/reports";
pub const STEAM_RESOLVE_PATH: &str = "/api/steam/resolve";
pub const LATEST_PATH: &str = "/latest.json";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const READ_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

pub struct Http {
    agent: ureq::Agent,
    base: String,
}

impl Http {
    pub fn new() -> Http {
        Http::build(ORIGIN.to_string())
    }

    /// The same client as `new()`, pointed at a test server. The only way a test may reach
    /// another host: outside `cfg(test)` the origin is the constant and nothing can change it.
    #[cfg(test)]
    pub fn with_base(base: &str) -> Http {
        Http::build(base.to_string())
    }

    /// The one place the agent is configured — `new()` and `with_base()` both call this, so the
    /// timeouts, caps, redirect policy and proxy wiring can never drift between the production
    /// client and the one the tests drive.
    fn build(base: String) -> Http {
        let mut config = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_recv_response(Some(READ_TIMEOUT))
            .timeout_recv_body(Some(READ_TIMEOUT))
            .max_redirects(0)
            .http_status_as_error(false)
            .user_agent(label_for_user_agent());
        if let Some(server) = proxy_from_windows() {
            if let Ok(proxy) = ureq::Proxy::new(&proxy_uri(&server)) {
                config = config.proxy(Some(proxy));
            }
        }
        Http { agent: config.build().into(), base }
    }

    pub fn post_json(&self, path: &str, body: &str) -> Result<(u16, String), Issue> {
        let url = self.url(path)?;
        if body.len() > MAX_REQUEST_BYTES {
            return Err(Issue::new(
                ErrorCode::EngineError,
                "请求体超过了 1 MiB 的上限。",
                "The request body exceeds the 1 MiB cap.",
            ));
        }
        let response = self
            .agent
            .post(url)
            .header("content-type", "application/json")
            .send(body.as_bytes())
            .map_err(unreachable_issue)?;
        Ok(read_capped(response))
    }

    pub fn get(&self, path: &str) -> Result<(u16, String), Issue> {
        let url = self.url(path)?;
        let response = self.agent.get(url).call().map_err(unreachable_issue)?;
        Ok(read_capped(response))
    }

    fn url(&self, path: &str) -> Result<String, Issue> {
        if !path.starts_with('/') {
            return Err(Issue::new(
                ErrorCode::EngineError,
                "内部错误：请求路径必须是绝对路径。",
                "Internal error: the request path must be absolute.",
            ));
        }
        Ok(format!("{}{path}", self.base))
    }
}

impl Default for Http {
    fn default() -> Self {
        Http::new()
    }
}

/// Reads at most `MAX_RESPONSE_BYTES` of the body — a larger answer is cut, not buffered in
/// full and then discarded. Never treated as an error: the caller gets what fit.
fn read_capped(mut response: ureq::http::Response<ureq::Body>) -> (u16, String) {
    let status = response.status().as_u16();
    let mut buf = Vec::new();
    let _ = response.body_mut().as_reader().take(MAX_RESPONSE_BYTES as u64).read_to_end(&mut buf);
    (status, String::from_utf8_lossy(&buf).into_owned())
}

/// Every connection/protocol failure collapses to one player-facing message: no upstream body,
/// URL or path detail leaks into it.
fn unreachable_issue(_error: ureq::Error) -> Issue {
    Issue::new(
        ErrorCode::WorkerUnavailable,
        "无法连接 aimloom.dev。请检查网络后重试。",
        "Could not reach aimloom.dev. Check your connection and try again.",
    )
}

/// `ProxyServer` from the registry is host:port (or a per-protocol list); a bare host:port is
/// not a URI `Proxy::new` accepts, so this adds a scheme when one isn't already present.
fn proxy_uri(server: &str) -> String {
    if server.contains("://") {
        server.to_string()
    } else {
        format!("http://{server}")
    }
}

/// Reads the current user's Internet Settings from the registry: `Some(server)` only when
/// `ProxyEnable` is 1 and `ProxyServer` is non-empty. `None` on any other platform, and `None`
/// on any read failure — an unreadable setting is treated as "no proxy", never as an error.
#[cfg(target_os = "windows")]
pub fn proxy_from_windows() -> Option<String> {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    let enabled = std::process::Command::new("reg")
        .args(["query", key, "/v", "ProxyEnable"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("0x1"))
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    std::process::Command::new("reg")
        .args(["query", key, "/v", "ProxyServer"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .find_map(|line| line.trim().strip_prefix("ProxyServer").map(str::to_string))
                .and_then(|rest| rest.rsplit(' ').next().map(str::trim).map(str::to_string))
        })
        .filter(|s| !s.is_empty())
}

#[cfg(not(target_os = "windows"))]
pub fn proxy_from_windows() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread;

    /// Spawns a server that answers exactly one connection, and returns the base URL and the
    /// request line + headers it received (for assertions), via the returned receiver.
    fn serve_once(
        respond: impl FnOnce(&str) -> Vec<u8> + Send + 'static,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request_head = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                request_head.push_str(&line);
            }
            let out = respond(&request_head);
            stream.write_all(&out).unwrap();
            let _ = tx.send(request_head);
        });
        (format!("http://{addr}"), rx)
    }

    #[test]
    fn the_origin_is_compiled_in_and_is_the_site() {
        assert_eq!(ORIGIN, "https://aimloom.dev");
        assert!(ORIGIN.starts_with("https://"));
    }

    #[test]
    fn a_path_must_be_absolute() {
        let http = Http::new();
        let issue = http.get("latest.json").unwrap_err();
        assert_eq!(issue.code, ErrorCode::EngineError);
    }

    #[test]
    fn a_body_over_the_request_cap_is_refused_before_any_connection() {
        // Bind but never accept: a connection attempt would hang out the connect timeout.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let http = Http::with_base(&format!("http://{addr}"));
        let big = "x".repeat(MAX_REQUEST_BYTES + 1);
        // The cap check must fire without ever dialing out, so a fast failure (not an 8s
        // connect-timeout wait) proves it never attempted to connect.
        let started = std::time::Instant::now();
        let issue = http.post_json("/report", &big).unwrap_err();
        assert_eq!(issue.code, ErrorCode::EngineError);
        assert!(started.elapsed() < Duration::from_secs(1), "must fail before attempting to connect");
        drop(listener);
    }

    #[test]
    fn an_answer_over_the_response_cap_is_cut_not_buffered() {
        let big = vec![b'a'; MAX_RESPONSE_BYTES * 2];
        let (base, _rx) = serve_once(move |_req| {
            let mut out = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", big.len()).into_bytes();
            out.extend_from_slice(&big);
            out
        });
        let http = Http::with_base(&base);
        let (status, body) = http.get("/x").unwrap();
        assert_eq!(status, 200);
        assert!(body.len() <= MAX_RESPONSE_BYTES, "got {} bytes", body.len());
    }

    #[test]
    fn a_redirect_is_not_followed() {
        let (base, _rx) = serve_once(|_req| {
            b"HTTP/1.1 302 Found\r\nlocation: http://example.invalid/elsewhere\r\ncontent-length: 0\r\n\r\n".to_vec()
        });
        let http = Http::with_base(&base);
        let (status, _body) = http.get("/x").unwrap();
        assert_eq!(status, 302, "the redirect status must come back, not be chased");
    }

    #[test]
    fn the_user_agent_names_the_app_and_its_version() {
        let (base, rx) = serve_once(|_req| b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n".to_vec());
        let http = Http::with_base(&base);
        let _ = http.get("/x").unwrap();
        let head = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let expected = format!("user-agent: {}", label_for_user_agent());
        assert!(
            head.to_lowercase().contains(&expected.to_lowercase()),
            "expected {expected:?} in request head:\n{head}"
        );
    }
}
