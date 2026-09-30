//! The data folder, the game context, and the low-level writes every operation shares:
//! hashes, durable and atomic writes, snapshots and locks (`kvk-engine.ps1`, lines 20-470).

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

use super::json::Json;
use super::paths::{self, assert_safe_path, full_path, join};
use super::text::{eq_ignore_case, lower_invariant};
use super::{manifest, platform, EngineError, EngineResult};

const DATA_FOLDER: &str = "Aimloom";
const LEGACY_DATA_FOLDER: &str = "KovaaKConfigInstaller";
const GAME_PROCESSES: [&str; 2] = ["FPSAimTrainer", "FPSAimTrainer-Win64-Shipping"];

/// What the engine asks of the machine beyond files. Tests substitute it, as the PowerShell
/// suites redefine `Assert-KvkGameClosed` and friends.
pub trait Host {
    /// `Get-Process` names. An error means the process list could not be read.
    fn process_names(&self) -> std::io::Result<Vec<String>>;

    /// A test's chance to fail at a named step (`snapshot`, `file-change`, …). Never fails in
    /// the App.
    fn fault(&self, _point: &str) -> EngineResult<()> { Ok(()) }
}

/// The real machine.
pub struct SystemHost;

impl Host for SystemHost {
    fn process_names(&self) -> std::io::Result<Vec<String>> {
        #[cfg(windows)]
        { platform::process_names() }
        #[cfg(not(windows))]
        { Ok(Vec::new()) }
    }
}

/// One engine instance: the machine it runs on and what it remembers for the session (the
/// data folder it chose and, if it kept the old folder name, the file that holds it).
pub struct Engine {
    pub host: Box<dyn Host>,
    data_roots: RefCell<HashMap<String, String>>,
    holds: RefCell<Vec<File>>,
}

/// `New-KvkContext`: where a game's backups and locks live.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Context {
    pub game_root: String,
    pub local_data_root: String,
    pub backup_root: String,
    pub lock_root: String,
}

impl Engine {
    pub fn new(host: Box<dyn Host>) -> Self {
        Self { host, data_roots: RefCell::new(HashMap::new()), holds: RefCell::new(Vec::new()) }
    }

    /// `Assert-KvkGameClosed`.
    pub fn assert_game_closed(&self) -> EngineResult<()> {
        let names = self.host.process_names().map_err(|e| EngineError::io(&e))?;
        if names.iter().any(|n| GAME_PROCESSES.iter().any(|g| eq_ignore_case(n, g))) {
            return Err(EngineError::coded("GAME_RUNNING", "请先退出 KovaaK 再修改文件（FPSAimTrainer 正在运行）。", "Exit KovaaK before changing files (FPSAimTrainer is running)."));
        }
        Ok(())
    }

