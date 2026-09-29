//! Test-only helpers shared by the unit tests of several modules.
use std::io::Write;

use super::net::Http;

/// A one-shot local HTTP server answering `status` with the JSON `body`. The receiver yields the
/// request line and headers it saw.
pub(super) fn serve_json(status: u16, body: &'static str) -> (Http, std::sync::mpsc::Receiver<String>) {
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
