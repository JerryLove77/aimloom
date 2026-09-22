use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_JSON_DEPTH: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidPath,
    InvalidPack,
    GameRunning,
    GameStateUnknown,
    PlanStale,
    PlanMissing,
    BackupInvalid,
    Conflict,
    UnownedFile,
    RecoveryRequired,
    Busy,
    UnsupportedPlatform,
    WorkerUnavailable,
    EngineError,
}

/// A problem shown to the player, in Chinese (`message`) and English (`messageEn`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Issue {
    pub code: ErrorCode,
    pub message: String,
    pub message_en: String,
    pub path: Option<String>,
}

/// True when a text holds Chinese or other CJK characters: CJK punctuation (U+3000–303F),
/// ideographs (U+3400–9FFF) and full-width forms (U+FF00–FFEF). The UI's guard uses the same ranges.
pub fn has_cjk(text: &str) -> bool {
    text.chars().any(|c| matches!(c, '\u{3000}'..='\u{303f}' | '\u{3400}'..='\u{9fff}' | '\u{ff00}'..='\u{ffef}'))
}

/// English that may be shown to an English player: not blank, and no CJK **outside
/// double-quoted spans**. A span is `"…"` — ASCII double quotes, no nesting — and it holds game
/// content: a file name, a theme name, a Profile name or a path, which is never translated and
/// may well be Chinese. An odd number of quotes leaves the unclosed tail outside, so a broken
/// message can never smuggle an untranslated Chinese sentence through.
///
/// `Test-KvkEnglishSafe` in `scripts/installer/kvk-engine.ps1` and `isEnglishText` in
/// `packages/app/src/i18n/index.ts` implement the same rule; a shared ten-case parity table
/// pins the three together.
pub fn is_english(text: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    let parts: Vec<&str> = text.split('"').collect();
    let last = parts.len() - 1;
    !parts.iter().enumerate().any(|(i, part)| (i % 2 == 0 || i == last) && has_cjk(part))
}

impl Issue {
    /// A player-facing issue in both languages.
    pub fn new(code: ErrorCode, zh: impl Into<String>, en: impl Into<String>) -> Self {
        let message_en = en.into();
        debug_assert!(is_english(&message_en), "English issue text must not be blank or contain CJK: {message_en:?}");
        Self { code, message: zh.into(), message_en, path: None }
    }

    /// A diagnostic worded only in English (protocol and process failures). Both languages
    /// carry the same text, as the Chinese UI already showed it.
    /// Built directly, without `new`'s English assertion: the text comes from the OS (an
    /// `io::Error`, a serde message), and on a Chinese Windows it can be localized. That must
    /// not panic a debug build — it is still the best text either language has.
    pub fn plain(code: ErrorCode, message: impl Into<String>) -> Self {
        let message = message.into();
        Self { code, message: message.clone(), message_en: message, path: None }
    }