    /// `Get-KvkGuiGameState`.
    pub fn game_state(&self) -> &'static str {
        match self.host.process_names() {
            Ok(names) if names.iter().any(|n| GAME_PROCESSES.iter().any(|g| eq_ignore_case(n, g))) => "running",
            Ok(_) => "closed",
            Err(_) => "unknown",
        }
    }

    /// `Get-KvkDataRoot`: `Aimloom` if it exists; else an existing old folder is renamed to it
    /// once; if that fails, the old folder is used for the rest of the session, held open so no
    /// other process renames it away. Remembered per session.
    pub fn data_root(&self, local_data_root: &str) -> EngineResult<String> {
        let local = full_path(local_data_root)?;
        let key = lower_invariant(&local);
        if let Some(chosen) = self.data_roots.borrow().get(&key) { return Ok(chosen.clone()); }
        let current = join(&local, DATA_FOLDER);
        let legacy = join(&local, LEGACY_DATA_FOLDER);
        let mut chosen = current.clone();
        if !Path::new(&current).is_dir() && Path::new(&legacy).is_dir() {
            let moved = assert_safe_path(&legacy).and_then(|_| assert_safe_path(&current))
                .and_then(|_| platform::move_directory(Path::new(&legacy), Path::new(&current)).map_err(|e| EngineError::io(&e)));
            if moved.is_err() {
                chosen = legacy.clone();
                let locks = join(&legacy, "locks");
                if std::fs::create_dir_all(&locks).is_ok() {
                    if let Ok(hold) = platform::open_shared(Path::new(&join(&locks, "data-root.hold"))) { self.holds.borrow_mut().push(hold); }
                }
            }
        }
        self.data_roots.borrow_mut().insert(key, chosen.clone());
        Ok(chosen)
    }

    /// `Get-KvkGameRoot`: the folder (or its parent) holding the game's settings file and
    /// sounds folder; failing that, a folder whose complete first-protection record exists, so
    /// a deleted settings file can still be restored.
    pub fn game_root(&self, path: &str, local_data_root: Option<&str>) -> EngineResult<String> {
        let root = full_path(path)?;
        let candidates: Vec<String> = std::iter::once(root.clone()).chain(paths::directory_name(&root)).collect();
        for candidate in &candidates {
            let data = join(candidate, "FPSAimTrainer");
            let primary = join(&data, "Saved/SaveGames/PrimaryUserSettings.json");
            let sounds = join(&data, "sounds");
            assert_safe_path(&primary)?;
            assert_safe_path(&sounds)?;
            if Path::new(&primary).is_file() && Path::new(&sounds).is_dir() { return Ok(candidate.clone()); }
        }
        if let Some(local) = local_data_root.filter(|l| !l.trim().is_empty()) {
            let local = full_path(local)?;
            for candidate in &candidates {
                let base = self.data_root(&local)?;
                let recovery = Context {
                    game_root: candidate.clone(),
                    local_data_root: local.clone(),
                    backup_root: join(&base, &format!("backups/{}", paths::text_hash(&lower_invariant(candidate)))),
                    lock_root: join(&base, "locks"),
                };
                let manifest_path = join(&recovery.backup_root, "pristine/manifest.json");
                let sounds = join(candidate, "FPSAimTrainer/sounds");
                if Path::new(&manifest_path).is_file() && Path::new(&sounds).is_dir() {
                    assert_safe_path(&sounds)?;
                    manifest::read(self, &recovery, "pristine")?;
                    return Ok(candidate.clone());
                }
            }
        }
        Err(EngineError::plain(format!("Cannot validate game directory: \"{path}\". Run the game once and exit normally first.")))
    }

    /// `New-KvkContext`.
    pub fn context(&self, game_root: &str, local_data_root: &str) -> EngineResult<Context> {
        let game = self.game_root(game_root, Some(local_data_root))?;
        let local = full_path(local_data_root)?;
        assert_safe_path(&local)?;
        let base = self.data_root(&local)?;
        Ok(Context {
            backup_root: join(&base, &format!("backups/{}", paths::text_hash(&lower_invariant(&game)))),
            lock_root: join(&base, "locks"),
            game_root: game,
            local_data_root: local,
        })
    }

    /// `Assert-KvkContext`.
    pub fn assert_context(&self, context: &Context) -> EngineResult<()> {
        let valid = self.context(&context.game_root, &context.local_data_root)?;
        if !eq_ignore_case(&valid.backup_root, &context.backup_root) || !eq_ignore_case(&valid.lock_root, &context.lock_root) {
            return Err(EngineError::plain("Invalid backup context."));
        }
        assert_safe_path(&context.backup_root)
    }

    /// `Enter-KvkLock`: the shared Palette lock first (it is common to every installation),
    /// then this game's own lock. Held until the returned files are dropped.
    pub fn enter_lock(&self, context: &Context) -> EngineResult<Vec<File>> {
        self.assert_context(context)?;
        new_directory(&context.lock_root)?;
        let mut locks = Vec::new();
        for name in ["palette.lock".to_string(), format!("{}.lock", paths::text_hash(&lower_invariant(&context.game_root)))] {
            let path = join(&context.lock_root, &name);
            let opened = assert_safe_path(&path).and_then(|_| platform::open_exclusive(Path::new(&path)).map_err(|e| EngineError::io(&e)));
            match opened {
                Ok(file) => locks.push(file),
                Err(error) => {
                    drop(locks);
                    return Err(EngineError::coded("BUSY",
                        format!("另一个 Aimloom 可能正在运行，或者无法使用锁文件：「{}」", error.message),
                        format!("Another Aimloom may be running, or the lock files could not be used: \"{}\"", error.message)));
                }
            }
        }
        Ok(locks)
    }

    /// `Get-KvkTarget`: the game path a managed key names, in the casing already on disk. A
    /// second entry differing only in case is refused, even on a case-sensitive test host.
    pub fn target(&self, context: &Context, key: &str) -> EngineResult<String> {
        let parts: Vec<&str> = key.split('/').collect();
        if parts.len() != 2 { return Err(EngineError::plain(format!("Invalid managed key: \"{key}\""))); }
        let (category, name) = (parts[0], parts[1]);
        paths::assert_file_name(name)?;
        let data = join(&context.game_root, "FPSAimTrainer");
        let ext = paths::extension(name);
        let target = match category {
            "themes" => {
                if !name.to_ascii_lowercase().ends_with(".json") { return Err(EngineError::plain("Invalid theme extension.")); }
                join(&join(&data, "Saved/SaveGames/Themes"), name)
            }
            "sounds" => {
                if !eq_ignore_case(&ext, ".ogg") && !eq_ignore_case(&ext, ".wav") { return Err(EngineError::plain("Invalid sound extension.")); }
                join(&join(&data, "sounds"), name)
            }
            "crosshairs" => {
                if !eq_ignore_case(&ext, ".png") { return Err(EngineError::plain("Invalid crosshair extension.")); }
                join(&join(&data, "crosshairs"), name)
            }
            "ui" => { if name != "UI.json" { return Err(EngineError::plain("Invalid UI key.")); } join(&data, "Saved/SaveGames/UI.json") }
            "primary" => { if name != "PrimaryUserSettings.json" { return Err(EngineError::plain("Invalid Primary key.")); } join(&data, "Saved/SaveGames/PrimaryUserSettings.json") }
            "palette" => { if name != "Palette.ini" { return Err(EngineError::plain("Invalid Palette key.")); } join(&context.local_data_root, "FPSAimTrainer/Saved/Config/WindowsNoEditor/Palette.ini") }
            other => return Err(EngineError::plain(format!("Unknown category: {other}"))),
        };
        assert_safe_path(&target)?;
        let mut resolved = target.clone();
        if let Some(parent) = paths::directory_name(&target) {
            if Path::new(&parent).is_dir() {
                let mut matches = Vec::new();
                for entry in std::fs::read_dir(&parent).map_err(|e| EngineError::io(&e))? {
                    let entry = entry.map_err(|e| EngineError::io(&e))?;
                    let entry_name = entry.file_name().to_string_lossy().into_owned();
                    if eq_ignore_case(&entry_name, name) { matches.push(join(&parent, &entry_name)); }
                }
                if matches.len() > 1 { return Err(EngineError::plain(format!("Case collision at target: \"{target}\""))); }
                if let Some(found) = matches.pop() { resolved = found; }
            }
        }
        full_path(&resolved)
    }
}

