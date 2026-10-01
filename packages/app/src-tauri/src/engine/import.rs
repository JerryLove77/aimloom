//! Quick import (`planImport`): one add-only plan for whatever the player dropped or picked —
//! files and folders. Every file is read by its format wherever it sits (`.json` a theme, `.wav` /
//! `.ogg` a sound, `.png` a crosshair, the personal settings files by name), down to three folder
//! levels, so a pack, a folder of loose files and what Explorer's "Extract All" makes all work. A theme, sound or crosshair already in
//! the game is never overwritten: it becomes a skip row with its reason. Personal settings
//! (`UI.json`, `PrimaryUserSettings.json`, `Palette.ini`) are planned only when the player asks
//! for them, and are then the only rows that may replace a file.
//!
//! Every accepted file is copied into a staging folder in the data folder when the plan is made,
//! and the plan is the ordinary pack plan of that folder (`txn::new_plan`), so execute re-checks
//! every hash (`PLAN_STALE`), backs up, records first protection and can be restored like any
//! install. What is added is exactly what the preview showed, even if a source changes later.

use std::path::Path;

use super::files::{self, MAX_PNG};
use super::json::Json;
use super::lists;
use super::paths::{self, assert_safe_path, full_path, join};
use super::store::{self, Context, Engine};
use super::text::eq_ignore_case;
use super::txn::{self, Plan};
use super::{EngineError, EngineResult};

/// The most paths one drop may name.
pub const MAX_PATHS: usize = 64;

/// The largest theme, sound or settings file read, as `planFileAdd` allows (crosshairs: 2 MiB).
const MAX_FILE: usize = 8 * 1024 * 1024;

fn size_refusal() -> EngineError {
    EngineError::coded("ENGINE_ERROR", "文件是空的，或者超过 8 MiB，游戏用不了。", "The file is empty or larger than 8 MiB, so the game cannot use it.")
}

/// The game's kind folders, as the staging folder names them, and their plan categories.
const KIND_FOLDERS: [(&str, &str); 3] = [("Themes", "themes"), ("sounds", "sounds"), ("crosshairs", "crosshairs")];

/// How many folder levels below a dropped folder are read (a pack inside an extracted folder
/// inside the dropped one is two).
const MAX_DEPTH: usize = 3;

/// The most files one drop may hold, so a drop of a whole Downloads folder stops early.
const MAX_FILES: usize = 5000;

/// The personal settings files, by their canonical names, and their plan categories.
const SETTINGS: [(&str, &str); 3] = [("UI.json", "ui"), ("PrimaryUserSettings.json", "primary"), ("Palette.ini", "palette")];

/// Why a file is not added. The wire names (`FileRow.reason`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason { ExistsSame, ExistsDifferent, ThemeNameTaken, SoundStemTaken, Invalid, DuplicateInDrop, SettingsNotIncluded }

impl Reason {
    pub fn wire(self) -> &'static str {
        match self {
            Reason::ExistsSame => "exists-same",
            Reason::ExistsDifferent => "exists-different",
            Reason::ThemeNameTaken => "theme-name-taken",
            Reason::SoundStemTaken => "sound-stem-taken",
            Reason::Invalid => "invalid",
            Reason::DuplicateInDrop => "duplicate-in-drop",
            Reason::SettingsNotIncluded => "settings-not-included",
        }
    }
}

/// A file found in the drop that will not be added.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skip {
    pub key: String,
    pub category: String,
    pub source: String,
    pub target: String,
    pub reason: Reason,
    /// Both languages, for `Reason::Invalid` only.
    pub detail: Option<(String, String)>,
}

/// A reviewed import: the staging folder (removed once the import has run), the plan of what
/// is added (`None` when nothing is), each staged file's original path, and what is not added.
pub struct ImportPlan {
    pub stage: String,
    pub plan: Option<Plan>,
    pub include_settings: bool,
    pub sources: Vec<(String, String)>,
    pub skips: Vec<Skip>,
    pub unrecognized: Vec<String>,
}

