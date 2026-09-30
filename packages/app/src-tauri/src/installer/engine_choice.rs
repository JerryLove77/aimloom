//! Which engine the App starts: PowerShell 7 (the default) or the Rust engine inside
//! `Aimloom.exe` (ROADMAP ENGINE-RUST step 3). The choice is `engine.json` in the data folder,
//! written only from Settings; a missing or unreadable file means PowerShell. The Setup never asks.
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::worker::{data_root, DATA_FOLDER, LEGACY_DATA_FOLDER};

const CHOICE_FILE: &str = "engine.json";
/// The batch states that force recovery first (`UNFINISHED` in `engine/manifest.rs`,
/// `prepared`/`applying`/`recovery-required` in the PowerShell engine).
const UNFINISHED: [&str; 3] = ["prepared", "applying", "recovery-required"];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineKind {
    #[default]
    Powershell,
    Rust,
}

#[derive(Serialize, Deserialize)]
struct ChoiceFile { engine: EngineKind }

/// The data folder as it stands, resolved without renaming or creating anything: reading the
/// choice at launch must not move an older data folder before the worker's own resolver does.
fn existing_data_root(local_app_data: &Path) -> Option<PathBuf> {
    [DATA_FOLDER, LEGACY_DATA_FOLDER].iter().map(|name| local_app_data.join(name)).find(|dir| dir.is_dir())
}

pub fn read_choice(local_app_data: &Path) -> EngineKind {
    existing_data_root(local_app_data)
        .and_then(|root| fs::read(root.join(CHOICE_FILE)).ok())
        .and_then(|bytes| serde_json::from_slice::<ChoiceFile>(&bytes).ok())
        .map(|file| file.engine)
        .unwrap_or_default()
}

/// Written through a temporary file and a rename, so a crash leaves the old choice or the new
/// one, never half a file. The folder comes from the one resolver every writer uses.
pub fn write_choice(local_app_data: &Path, engine: EngineKind) -> std::io::Result<()> {
    let root = data_root(local_app_data);
    fs::create_dir_all(&root)?;
    let temporary = root.join(format!("{CHOICE_FILE}.tmp"));
    fs::write(&temporary, serde_json::to_vec(&ChoiceFile { engine }).map_err(std::io::Error::other)?)?;
    fs::rename(&temporary, root.join(CHOICE_FILE))
}

/// True when any backup batch on disk, for any game folder, is still unfinished. Read-only and
/// deliberately loose: a manifest that cannot be read is not counted, since both engines refuse
/// to write past it anyway; this check only keeps the switch from happening mid-recovery.
pub fn unfinished_batch_on_disk(local_app_data: &Path) -> bool {
    let Some(root) = existing_data_root(local_app_data) else { return false };
    let Ok(games) = fs::read_dir(root.join("backups")) else { return false };
    games.flatten().filter(|game| game.path().is_dir()).any(|game| {
        let Ok(batches) = fs::read_dir(game.path()) else { return false };
        batches.flatten().any(|batch| {
            let status = fs::read(batch.path().join("manifest.json")).ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(strip_bom(&bytes)).ok())
                .and_then(|manifest| manifest.get("Status").and_then(|s| s.as_str()).map(str::to_string));
            status.is_some_and(|s| UNFINISHED.contains(&s.as_str()))
        })
    })
}

fn strip_bom(bytes: &[u8]) -> &[u8] { bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes) }

#[cfg(test)]
mod tests {
    use super::*;

    fn local(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kvk-engine-choice-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn powershell_until_a_choice_is_written_and_reading_creates_nothing() {
        let dir = local("default");
        assert_eq!(read_choice(&dir), EngineKind::Powershell);
        assert!(!dir.join("Aimloom").exists());
        write_choice(&dir, EngineKind::Rust).unwrap();
        assert_eq!(read_choice(&dir), EngineKind::Rust);
        assert_eq!(fs::read_to_string(dir.join("Aimloom").join("engine.json")).unwrap(), r#"{"engine":"rust"}"#);
        write_choice(&dir, EngineKind::Powershell).unwrap();
        assert_eq!(read_choice(&dir), EngineKind::Powershell);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_or_unknown_choice_means_powershell() {
        let dir = local("damaged");
        fs::create_dir_all(dir.join("Aimloom")).unwrap();
        for text in ["{", r#"{"engine":"python"}"#, ""] {
            fs::write(dir.join("Aimloom").join("engine.json"), text).unwrap();
            assert_eq!(read_choice(&dir), EngineKind::Powershell, "{text}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_uses_an_old_data_folder_without_renaming_it() {
        let dir = local("legacy");
        fs::create_dir_all(dir.join("KovaaKConfigInstaller")).unwrap();
        fs::write(dir.join("KovaaKConfigInstaller").join("engine.json"), r#"{"engine":"rust"}"#).unwrap();
        assert_eq!(read_choice(&dir), EngineKind::Rust);
        assert!(!unfinished_batch_on_disk(&dir));
        assert!(dir.join("KovaaKConfigInstaller").is_dir() && !dir.join("Aimloom").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_an_unfinished_batch_under_any_game_folder() {
        let dir = local("batches");
        let game = dir.join("Aimloom").join("backups").join("0123456789abcdef");
        let batch = |id: &str, status: &str| {
            fs::create_dir_all(game.join(id)).unwrap();
            fs::write(game.join(id).join("manifest.json"), format!("\u{feff}{{\"Version\":1,\"Status\":\"{status}\"}}")).unwrap();
        };
        assert!(!unfinished_batch_on_disk(&dir));
        batch("pristine", "protected");
        batch("aaaa", "completed");
        batch("bbbb", "rolled-back");
        fs::create_dir_all(game.join("cccc")).unwrap();
        fs::write(game.join("cccc").join("manifest.json"), "not json").unwrap();
        assert!(!unfinished_batch_on_disk(&dir));
        for status in UNFINISHED {
            batch("dddd", status);
            assert!(unfinished_batch_on_disk(&dir), "{status}");
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