/// `New-KvkDirectory`.
pub fn new_directory(path: &str) -> EngineResult<()> {
    assert_safe_path(path)?;
    std::fs::create_dir_all(path).map_err(|e| EngineError::io(&e))?;
    assert_safe_path(path)
}

/// `Get-KvkHash`: the file's SHA-256, or `None` when there is no file.
pub fn hash(path: &str) -> EngineResult<Option<String>> {
    assert_safe_path(path)?;
    let p = Path::new(path);
    if p.is_dir() { return Err(EngineError::plain(format!("Expected a file: \"{path}\""))); }
    if !p.is_file() { return Ok(None); }
    let bytes = std::fs::read(p).map_err(|e| EngineError::io(&e))?;
    Ok(Some(paths::sha256_hex(&bytes)))
}

/// `Write-KvkDurableFile`: a new file, written through to disk; never overwrites.
pub fn write_durable(path: &str, bytes: &[u8]) -> EngineResult<()> {
    assert_safe_path(path)?;
    platform::write_new_durable(Path::new(path), bytes).map_err(|e| EngineError::io(&e))
}

/// `Write-KvkAtomicJson`: the compact JSON goes to a temporary file first, which then takes the
/// place of the old file only if the old one is still what it was; the result is read back.
pub fn write_atomic_json(path: &str, value: &Json) -> EngineResult<()> {
    new_directory(&paths::directory_name(path).unwrap_or_default())?;
    let before = hash(path)?;
    let temp = format!("{path}.tmp-{}", new_guid());
    let result = (|| {
        let json = value.to_compact();
        write_durable(&temp, json.as_bytes())?;
        if hash(path)? != before { return Err(EngineError::plain(format!("Manifest changed concurrently: \"{path}\""))); }
        let moved = if before.is_none() { platform::move_file_no_replace(Path::new(&temp), Path::new(path)) } else { platform::replace_file(Path::new(&temp), Path::new(path)) };
        moved.map_err(|e| EngineError::io(&e))?;
        if hash(path)? != Some(paths::text_hash(&json)) { return Err(EngineError::plain(format!("Manifest read-back verification failed: \"{path}\""))); }
        let text = std::fs::read_to_string(path).map_err(|e| EngineError::io(&e))?;
        super::json::parse(&text, super::json::ReadOptions::CONVERT_FROM_JSON).map_err(|e| EngineError::plain(e.0))?;
        Ok(())
    })();
    if Path::new(&temp).is_file() { let _ = std::fs::remove_file(&temp); }
    result
}

/// `Copy-KvkSnapshot`: copies a file whose hash must be `expected` before and after.
pub fn copy_snapshot(engine: &Engine, source: &str, destination: &str, expected: &str) -> EngineResult<()> {
    engine.host.fault("snapshot")?;
    if expected.is_empty() || hash(source)?.as_deref() != Some(expected) { return Err(EngineError::plain(format!("File changed before backup: \"{source}\""))); }
    let bytes = std::fs::read(source).map_err(|e| EngineError::io(&e))?;
    new_directory(&paths::directory_name(destination).unwrap_or_default())?;
    write_durable(destination, &bytes)?;
    if hash(destination)?.as_deref() != Some(expected) || hash(source)?.as_deref() != Some(expected) {
        return Err(EngineError::plain(format!("Backup verification failed: \"{source}\"")));
    }
    Ok(())
}

/// `[Guid]::NewGuid().ToString('N')`.
pub fn new_guid() -> String { uuid::Uuid::new_v4().simple().to_string() }