    /// An English-only diagnostic about the worker process.
    pub fn worker(message: impl Into<String>) -> Self {
        Self::plain(ErrorCode::WorkerUnavailable, message)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Themes,
    Sounds,
    Crosshairs,
    Ui,
    Palette,
    Primary,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GameState { Closed, Running, Unknown }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Phase { Preparing, Protecting, Installing, Verifying, Restoring, RollingBack }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome { Completed, NoChange, RolledBack, RecoveryRequired, Restored }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Location {
    pub game_root: String,
    pub backup_root: String,
    pub game_state: GameState,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogEntry { pub category: Category, pub count: usize }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Discovery { pub candidates: Vec<String>, pub default_pack: Option<String> }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub pack_root: String,
    pub categories: Vec<CatalogEntry>,
    pub skipped: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileAction { Create, Replace, Skip, Restore, Delete }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRow {
    pub key: String,
    pub category: Category,
    pub source: Option<String>,
    pub target: String,
    pub action: FileAction,
    pub conflict: bool,
    pub unowned: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind { Install, Restore }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preview {
    pub plan_id: String,
    pub revision: u64,
    pub kind: PreviewKind,
    pub location: Location,
    pub pack_root: Option<String>,
    pub categories: Vec<Category>,
    pub source_id: Option<String>,
    pub rows: Vec<FileRow>,
    pub skipped: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemeTheme {
    pub name: Option<String>,
    pub file: String,
    pub path: String,
    pub readable: bool,
    pub duplicate_name: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemeList {
    pub directory: String,
    pub current: Option<String>,
    pub themes: Vec<SchemeTheme>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledSound {
    pub name: String,
    pub file: String,
    pub path: String,
    pub ambiguous: bool,
}

/// Every event is a name list: Kill and Spawn hold an ordered list, the MBS events exactly one.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioBindings {
    pub kill: Vec<String>,
    pub spawn: Vec<String>,
    pub mbs_good: Vec<String>,
    pub mbs_okay: Vec<String>,
    pub mbs_bad: Vec<String>,
    pub mbs_change_now: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioList {
    pub directory: String,
    pub sounds: Vec<InstalledSound>,
    pub bindings: AudioBindings,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledCrosshair { pub name: String, pub file: String, pub path: String }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrosshairList { pub directory: String, pub crosshairs: Vec<InstalledCrosshair> }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportedFile { pub path: String, pub bytes: usize, pub sha256: String }

/// The game's three Skin Browser shapes, on the wire. `Cylindrical` is the humanoid box; the
/// JSON key in `PrimaryUserSettings.json` is the capitalized form of the same name.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum EnemyShape { Cylindrical, Cuboid, Spheroid }

/// A skin's identity in the settings file: the two strings are written together, never alone.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnemySkinChoice { pub model: String, pub skin: String }

/// One row of the game's own Skin Browser catalog (see `docs/research/kovaak-skin-browser.md`).
/// `shapes` names every shape this skin supports; there are no thumbnails to ship.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnemySkin { pub label: String, pub model: String, pub skin: String, pub shapes: Vec<EnemyShape> }

/// The equipped pair per shape, or `null` when the settings file has no block for that shape.
/// A pair that is not in the catalog (a future game version) is still returned as it is.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnemyCurrent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cylindrical: Option<EnemySkinChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cuboid: Option<EnemySkinChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spheroid: Option<EnemySkinChoice>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnemyList { pub current: EnemyCurrent, pub skins: Vec<EnemySkin> }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BackupStatus { Prepared, Applying, Completed, RolledBack, RecoveryRequired }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Backup {
    pub id: String,
    pub created_at: String,
    pub kind: PreviewKind,
    pub status: BackupStatus,
    pub categories: Vec<Category>,
    pub file_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupIndex {
    pub location: Location,
    pub records: Vec<Backup>,
    pub has_pristine: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Progress {
    pub phase: Phase,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub current_file: Option<String>,
    pub batch_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionItem { pub key: String, pub target: String, pub state: String }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Execution {
    pub status: Outcome,
    pub batch_id: Option<String>,
    pub items: Vec<ExecutionItem>,
    pub errors: Vec<String>,
    /// English for each line of `errors`, in the same order.
    pub errors_en: Vec<String>,
}

/// A final report is usable only when every error line has its English twin.
pub fn validate_execution(execution: &Execution) -> Result<(), Issue> {
    if execution.errors_en.len() != execution.errors.len() {
        return Err(Issue::worker("worker final report has an English error list of the wrong length"));
    }
    if !execution.errors_en.iter().all(|line| is_english(line)) {
        return Err(Issue::worker("worker final report has an English error line that is blank or not English"));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobState { Running, Finished, Failed, Unknown, Reconciled }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub operation_id: String,
    pub plan_id: String,
    pub state: JobState,
    pub progress: Option<Progress>,
    pub result: Option<Execution>,
    pub error: Option<Issue>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reconciliation { pub job: Job, pub backups: Option<BackupIndex> }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Confirmation { Install, Restore }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteRequest {
    pub operation_id: String,
    pub plan_id: String,
    pub confirmation: Confirmation,
    pub allow_conflicts: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRequest<'a> {
    pub v: u8,
    pub request_id: &'a str,
    pub op: &'a str,
    pub args: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWorkerMessage {
    v: u8,
    request_id: String,
    #[serde(rename = "type")]
    kind: String,
    ok: Option<bool>,
    data: Option<Value>,
    error: Option<Issue>,
    operation_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum WorkerMessage {
    Reply { request_id: String, result: Result<Value, Issue> },
    Progress { request_id: String, operation_id: String, data: Progress },
}

fn depth(value: &Value, current: usize) -> usize {
    match value {
        Value::Array(values) => values.iter().map(|v| depth(v, current + 1)).max().unwrap_or(current),
        Value::Object(values) => values.values().map(|v| depth(v, current + 1)).max().unwrap_or(current),
        _ => current,
    }
}

pub fn parse_worker_line(bytes: &[u8]) -> Result<WorkerMessage, Issue> {
    if bytes.len() > MAX_LINE_BYTES {
        return Err(Issue::worker("worker response exceeded the 16 MiB limit"));
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|e| Issue::worker(format!("worker returned invalid JSON: {e}")))?;
    if depth(&value, 1) > MAX_JSON_DEPTH {
        return Err(Issue::worker("worker response exceeded the JSON nesting limit"));
    }
    let raw: RawWorkerMessage = serde_json::from_value(value)
        .map_err(|e| Issue::worker(format!("worker response did not match the protocol: {e}")))?;
    if raw.v != PROTOCOL_VERSION || raw.request_id.is_empty() {
        return Err(Issue::worker("worker response has an invalid version or request id"));
    }
    match raw.kind.as_str() {
        "reply" => {
            if raw.operation_id.is_some() {
                return Err(Issue::worker("reply contained progress-only fields"));
            }
            match (raw.ok, raw.data, raw.error) {
                (Some(true), Some(data), None) => Ok(WorkerMessage::Reply { request_id: raw.request_id, result: Ok(data) }),
                (Some(false), None, Some(error)) => {
                    if !is_english(&error.message_en) {
                        return Err(Issue::worker("worker issue has no usable English message"));
                    }
                    Ok(WorkerMessage::Reply { request_id: raw.request_id, result: Err(error) })
                }
                _ => Err(Issue::worker("reply contained an invalid data/error combination")),
            }
        }
        "progress" => {
            if raw.ok.is_some() || raw.error.is_some() {
                return Err(Issue::worker("progress contained reply-only fields"));
            }
            let operation_id = raw.operation_id.filter(|v| !v.is_empty())
                .ok_or_else(|| Issue::worker("progress omitted operationId"))?;
            let data: Progress = serde_json::from_value(raw.data.ok_or_else(|| Issue::worker("progress omitted data"))?)
                .map_err(|e| Issue::worker(format!("invalid progress payload: {e}")))?;
            if matches!((data.completed, data.total), (Some(completed), Some(total)) if completed > total) {
                return Err(Issue::worker("progress completed count exceeded total"));
            }
            Ok(WorkerMessage::Progress { request_id: raw.request_id, operation_id, data })
        }
        _ => Err(Issue::worker("worker returned an unknown message type")),
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmptyArgs {}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GameRootArgs { game_root: String }
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackRootArgs { pack_root: String }
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanInstallArgs { game_root: String, pack_root: String, categories: Vec<Category>, revision: u64 }
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanRestoreArgs { game_root: String, source_id: String, revision: u64 }
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanSchemeArgs { game_root: String, file: String, revision: u64 }

/// A skin is addressed by shape plus the catalog pair; the engine refuses a pair that is not
/// in the catalog for that shape, or already equipped.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanEnemyArgs { game_root: String, shape: EnemyShape, model: String, skin: String, revision: u64 }

/// `model`/`skin` are game content (the Skin Browser's own strings), never a path: bounded and
/// control-character-free, matching how the catalog rows in `kvk-enemy.ps1` are written.
fn validate_enemy_skin_string(value: &str) -> Result<(), Issue> {
    let invalid = value.is_empty() || value.chars().count() > 64 || value.chars().any(|c| c.is_control());
    if invalid {
        return Err(Issue::new(ErrorCode::EngineError, "皮肤名称无效。", "The skin name is not valid."));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanCrosshairArgs { game_root: String, file: String, png_base64: String, revision: u64 }

/// Applies the saved Profile named by `id`: its scheme, audio and enemy references are resolved
/// against what is installed and merged into one settings-file edit. Never the open editor's
/// draft -- the id is all the UI sends.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanProfileApplyArgs { game_root: String, id: String, revision: u64 }

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportFileArgs { directory: String, file_name: String, base64: String, game_root: String }

/// What a file import adds to the game: a theme JSON or a sound.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileAddKind { Theme, Sound }

/// An import names its source by path and the worker reads it: the file is copied byte for
/// byte, so the UI never holds bytes it could alter. The hash pins what the player previewed.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanFileAddArgs { game_root: String, kind: FileAddKind, source_path: String, source_sha256: String, file: String, revision: u64 }

/// A crosshair is addressed by file name inside the game's own crosshairs directory.
fn validate_crosshair_file_name(file: &str) -> Result<(), Issue> {
    let lower = file.to_ascii_lowercase();
    // Measured as the engine measures it: characters of the whole name, .png included.
    // A byte limit here cut Chinese names short.
    let invalid = file.len() < 5
        || file.encode_utf16().count() > 128
        || !lower.ends_with(".png")
        || file.chars().any(|c| c.is_control() || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        || file.starts_with('.')
        || file.ends_with(['.', ' ']);
    if invalid {
        return Err(Issue::new(ErrorCode::InvalidPath, "准星文件名无效。", "The crosshair file name is not valid."));
    }
    Ok(())
}

/// The header itself is re-validated by the worker; this bounds what may be sent at all.
fn validate_crosshair_base64(encoded: &str) -> Result<(), Issue> {
    if encoded.is_empty() || encoded.len() % 4 != 0 || encoded.len() > 2796204 {
        return Err(Issue::new(ErrorCode::EngineError, "准星 PNG 编码无效或超出大小限制。", "The crosshair PNG encoding is invalid or over the size limit."));
    }
    if !encoded.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=') {
        return Err(Issue::new(ErrorCode::EngineError, "准星 PNG 编码无效。", "The crosshair PNG encoding is invalid."));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioEvent { Kill, Spawn, MbsGood, MbsOkay, MbsBad, MbsChangeNow }

impl AudioEvent {
    /// Kill and Spawn keep an ordered list; the MBS events hold exactly one name.
    fn takes_list(self) -> bool { matches!(self, AudioEvent::Kill | AudioEvent::Spawn) }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanAudioArgs { game_root: String, event: AudioEvent, names: Vec<String>, revision: u64 }

/// A sound is bound by the file's base name, so it must not be able to name a path or a list.
fn validate_sound_name(name: &str) -> Result<(), Issue> {
    let invalid = name.is_empty()
        || name.len() > 200
        || name.chars().any(|c| c.is_control() || matches!(c, ';' | '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'));
    if invalid {
        return Err(Issue::new(ErrorCode::InvalidPath, "音效名称无效。", "The sound name is not valid."));
    }
    Ok(())
}

/// A theme is selected by file name inside the game's own Themes directory, so the
/// name must not be able to reach outside it.
fn validate_theme_file_name(file: &str) -> Result<(), Issue> {
    // 255 UTF-16 units is what NTFS allows for one name. Counting bytes refused long Chinese names.
    let invalid = file.is_empty()
        || file.encode_utf16().count() > 255
        || !file.to_ascii_lowercase().ends_with(".json")
        || file.chars().any(|c| c.is_control() || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        || file.starts_with('.')
        || file.ends_with(['.', ' ']);
    if invalid {
        return Err(Issue::new(ErrorCode::InvalidPath, "主题文件名无效。", "The theme file name is not valid."));
    }
    Ok(())
}

/// A sound is bound by its stem, so the stem obeys the binding rules and the extension is fixed.
fn validate_sound_file_name(file: &str) -> Result<(), Issue> {
    let invalid = Issue::new(ErrorCode::InvalidPath, "音效文件名无效。", "The sound file name is not valid.");
    let Some((stem, extension)) = file.rsplit_once('.') else { return Err(invalid) };
    if !(extension.eq_ignore_ascii_case("wav") || extension.eq_ignore_ascii_case("ogg"))
        || file.starts_with(['.', ' ']) || stem.ends_with(['.', ' ']) {
        return Err(invalid);
    }
    validate_sound_name(stem).map_err(|_| invalid)
}

fn normalize<T>(args: Value) -> Result<Value, Issue>
where T: for<'de> Deserialize<'de> + Serialize {
    let parsed: T = serde_json::from_value(args)
        .map_err(|e| Issue::plain(ErrorCode::EngineError, format!("invalid request arguments: {e}")))?;
    serde_json::to_value(parsed).map_err(|e| Issue::plain(ErrorCode::EngineError, e.to_string()))
}

pub fn validate_read(op: &str, args: Value) -> Result<Value, Issue> {
    match op {
        "discover" | "gameState" => normalize::<EmptyArgs>(args),
        "locate" | "backups" | "schemeList" => normalize::<GameRootArgs>(args),
        "catalog" => normalize::<PackRootArgs>(args),
        "planInstall" => normalize::<PlanInstallArgs>(args),
        "planRestore" => normalize::<PlanRestoreArgs>(args),
        "planScheme" => {
            let args = normalize::<PlanSchemeArgs>(args)?;
            validate_theme_file_name(args["file"].as_str().unwrap_or_default())?;
            Ok(args)
        }
        "audioList" => normalize::<GameRootArgs>(args),
        "crosshairList" => normalize::<GameRootArgs>(args),
        "enemyList" => normalize::<GameRootArgs>(args),
        "planEnemy" => {
            let args = normalize::<PlanEnemyArgs>(args)?;
            validate_enemy_skin_string(args["model"].as_str().unwrap_or_default())?;
            validate_enemy_skin_string(args["skin"].as_str().unwrap_or_default())?;
            Ok(args)
        }
        "planProfileApply" => {
            let args = normalize::<PlanProfileApplyArgs>(args)?;
            // The same Profile id rule as profileRead: a safe file name, never the UI's draft.
            super::profiles::safe_id(&args["id"])
                .map_err(|fault| Issue::new(ErrorCode::InvalidPath, fault.zh, fault.en))?;
            Ok(args)
        }
        "exportFile" => {
            let args = normalize::<ExportFileArgs>(args)?;
            // The worker re-checks all of this; the UI must not be able to send a path.
            validate_crosshair_file_name(args["fileName"].as_str().unwrap_or_default())?;
            validate_crosshair_base64(args["base64"].as_str().unwrap_or_default())?;
            Ok(args)
        }
        "planFileAdd" => {
            let args = normalize::<PlanFileAddArgs>(args)?;
            let file = args["file"].as_str().unwrap_or_default();
            let kind: FileAddKind = serde_json::from_value(args["kind"].clone())
                .map_err(|_| Issue::plain(ErrorCode::EngineError, "invalid request arguments"))?;
            let asset_kind = match kind {
                FileAddKind::Theme => { validate_theme_file_name(file)?; "scheme" }
                FileAddKind::Sound => { validate_sound_file_name(file)?; "audio" }
            };
            // The engine measures the whole name in characters, as it does for crosshairs.
            if file.encode_utf16().count() > 128 {
                return Err(Issue::new(ErrorCode::InvalidPath, "文件名太长：不能超过 128 个字符。", "The file name is too long: at most 128 characters."));
            }
            // The source obeys the same rules as any local asset the UI may read.
            super::profiles::asset_file(&Value::from(asset_kind), &args["sourcePath"])
                .map_err(|fault| Issue::new(ErrorCode::InvalidPath, fault.zh, fault.en))?;
            let hash = args["sourceSha256"].as_str().unwrap_or_default();
            if hash.len() != 64 || !hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
                return Err(Issue::new(ErrorCode::EngineError, "来源文件的校验值无效。", "The source file's checksum is not valid."));
            }
            Ok(args)
        }
        "planCrosshairAdd" => {
            let args = normalize::<PlanCrosshairArgs>(args)?;
            validate_crosshair_file_name(args["file"].as_str().unwrap_or_default())?;
            validate_crosshair_base64(args["pngBase64"].as_str().unwrap_or_default())?;
            Ok(args)
        }
        "planCrosshair" => {
            let args = normalize::<PlanCrosshairArgs>(args)?;
            validate_crosshair_file_name(args["file"].as_str().unwrap_or_default())?;
            validate_crosshair_base64(args["pngBase64"].as_str().unwrap_or_default())?;
            Ok(args)
        }
        "planAudio" => {
            let args = normalize::<PlanAudioArgs>(args)?;
            let names = args["names"].as_array().ok_or_else(|| Issue::plain(ErrorCode::EngineError, "invalid request arguments"))?;
            for name in names {
                validate_sound_name(name.as_str().unwrap_or_default())?;
            }
            let event: AudioEvent = serde_json::from_value(args["event"].clone())
                .map_err(|_| Issue::plain(ErrorCode::EngineError, "invalid request arguments"))?;
            if !event.takes_list() && names.len() != 1 {
                return Err(Issue::new(ErrorCode::EngineError, "该音效事件只能绑定一个文件。", "This sound event can only be bound to one file."));
            }
            Ok(args)
        }
        _ => Err(Issue::plain(ErrorCode::EngineError, "unsupported installer read operation")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shared parity table (ROADMAP I18N-NAMES): the same ten cases, in the same order and
    /// with the same verdicts, as `packages/app/tests/installer/i18n/english-text.test.ts` and
    /// `scripts/installer/tests/engine.test.ps1` ("the English-safe parity table …"). Changing one
    /// row means changing all three.
    const PARITY: &[(&str, &str, bool)] = &[
        ("plain English", "The source file was not found.", true),
        ("Chinese sentence", "找不到来源文件。", false),
        ("English with a quoted Chinese name", "The Themes folder already has \"中文主题.json\".", true),
        ("quoted Chinese plus Chinese outside", "The Themes folder already has \"中文主题.json\"，请换一个文件名。", false),
        ("unbalanced quote", "The Themes folder already has \"中文主题.json", false),
        ("empty", "   ", false),
        ("full-width punctuation outside quotes", "The source file was not found！", false),
        ("only quotes", "\"\"", true),
        ("a closed span then an unclosed one", "a \"中\" b \"中", false),
        ("a newline inside a span", "\"中\n文\" ok", true),
    ];

    #[test]
    fn english_parity_table() {
        for (name, text, english) in PARITY {
            assert_eq!(is_english(text), *english, "{name}: {text:?}");
        }
    }

    #[test]
    fn has_cjk_stays_the_raw_character_test() {
        assert!(has_cjk("The Themes folder already has \"中文主题.json\"."));
        assert!(!has_cjk("plain English"));
    }

    /// End-to-end (requirement 3): a refusal that names a Chinese file passes every English
    /// gate — the worker-issue check, `errorsEn` in a final report, and `Issue::new`'s
    /// debug assertion.
    #[test]
    fn a_refusal_naming_a_chinese_file_passes_validation() {
        let en = "The Themes folder already has \"中文主题.json\", and adding never overwrites it. Choose another file name.";
        let zh = "Themes 文件夹里已经有「中文主题.json」，添加不会覆盖它；请换一个文件名。";
        let issue = Issue::new(ErrorCode::EngineError, zh, en);
        assert_eq!(issue.message_en, en);

        let reply = serde_json::json!({
            "v": PROTOCOL_VERSION, "requestId": "r-1", "type": "reply", "ok": false,
            "error": {"code": "ENGINE_ERROR", "message": zh, "messageEn": en, "path": null},
        });
        match parse_worker_line(reply.to_string().as_bytes()).expect("a quoted Chinese name is English-safe") {
            WorkerMessage::Reply { result: Err(error), .. } => assert_eq!(error.message_en, en),
            other => panic!("unexpected message: {other:?}"),
        }

        let untranslated = serde_json::json!({
            "v": PROTOCOL_VERSION, "requestId": "r-2", "type": "reply", "ok": false,
            "error": {"code": "ENGINE_ERROR", "message": zh, "messageEn": zh, "path": null},
        });
        assert!(parse_worker_line(untranslated.to_string().as_bytes()).is_err(), "an untranslated Chinese sentence is still refused");

        let execution = Execution {
            status: Outcome::RolledBack, batch_id: None, items: vec![],
            errors: vec![zh.to_string()], errors_en: vec![en.to_string()],
        };
        validate_execution(&execution).expect("errorsEn may name a Chinese file");
        let bad = Execution { errors_en: vec![zh.to_string()], ..execution };
        assert!(validate_execution(&bad).is_err(), "an untranslated errorsEn line is still refused");
    }
}
