pub mod account;
pub mod commands;
pub mod dialogs;
pub mod engine_choice;
pub mod jobs;
pub mod net;
pub mod protocol;
pub mod profiles;
pub mod report;
pub mod reporting;
pub mod shell;
pub mod update;
pub mod version;
pub mod worker;
#[cfg(test)]
mod test_support;

pub fn run() {
    #[cfg(target_os = "windows")]
    commands::run();
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("The installer app targets Windows only. Use the browser preview for development on this platform.");
        std::process::exit(2);
    }
}