impl ImportPlan {
    /// The original path a planned (staged) source came from.
    pub fn original(&self, staged: &str) -> String {
        self.sources.iter().find(|(s, _)| s == staged).map_or_else(|| staged.to_string(), |(_, o)| o.clone())
    }
}

/// One file the drop offers: its category, its name in the game and where it is now.
struct Candidate { category: &'static str, name: String, source: String }

fn settings_file(name: &str) -> Option<(&'static str, &'static str)> { SETTINGS.iter().find(|(f, _)| eq_ignore_case(f, name)).copied() }

fn wanted(category: &str, name: &str) -> bool {
    let ext = paths::extension(name);
    match category {
        "themes" => eq_ignore_case(&ext, ".json"),
        "sounds" => eq_ignore_case(&ext, ".wav") || eq_ignore_case(&ext, ".ogg"),
        "crosshairs" => eq_ignore_case(&ext, ".png"),
        _ => false,
    }
}

struct Found { candidates: Vec<Candidate>, unrecognized: Vec<String>, files: usize }

impl Found {
    /// A file is read by its format, wherever it sits: `.json` a theme, `.wav` / `.ogg` a sound,
    /// `.png` a crosshair, and the three personal settings files by name.
    fn file(&mut self, full: String) -> EngineResult<()> {
        self.files += 1;
        if self.files > MAX_FILES {
            return Err(EngineError::coded("ENGINE_ERROR", format!("选中的文件夹里文件太多（超过 {MAX_FILES} 个），请选小一点的文件夹。"), format!("The chosen folders hold too many files (over {MAX_FILES}). Choose a smaller folder.")));
        }
        let name = paths::file_name(&full);
        if let Some((canonical, category)) = settings_file(&name) {
            self.candidates.push(Candidate { category, name: canonical.to_string(), source: full });
            return Ok(());
        }
        match ["themes", "sounds", "crosshairs"].into_iter().find(|c| wanted(c, &name)) {
            Some(category) => self.candidates.push(Candidate { category, name, source: full }),
            None => self.unrecognized.push(full),
        }
        Ok(())
    }

    /// A folder's files, and its folders' files down to `MAX_DEPTH` levels; a folder deeper than
    /// that is listed as not recognised rather than searched.
    fn folder(&mut self, dir: &str, depth: usize) -> EngineResult<()> {
        for (name, is_dir) in txn::sorted_entries(dir)? {
            let full = join(dir, &name);
            assert_safe_path(&full)?;
            if !is_dir { self.file(full)?; } else if depth < MAX_DEPTH { self.folder(&full, depth + 1)?; } else { self.unrecognized.push(full); }
        }
        Ok(())
    }

