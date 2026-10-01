//! Quick import (`planImport`): one add-only plan for whatever the player dropped or picked —
//! pack folders, a `Themes` / `sounds` / `crosshairs` folder, a folder whose only entry is a pack
//! (what Explorer's "Extract All" makes), and loose files. A theme, sound or crosshair already in
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

/// The game's kind folders, as a pack names them, and their plan categories.
const KIND_FOLDERS: [(&str, &str); 3] = [("Themes", "themes"), ("sounds", "sounds"), ("crosshairs", "crosshairs")];

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

fn kind_folder(name: &str) -> Option<&'static str> { KIND_FOLDERS.iter().find(|(f, _)| eq_ignore_case(f, name)).map(|(_, c)| *c) }

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

/// A pack is a folder holding a kind folder or a settings file.
fn is_pack(dir: &str) -> EngineResult<bool> {
    Ok(txn::sorted_entries(dir)?.iter().any(|(name, is_dir)| if *is_dir { kind_folder(name).is_some() } else { settings_file(name).is_some() }))
}

struct Found { candidates: Vec<Candidate>, unrecognized: Vec<String> }

impl Found {
    fn kind_folder(&mut self, category: &'static str, dir: &str) -> EngineResult<()> {
        for (name, is_dir) in txn::sorted_entries(dir)? {
            let full = join(dir, &name);
            assert_safe_path(&full)?;
            if !is_dir && wanted(category, &name) { self.candidates.push(Candidate { category, name, source: full }); } else { self.unrecognized.push(full); }
        }
        Ok(())
    }

    fn pack(&mut self, root: &str) -> EngineResult<()> {
        for (name, is_dir) in txn::sorted_entries(root)? {
            let full = join(root, &name);
            assert_safe_path(&full)?;
            match (is_dir, kind_folder(&name), settings_file(&name)) {
                (true, Some(category), _) => self.kind_folder(category, &full)?,
                (false, _, Some((canonical, category))) => self.candidates.push(Candidate { category, name: canonical.to_string(), source: full }),
                _ => self.unrecognized.push(full),
            }
        }
        Ok(())
    }

    fn loose(&mut self, full: String) {
        let name = paths::file_name(&full);
        if let Some((canonical, category)) = settings_file(&name) {
            self.candidates.push(Candidate { category, name: canonical.to_string(), source: full });
            return;
        }
        match ["themes", "sounds", "crosshairs"].into_iter().find(|c| wanted(c, &name)) {
            Some(category) => self.candidates.push(Candidate { category, name, source: full }),
            None => self.unrecognized.push(full),
        }
    }

    /// One dropped path. A link anywhere refuses the whole import, as every other plan does.
    fn path(&mut self, path: &str) -> EngineResult<()> {
        let full = full_path(path)?;
        assert_safe_path(&full)?;
        let p = Path::new(&full);
        if p.is_file() { self.loose(full); return Ok(()); }
        if !p.is_dir() { self.unrecognized.push(full); return Ok(()); }
        if let Some(category) = kind_folder(&paths::file_name(&full)) { return self.kind_folder(category, &full); }
        if is_pack(&full)? { return self.pack(&full); }
        // Explorer's "Extract All" puts the pack inside a folder of the same name.
        if let [(only, true)] = txn::sorted_entries(&full)?.as_slice() {
            let inner = join(&full, only);
            assert_safe_path(&inner)?;
            if is_pack(&inner)? { return self.pack(&inner); }
        }
        self.unrecognized.push(full);
        Ok(())
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

fn read_bounded(path: &str, limit: usize) -> EngineResult<Option<Vec<u8>>> {
    let size = std::fs::metadata(path).map_err(|e| EngineError::io(&e))?.len();
    if size > limit as u64 { return Ok(None); }
    std::fs::read(path).map(Some).map_err(|e| EngineError::io(&e))
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

/// Every `<data root>/import-previews/<32 hex>` folder: a plan the session no longer holds.
pub fn remove_orphan_stages(engine: &Engine, context: &Context) {
    let Ok(base) = engine.data_root(&context.local_data_root).map(|d| join(&d, "import-previews")) else { return };
    let Ok(entries) = std::fs::read_dir(&base) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if paths::is_lower_hex(&name, 32) { files::remove_import_stage(engine, context, &join(&base, &name)); }
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
        if c.category != "palette" {
            if let Err(error) = txn::assert_json_object(&c.source) { self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        }
        let bytes = std::fs::read(&c.source).map_err(|e| EngineError::io(&e))?;
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
            std::fs::read(&c.source).map_err(|e| EngineError::io(&e))?
        };
        if c.category == "crosshairs" {
            if let Err(error) = files::assert_crosshair_image(&bytes) { self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
        }
        let staged = stage_file(&self.stage, &format!("{folder}/{}", c.name), &bytes)?;
        if c.category == "themes" {
            // Checked on the staged copy: what is checked is what is added.
            let theme_name = match lists::read_theme(&staged) {
                Ok(theme) => theme.get("themeName").and_then(Json::as_str).unwrap_or_default().to_string(),
                Err(error) => { let _ = std::fs::remove_file(&staged); self.skip(&c, target, Reason::Invalid, Some(&error)); return Ok(()); }
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
    let mut found = Found { candidates: Vec::new(), unrecognized: Vec::new() };
    for path in paths_in { found.path(path)?; }
    remove_orphan_stages(engine, context);
    let stage = join(&join(&engine.data_root(&context.local_data_root)?, "import-previews"), &store::new_guid());
    let prefix = format!("{}{}", context.game_root, paths::SEP);
    if stage.to_lowercase().starts_with(&prefix.to_lowercase()) {
        return Err(EngineError::coded("ENGINE_ERROR", "导入的暂存位置不能在游戏目录里。", "The import staging folder must be outside the game directory."));
    }
    let result = (|| -> EngineResult<ImportPlan> {
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
