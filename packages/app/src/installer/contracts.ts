import type { Lang } from '../i18n'
export type Category = 'themes'|'sounds'|'crosshairs'|'ui'|'palette'|'primary'
export type GameState = 'closed'|'running'|'unknown'
export type Phase = 'preparing'|'protecting'|'installing'|'verifying'|'restoring'|'rolling-back'
export type Outcome = 'completed'|'no-change'|'rolled-back'|'recovery-required'|'restored'
export type ErrorCode = 'INVALID_PATH'|'INVALID_PACK'|'GAME_RUNNING'|'GAME_STATE_UNKNOWN'|
  'PLAN_STALE'|'PLAN_MISSING'|'BACKUP_INVALID'|'CONFLICT'|'UNOWNED_FILE'|
  'RECOVERY_REQUIRED'|'BUSY'|'UNSUPPORTED_PLATFORM'|'WORKER_UNAVAILABLE'|'ENGINE_ERROR'
export interface Issue { code: ErrorCode; message: string; messageEn: string; path: string|null }
export interface Location {
  gameRoot: string; backupRoot: string; gameState: GameState
}
export interface CatalogEntry { category: Category; count: number }
export interface Discovery { candidates: string[]; defaultPack: string|null }
export interface Catalog { packRoot: string; categories: CatalogEntry[]; skipped: string[] }
export interface FileRow {
  key: string; category: Category; source: string|null; target: string
  action: 'create'|'replace'|'skip'|'restore'|'delete'
  conflict: boolean; unowned: boolean
}
export interface Preview {
  planId: string; revision: number; kind: 'install'|'restore'
  location: Location; packRoot: string|null; categories: Category[]
  sourceId: string|null; rows: FileRow[]; skipped: string[]
}
export interface Backup {
  id: string; createdAt: string; kind: 'install'|'restore'
  status: 'prepared'|'applying'|'completed'|'rolled-back'|'recovery-required'
  categories: Category[]; fileCount: number
}
export interface BackupIndex { location: Location; records: Backup[]; hasPristine: boolean }
export interface Progress {
  phase: Phase; completed: number|null; total: number|null
  currentFile: string|null; batchId: string|null
}
export interface Execution {
  status: Outcome; batchId: string|null
  items: { key: string; target: string; state: string }[]; errors: string[]
  /** English for each line of `errors`, in the same order. */
  errorsEn: string[]
}
export interface Job {
  operationId: string; planId: string
  state: 'running'|'finished'|'failed'|'unknown'|'reconciled'
  progress: Progress|null; result: Execution|null; error: Issue|null
}
export interface Reconciliation { job: Job; backups: BackupIndex|null }
export type ExecuteRequest = {
  operationId: string; planId: string; confirmation: 'install'|'restore'
  allowConflicts: boolean
}
export interface SchemeTheme {
  name: string | null
  file: string
  path: string
  readable: boolean
  duplicateName: boolean
}
export interface SchemeList {
  directory: string
  current: string | null
  themes: SchemeTheme[]
}
export interface PlanSchemeRequest { gameRoot: string; file: string; revision: number }

export type AudioEvent = 'kill' | 'spawn' | 'mbsGood' | 'mbsOkay' | 'mbsBad' | 'mbsChangeNow'
export interface InstalledSound { name: string; file: string; path: string; ambiguous: boolean }
/** Kill and Spawn keep an ordered list; the four MBS events hold exactly one name. */
export interface AudioBindings {
  kill: string[]; spawn: string[]
  mbsGood: string[]; mbsOkay: string[]; mbsBad: string[]; mbsChangeNow: string[]
}
export interface AudioList { directory: string; sounds: InstalledSound[]; bindings: AudioBindings }
export interface PlanAudioRequest { gameRoot: string; event: AudioEvent; names: string[]; revision: number }

export interface InstalledCrosshair { name: string; file: string; path: string }
export interface CrosshairList { directory: string; crosshairs: InstalledCrosshair[] }
export interface PlanCrosshairRequest { gameRoot: string; file: string; pngBase64: string; revision: number }
/** The game's three Skin Browser shapes, on the wire. Cylindrical is the humanoid box. */
export type EnemyShape = 'cylindrical' | 'cuboid' | 'spheroid'
/** A skin's identity in the settings file: the two strings written together, never alone. */
export interface EnemySkinChoice { model: string; skin: string }
/** One row of the game's own Skin Browser catalog. `shapes` names every shape it supports. */
export interface EnemySkin { label: string; model: string; skin: string; shapes: EnemyShape[] }
/** The equipped pair per shape, or null when the settings file has no block for that shape.
 * A pair that is not in the catalog (a future game version) is still returned as it is. */
