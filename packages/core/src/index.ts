export type {
  AudioLevels,
  Encoding,
  EnemyAppearance,
  JsonValue,
  Profile,
  Rgba,
  Section,
  SettingsPatch,
  SkyAppearance,
  SoundBinding,
  Surface,
  Theme,
  ThemeSource,
  Vec3,
} from "./types.js"

export type { FileStat, PlatformAdapter } from "./platform/adapter.js"
export { NodeAdapter } from "./platform/node-adapter.js"

export { decodeText, detectEncoding } from "./theme/decode.js"
export { parseTheme, type ParseResult } from "./theme/parse.js"
export * from "./scheme/index.js"
export { scanThemes, type ScanFailure, type ScanResult } from "./theme/scan.js"

export { B, C, F, GATED_KEYS, I, NEVER_WRITE, S, SOUND_KEYS, THEME_KEYS, V } from "./settings/keys.js"
export { filterPatch } from "./settings/field-policy.js"
export {
  applyPatch,
  parseSettings,
  readKey,
  serializeSettings,
  type SettingsDoc,
} from "./settings/settings-doc.js"
export { themeToPatch } from "./settings/theme-applier.js"
export * from "./enemy/index.js"
export {
  listSounds,
  readAudioLevels,
  readSoundBinding,
  soundsToPatch,
} from "./settings/sound-binder.js"

export { BackupManager, type BackupEntry, type BackupFile } from "./safety/backup.js"
export { applySettingsPatch, type ApplyOptions, type ApplyResult } from "./safety/apply.js"
export { findMissingSounds, partitionByExistence, themeFileExists } from "./safety/integrity.js"

export { resolveCollision, sanitizeFileName } from "./install/naming.js"
export {
  installTheme,
  type InstallThemeOptions,
  type InstallThemeResult,
} from "./install/install-theme.js"

export { ProfileStore, hashBytes, type CaptureOptions } from "./profile/profile-store.js"

export {
  inspectPack,
  installPack,
  type InstallReport,
  type InstallSelection,
  type InstallTargets,
  type PackManifest,
  type PackThemeEntry,
} from "./pack/importer.js"
