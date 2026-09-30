//! The engine in Rust (ENGINE-RUST, ROADMAP). It is a second implementation of
//! `scripts/installer/kvk-engine.ps1` and its section adapters, speaking the same v=1 worker
//! protocol, and it is held to the PowerShell engine by goldens that PowerShell regenerates
//! (`scripts/installer/tests/parity/`). The App does not start it yet: `WorkerConfig` still
//! runs the PowerShell worker.
//!
//! Every file write in this module goes through the same plan, backup and verification steps
//! as the PowerShell engine, and reads and writes the same data folder, so either engine can
//! pick up what the other left.

pub mod discover;
pub mod enemy;
pub mod files;
pub mod json;
pub mod lists;
pub mod manifest;
pub mod paths;
pub mod platform;
pub mod profiles;
pub mod session;
pub mod settings;
pub mod store;
pub mod text;
pub mod txn;

use crate::installer::protocol::is_english;

/// A failure as the PowerShell engine raises it: `Throw-KvkFailure` sets a code and both
/// languages; a plain `throw "..."` has neither, and the service maps it by operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineError {
    /// `ENGINE_ERROR` unless the thrower classified the failure (`KvkCode`).
    pub code: String,
    /// True when the thrower set a code (`$Exception.Data.Contains('KvkCode')`).
    pub classified: bool,
    pub message: String,
    /// The `KvkMessageEn`, when the thrower gave one.
    pub message_en: String,
    pub english_given: bool,
    pub path: Option<String>,
}

impl EngineError {
    /// `Throw-KvkFailure` / `Throw-KvkGuiIssue`.
    pub fn coded(code: &str, zh: impl Into<String>, en: impl Into<String>) -> Self {
        Self { code: code.to_string(), classified: true, message: zh.into(), message_en: en.into(), english_given: true, path: None }
    }

    /// A plain `throw "..."`: no code and no separate English.
    pub fn plain(message: impl Into<String>) -> Self {
        let message = message.into();
        Self { code: "ENGINE_ERROR".to_string(), classified: false, message_en: message.clone(), message, english_given: false, path: None }
    }

    /// A .NET exception's own text (an I/O failure). Treated as a plain throw; its wording is
    /// the operating system's, so parity compares only the code (parity/DIVERGENCES.md).
    pub fn io(error: &std::io::Error) -> Self { Self::plain(error.to_string()) }

    /// `Get-KvkErrorEnglish`.
    pub fn english(&self) -> String {
        english_text(&self.message, if self.english_given { Some(&self.message_en) } else { None })
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.message) }
}

pub type EngineResult<T> = Result<T, EngineError>;

/// The fixed English line for a message the engine could not word in English.
pub const UNTRANSLATED: &str = "The engine reported an error. Details are in worker.log; send a report from Settings, or write to feedback@aimloom.dev.";

/// `Get-KvkEnglishText`: the given English when it is English-safe, else the message itself
/// when it is, else the fixed line (the original text then goes to stderr, i.e. worker.log).
pub fn english_text(message: &str, english: Option<&str>) -> String {
    if let Some(english) = english { if is_english(english) { return english.to_string(); } }
    if is_english(message) { return message.to_string(); }
    let detail = match english {
        Some(english) if !english.trim().is_empty() && english != message => format!("{message} | {english}"),
        _ => message.to_string(),
    };
    eprintln!("KVK untranslated message: {detail}");
    UNTRANSLATED.to_string()
}

#[cfg(test)]
mod tests;