export interface EnemyCurrent { cylindrical: EnemySkinChoice | null; cuboid: EnemySkinChoice | null; spheroid: EnemySkinChoice | null }
export interface EnemyList { current: EnemyCurrent; skins: EnemySkin[] }
export interface PlanEnemyRequest { gameRoot: string; shape: EnemyShape; model: string; skin: string; revision: number }
/** Applies the saved Profile named by `id` -- never the open editor's draft. */
export interface PlanProfileApplyRequest { gameRoot: string; id: string; revision: number }
/** What an import adds to the game: a theme JSON (used by Scheme) or a sound. */
export type FileAddKind = 'theme' | 'sound'
/** What the native file dialog can be asked to pick. A crosshair PNG is read, not imported by path. */
export type PickFileKind = FileAddKind | 'crosshair'
/**
 * An import names its source by path; the worker reads it and copies it byte for byte, so the
 * UI never holds bytes it could alter. `sourceSha256` is the hash of what the player previewed.
 */
export interface PlanFileAddRequest { gameRoot: string; kind: FileAddKind; sourcePath: string; sourceSha256: string; file: string; revision: number }
export interface ExportFileRequest { directory: string; fileName: string; base64: string; gameRoot: string }
export interface ExportedFile { path: string; bytes: number; sha256: string }

/** What the player typed, plus what the App knows about itself. Mirrors Rust's `ReportInput`. */
export interface ReportInput {
  description: string | null
  contact: string | null
  attachLog: boolean
  account: SteamAccount | null
  langChoice: string
  lang: Lang
  gameFound: boolean
}
export interface SteamAccount { steamId: string; name: string }
/** Exactly the bytes that `reportSend` will transmit, with the hash that ties the two together. */
export interface ReportPreview { text: string; sha256: string; bytes: number }
/** The line a build or an offered update belongs to. Mirrors Rust's `channel()`/`AppInfo`. */
export type Channel = 'stable' | 'beta' | 'test'
/** What `installer_app_info` answers -- never fails; on any doubt, the compiled version and `stable`. */
export interface AppInfo { label: string; channel: Channel }
/**
 * `latest` is null whenever no answer could be trusted -- offline, a non-200, an unparsable body.
 * An update check never becomes an error the player has to dismiss. `channel` says which line
 * `latest` belongs to (`stable` when nothing newer was offered either, so the "up to date" line
 * still has a stable version to show).
 */
export interface UpdateCheck { latest: string | null; newer: boolean; channel: 'stable' | 'beta' }

export interface InstallerBridge {
  discover(): Promise<Discovery>
  locate(gameRoot: string): Promise<Location>
  catalog(packRoot: string): Promise<Catalog>
  backups(gameRoot: string): Promise<BackupIndex>
  gameState(): Promise<GameState>
  planInstall(input: {gameRoot: string; packRoot: string; categories: Category[]; revision: number}): Promise<Preview>
  planRestore(input: {gameRoot: string; sourceId: string; revision: number}): Promise<Preview>
  schemeList(gameRoot: string): Promise<SchemeList>
  planScheme(input: PlanSchemeRequest): Promise<Preview>
  audioList(gameRoot: string): Promise<AudioList>
  planAudio(input: PlanAudioRequest): Promise<Preview>
  crosshairList(gameRoot: string): Promise<CrosshairList>
  planCrosshair(input: PlanCrosshairRequest): Promise<Preview>
  planCrosshairAdd(input: PlanCrosshairRequest): Promise<Preview>
  planFileAdd(input: PlanFileAddRequest): Promise<Preview>
  execute(input: ExecuteRequest): Promise<Job>
  job(operationId: string): Promise<Job>
  reconcile(operationId: string): Promise<Reconciliation>
  /** The native dialog's title and filter follow `lang`. */
  pickFolder(kind: 'game'|'pack'|'export', lang: Lang): Promise<string|null>
  pickFile(kind: PickFileKind, lang: Lang): Promise<string|null>
  exportFile(input: ExportFileRequest): Promise<ExportedFile>
  enemyList(gameRoot: string): Promise<EnemyList>
  planEnemy(input: PlanEnemyRequest): Promise<Preview>
  /** What is applied is always the saved Profile JSON, never an open editor's draft. */
  planProfileApply(input: PlanProfileApplyRequest): Promise<Preview>
  openBackup(gameRoot: string): Promise<void>
  /** Builds the report and keeps it natively; `reportSend` transmits those exact bytes. */
  reportPreview(input: ReportInput): Promise<ReportPreview>
  /** Sends the kept report. A hash that no longer matches the kept one is `PLAN_STALE`. */
  reportSend(sha256: string): Promise<{ number: string }>
  accountResolve(url: string): Promise<SteamAccount>
  /** `beta` is the player's Join-the-beta switch; considers the beta line only when it is true. */
  updateCheck(beta: boolean): Promise<UpdateCheck>
  openLogs(): Promise<void>
  /** Takes only the language and channel: the App builds the address, never the UI. */
  openDownload(lang: Lang, channel: 'stable' | 'beta'): Promise<void>
  /** The App's own label and channel, for the Settings version line. Never fails. */
  appInfo(): Promise<AppInfo>
}

export class InstallerFailure extends Error {
  constructor(public issue: Issue) { super(issue.message); this.name = "InstallerFailure" }
}