    /// One dropped path. A link anywhere refuses the whole import, as every other plan does.
    fn path(&mut self, path: &str) -> EngineResult<()> {
        let full = full_path(path)?;
        assert_safe_path(&full)?;
        let p = Path::new(&full);
        if p.is_file() { return self.file(full); }
        if !p.is_dir() { self.unrecognized.push(full); return Ok(()); }
        self.folder(&full, 0)
    }
}

/// The game folder a category's files go into.
fn game_directory(context: &Context, category: &str) -> String {
    let data = join(&context.game_root, "FPSAimTrainer");
    match category {
        "themes" => join(&data, "Saved/SaveGames/Themes"),
        "sounds" => join(&data, "sounds"),
        _ => join(&data, "crosshairs"),
    }
}

/// The files already in a game folder, by name.
fn files_in(directory: &str) -> EngineResult<Vec<String>> {
    if !Path::new(directory).is_dir() { return Ok(Vec::new()); }
    Ok(store::enumerate_files(directory, "")?.iter().map(|p| paths::file_name(p)).collect())
}

fn stem(name: &str) -> &str { &name[..name.len() - paths::extension(name).len()] }

fn oversized(path: &str, limit: usize) -> bool { std::fs::metadata(path).is_ok_and(|m| m.len() > limit as u64) }

fn read_bounded(path: &str, limit: usize) -> EngineResult<Option<Vec<u8>>> {
    let size = std::fs::metadata(path).map_err(|e| EngineError::io(&e))?.len();
    if size > limit as u64 { return Ok(None); }
    std::fs::read(path).map(Some).map_err(|e| EngineError::io(&e))
}

fn theme_refusal(name: &str) -> EngineError {
    EngineError::coded("ENGINE_ERROR", format!("主题文件无法被游戏读取，例如有只差大小写的重复键：\"{name}\"。"),
        format!("The theme file cannot be read the way the game reads it, for example two keys that differ only in case: \"{name}\"."))
}

/// Writes `bytes` into the stage and checks them back.
fn stage_file(stage: &str, relative: &str, bytes: &[u8]) -> EngineResult<String> {
    let staged = join(stage, relative);
    store::new_directory(&paths::directory_name(&staged).unwrap_or_default())?;
    store::write_durable(&staged, bytes)?;
    if store::hash(&staged)?.as_deref() != Some(paths::sha256_hex(bytes).as_str()) {
        return Err(EngineError::plain(format!("Import staging verification failed: \"{staged}\"")));
    }
    Ok(staged)
}

/// Only collect previews whose owning engine no longer holds their cross-process lock.
pub fn remove_orphan_stages(engine: &Engine, context: &Context) { remove_orphan_stages_in(engine, &context.local_data_root) }

pub fn remove_orphan_stages_in(engine: &Engine, local_data_root: &str) {
    let Ok(base) = engine.data_root(local_data_root).map(|d| join(&d, "import-previews")) else { return };
    let Ok(entries) = std::fs::read_dir(&base) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if paths::is_lower_hex(&name, 32) {
            let stage = join(&base, &name);
            let Ok(_lock) = engine.import_stage_lock(local_data_root, &stage) else { continue };
            // Do not call the owner cleanup path: it releases this engine's held lease.
            if paths::assert_safe_path(&stage).is_ok() { let _ = std::fs::remove_dir_all(&stage); }
        }
    }
}

struct Checker<'a> {
    engine: &'a Engine,
    context: &'a Context,
    stage: String,
    include_settings: bool,
    in_game: Vec<(&'static str, Vec<String>)>,
    installed_sounds: Vec<String>,
    installed_theme_names: Vec<String>,
    accepted: Vec<(Candidate, String)>,
    accepted_theme_names: Vec<String>,
    skips: Vec<Skip>,
}

