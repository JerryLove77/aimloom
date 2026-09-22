pub mod installer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    installer::run();
}
