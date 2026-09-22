pub mod commands;
pub mod jobs;
pub mod net;
pub mod protocol;
pub mod profiles;
pub mod report;
pub mod version;
pub mod worker;

pub fn run() {
    #[cfg(target_os = "windows")]
    commands::run();
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("The installer app targets Windows only. Use the browser preview for development on this platform.");
        std::process::exit(2);
    }
}
