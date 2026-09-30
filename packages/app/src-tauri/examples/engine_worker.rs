//! The Rust engine as a JSONL worker, for the cross-engine tests
//! (`scripts/installer/tests/parity/cross.test.ps1`). Not part of the App: `tauri build` and
//! `build-exe.ps1` never build examples.
//!
//! `engine_worker --local-data-root <dir> --runtime-root <dir>`. Two test settings come from the
//! environment: `KVK_TEST_PROCESSES` (comma-separated process names to report instead of the
//! machine's) and `KVK_TEST_RUNNING_FROM` (the game appears from that process listing on).

use std::cell::Cell;
use std::io::{self, BufReader};

use app_lib::engine::session::{run_jsonl, Session};
use app_lib::engine::store::{Host, SystemHost};

struct TestHost { listings: Cell<usize>, running_from: Option<usize>, processes: Option<Vec<String>> }

impl Host for TestHost {
    fn process_names(&self) -> io::Result<Vec<String>> {
        let n = self.listings.get() + 1;
        self.listings.set(n);
        if self.running_from.is_some_and(|from| n >= from) { return Ok(vec!["FPSAimTrainer".to_string()]); }
        match &self.processes { Some(names) => Ok(names.clone()), None => SystemHost.process_names() }
    }
}

fn argument(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let (Some(local), Some(runtime)) = (argument("--local-data-root"), argument("--runtime-root")) else {
        eprintln!("usage: engine_worker --local-data-root <dir> --runtime-root <dir>");
        std::process::exit(2);
    };
    let host = TestHost {
        listings: Cell::new(0),
        running_from: std::env::var("KVK_TEST_RUNNING_FROM").ok().and_then(|v| v.parse().ok()),
        processes: std::env::var("KVK_TEST_PROCESSES").ok().map(|v| v.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect()),
    };
    let mut session = match Session::new(Box::new(host), &local, &runtime) {
        Ok(session) => session,
        Err(error) => { eprintln!("{}", error.message); std::process::exit(2); }
    };
    let stdin = io::stdin();
    if let Err(error) = run_jsonl(&mut session, BufReader::new(stdin.lock()), io::stdout().lock()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