impl Checker<'_> {
    fn skip(&mut self, c: &Candidate, target: String, reason: Reason, detail: Option<&EngineError>) {
        self.skips.push(Skip {
            key: format!("{}/{}", c.category, c.name), category: c.category.to_string(), source: c.source.clone(), target, reason,
            detail: detail.map(|e| (e.message.clone(), e.english())),
        });
    }

    fn already_accepted(&self, c: &Candidate) -> bool {
        self.accepted.iter().any(|(a, _)| a.category == c.category && eq_ignore_case(&a.name, &c.name))
    }

    fn settings(&mut self, c: Candidate) -> EngineResult<()> {
        let target = self.engine.target(self.context, &format!("{}/{}", c.category, c.name))?;
        if !self.include_settings { self.skip(&c, target, Reason::SettingsNotIncluded, None); return Ok(()); }
        if self.already_accepted(&c) { self.skip(&c, target, Reason::DuplicateInDrop, None); return Ok(()); }
        if oversized(&c.source, MAX_FILE) { let error = size_refusal(); self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        if c.category != "palette" {
            if let Err(error) = txn::assert_json_object(&c.source) { self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        }
        let bytes = match read_bounded(&c.source, MAX_FILE)? {
            Some(bytes) if !bytes.is_empty() => bytes,
            _ => { let error = size_refusal(); self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        };
        let staged = stage_file(&self.stage, &c.name, &bytes)?;
        self.accepted.push((c, staged));
        Ok(())
    }

    fn asset(&mut self, c: Candidate) -> EngineResult<()> {
        let directory = game_directory(self.context, c.category);
        let target = join(&directory, &c.name);
        let named = match c.category {
            "themes" => files::assert_import_name("theme", &c.name),
            "sounds" => files::assert_import_name("sound", &c.name),
            _ => files::assert_crosshair_name(&c.name),
        };
        if let Err(error) = named { self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        if self.already_accepted(&c) { self.skip(&c, target, Reason::DuplicateInDrop, None); return Ok(()); }
        let existing = self.in_game.iter().find(|(cat, _)| *cat == c.category).and_then(|(_, names)| names.iter().find(|n| eq_ignore_case(n, &c.name)).cloned());
        if let Some(existing) = existing {
            let existing_target = join(&directory, &existing);
            if oversized(&c.source, if c.category == "crosshairs" { MAX_PNG } else { MAX_FILE }) {
                let error = if c.category == "crosshairs" { files::assert_crosshair_image(&[]).unwrap_err() } else { size_refusal() };
                self.skip(&c, target, Reason::Invalid, Some(&error));
                return Ok(());
            }
            let same = store::hash(&existing_target)? == store::hash(&c.source)?;
            self.skip(&c, existing_target, if same { Reason::ExistsSame } else { Reason::ExistsDifferent }, None);
            return Ok(());
        }
        if c.category == "sounds" {
            let wanted_stem = stem(&c.name);
            if self.installed_sounds.iter().any(|s| eq_ignore_case(s, wanted_stem)) { self.skip(&c, target, Reason::SoundStemTaken, None); return Ok(()); }
            if self.accepted.iter().any(|(a, _)| a.category == "sounds" && eq_ignore_case(stem(&a.name), wanted_stem)) {
                self.skip(&c, target, Reason::DuplicateInDrop, None);
                return Ok(());
            }
        }
        let folder = KIND_FOLDERS.iter().find(|(_, cat)| *cat == c.category).map_or("", |(f, _)| *f);
        let bytes = if c.category == "crosshairs" {
            // Over the limit is refused without reading it; the image check words it.
            match read_bounded(&c.source, MAX_PNG)? {
                Some(bytes) => bytes,
                None => { let error = files::assert_crosshair_image(&[]).unwrap_err(); self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
            }
        } else {
            match read_bounded(&c.source, MAX_FILE)? {
                Some(bytes) if !bytes.is_empty() => bytes,
                _ => { let error = size_refusal(); self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
            }
        };
        if c.category == "crosshairs" {
            if let Err(error) = files::assert_crosshair_image(&bytes) { self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        }
        let staged = stage_file(&self.stage, &format!("{folder}/{}", c.name), &bytes)?;
        if c.category == "themes" {
            // Checked on the staged copy: what is checked is what is added.
            let readable = lists::read_theme(&staged).and_then(|theme| txn::assert_json_object(&staged).map(|()| theme));
            let theme_name = match readable {
                Ok(theme) => theme.get("themeName").and_then(Json::as_str).unwrap_or_default().to_string(),
                Err(error) => {
                    let _ = std::fs::remove_file(&staged);
                    // The plan's own check names the staged path; the player named the file.
                    let error = if error.message.contains(&staged) { theme_refusal(&c.name) } else { error };
                    self.skip(&c, target, Reason::Invalid, Some(&error));
                    return Ok(());
                }
            };
            let taken = if self.installed_theme_names.iter().any(|n| eq_ignore_case(n, &theme_name)) { Some(Reason::ThemeNameTaken) }
                else if self.accepted_theme_names.iter().any(|n| eq_ignore_case(n, &theme_name)) { Some(Reason::DuplicateInDrop) } else { None };
            if let Some(reason) = taken { let _ = std::fs::remove_file(&staged); self.skip(&c, target, reason, None); return Ok(()); }
            self.accepted_theme_names.push(theme_name);
        }
        self.accepted.push((c, staged));
        Ok(())
    }
}

/// `planImport`. The caller has checked the game is closed and no batch is unfinished.
pub fn import_plan(engine: &Engine, context: &Context, paths_in: &[String], include_settings: bool) -> EngineResult<ImportPlan> {
    engine.assert_context(context)?;
    if paths_in.is_empty() || paths_in.len() > MAX_PATHS {
        return Err(EngineError::coded("ENGINE_ERROR", format!("一次只能导入 1 到 {MAX_PATHS} 个文件或文件夹。"), format!("Import 1 to {MAX_PATHS} files or folders at a time.")));
    }
    let mut found = Found { candidates: Vec::new(), unrecognized: Vec::new(), files: 0 };
    for path in paths_in { found.path(path)?; }
    remove_orphan_stages(engine, context);
    let stage = join(&join(&engine.data_root(&context.local_data_root)?, "import-previews"), &store::new_guid());
    let prefix = format!("{}{}", context.game_root, paths::SEP);
    if stage.to_lowercase().starts_with(&prefix.to_lowercase()) {
        return Err(EngineError::coded("ENGINE_ERROR", "导入的暂存位置不能在游戏目录里。", "The import staging folder must be outside the game directory."));
    }
    let result = (|| -> EngineResult<ImportPlan> {
        engine.hold_import_stage(&context.local_data_root, &stage)?;
        store::new_directory(&stage)?;
        let themes = lists::installed_themes(engine, context)?;
        let (_, sounds) = lists::installed_sounds(engine, context)?;
        let mut checker = Checker {
            engine, context, stage: stage.clone(), include_settings,
            in_game: KIND_FOLDERS.iter().map(|(_, cat)| Ok((*cat, files_in(&game_directory(context, cat))?))).collect::<EngineResult<_>>()?,
            installed_sounds: sounds.into_iter().map(|s| s.name).collect(),
            installed_theme_names: themes.themes.into_iter().filter(|t| t.readable).filter_map(|t| t.name).collect(),
            accepted: Vec::new(), accepted_theme_names: Vec::new(), skips: Vec::new(),
        };
        for candidate in found.candidates {
            if SETTINGS.iter().any(|(_, cat)| *cat == candidate.category) { checker.settings(candidate)?; } else { checker.asset(candidate)?; }
        }
        let categories: Vec<String> = ["themes", "sounds", "crosshairs", "ui", "palette", "primary"].iter()
            .filter(|cat| checker.accepted.iter().any(|(a, _)| a.category == **cat)).map(|c| (*c).to_string()).collect();
        let plan = if categories.is_empty() { None } else {
            let plan = txn::new_plan(engine, context, &stage, &categories)?;
            // A theme, sound or crosshair is only ever added; anything else means the game folder
            // changed while the plan was being made.
            let added_only = plan.items.len() == checker.accepted.len()
                && plan.items.iter().all(|i| SETTINGS.iter().any(|(_, cat)| *cat == i.category) || (i.action == "create" && i.before.is_none()));
            if !added_only {
                return Err(EngineError::coded("PLAN_STALE", "准备导入时，游戏文件夹里的文件发生了变化，这次没有写入。请重新拖入。", "The game folder changed while the import was being prepared, so nothing was written. Drop the files again."));
            }
            Some(plan)
        };
        let sources = checker.accepted.iter().map(|(c, staged)| (staged.clone(), c.source.clone())).collect();
        Ok(ImportPlan { stage: stage.clone(), plan, include_settings, sources, skips: checker.skips, unrecognized: found.unrecognized })
    })();
    if result.is_err() { files::remove_import_stage(engine, context, &stage); }
    result
}

/// Runs a reviewed import; the staging folder goes either way.
pub fn import_execute(engine: &Engine, context: &Context, import: &ImportPlan, observer: txn::Observer) -> EngineResult<txn::Report> {
    let result = match &import.plan {
        Some(plan) => txn::install(engine, context, plan, false, observer),
        None => {
            observer(&txn::Observation { name: "report", phase: "verifying", completed: Some(0), total: 0, current_file: None, batch_id: None });
            Ok(txn::Report::new("no-change", None, Vec::new(), Vec::new(), None))
        }
    };
    files::remove_import_stage(engine, context, &import.stage);
    result
}
