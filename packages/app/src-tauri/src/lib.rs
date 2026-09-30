pub mod engine;
pub mod installer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `Aimloom.exe --worker` is the Rust engine's worker, started by the App itself; it never
    // opens a window.
    if std::env::args_os().nth(1).is_some_and(|arg| arg == installer::worker::RUST_WORKER_FLAG) {
        std::process::exit(engine::run_worker());
    }
    installer::run();
}
