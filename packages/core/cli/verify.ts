/**
 * 内核端到端验证脚本。
 *
 *   npm run verify -- <游戏目录或仿真目录>
 *
 * 目录需含：
 *   FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json
 *   FPSAimTrainer/Saved/SaveGames/Themes/
 *   FPSAimTrainer/sounds/
 *
 * 脚本对该目录做真实读写，请先在副本上运行。
 */
import { join } from "node:path"
import {
  BackupManager,
  NodeAdapter,
  SOUND_KEYS,
  THEME_KEYS,
  applySettingsPatch,
  findMissingSounds,
  listSounds,
  parseSettings,
  readKey,
  scanThemes,
  soundsToPatch,
  themeToPatch,
} from "../src/index.js"

const root = process.argv[2]
if (!root) {
  console.error("用法: npm run verify -- <游戏目录或仿真目录>")
  process.exit(1)
}

const saveGames = join(root, "FPSAimTrainer", "Saved", "SaveGames")
const settingsPath = join(saveGames, "PrimaryUserSettings.json")
const themesDir = join(saveGames, "Themes")
const soundsDir = join(root, "FPSAimTrainer", "sounds")

const adapter = new NodeAdapter()
const backup = new BackupManager(adapter, join(root, ".kvk-backups"))

const FEEL_KEYS = [
  ["floatSettings", "EFloatSettingId::XSens"],
  ["floatSettings", "EFloatSettingId::YSens"],
  ["floatSettings", "EFloatSettingId::FOV"],
  ["floatSettings", "EFloatSettingId::CustomYaw"],
  ["integerSettings", "EIntegerSettingId::DPI"],
  ["stringSettings", "EStringSettingId::FOVScaleString"],
  ["stringSettings", "EStringSettingId::SensScaleString"],
] as const

async function snapshotFeel(): Promise<Record<string, unknown>> {
  const doc = parseSettings(await adapter.readFile(settingsPath))
  const out: Record<string, unknown> = {}
  for (const [section, key] of FEEL_KEYS) out[key.split("::")[1]!] = readKey(doc, section, key)
  return out
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

const feelBefore = await snapshotFeel()
console.log("手感设置（写入前）:", feelBefore)

// 1. 扫描 theme
const scan = await scanThemes(adapter, themesDir)
console.log(`\n扫描 theme: ${scan.themes.length} 成功, ${scan.failures.length} 失败`)
for (const f of scan.failures) console.log(`  失败: ${f.path} — ${f.error}`)

const target = scan.themes.find((t) => t.name.length > 0)
if (!target) fail("没有可用的 theme，中止")

// 2. 列音效
const sounds = await listSounds(adapter, soundsDir)
console.log(`可用音效: ${sounds.length}`)

// 3. 应用背景
console.log(`\n应用背景: ${target.name}`)
const themeResult = await applySettingsPatch({
  adapter,
  backup,
  settingsPath,
  patch: themeToPatch(target),
  allow: THEME_KEYS,
  label: `verify: apply ${target.name}`,
})
if (!themeResult.ok) {
  fail(`[${themeResult.reason}] ${themeResult.message}（已回滚: ${themeResult.rolledBack}）`)
}
console.log(`  写入 ${themeResult.written.length} 个键，备份 id = ${themeResult.backupId}`)
if (themeResult.unknownKeys.length > 0) {
  console.log(`  ⚠ ${themeResult.unknownKeys.length} 个键在存档中不存在，已跳过（映射表可能已过时）:`)
  for (const k of themeResult.unknownKeys) console.log(`      ${k}`)
}

// 4. 应用音效
const pick = sounds[0]
if (pick) {
  const binding = {
    killConfirmed: pick,
    spawn: null,
    mbsGood: null,
    mbsOkay: null,
    mbsBad: null,
    mbsChangeNow: null,
  }
  const missing = await findMissingSounds(adapter, soundsDir, binding)
  if (missing.length > 0) fail(`引用完整性检查失败，缺失音效: ${missing.join(", ")}`)

  console.log(`\n应用音效: ${pick}`)
  const soundResult = await applySettingsPatch({
    adapter,
    backup,
    settingsPath,
    patch: soundsToPatch(binding, { hitVolume: 0.8, hitPitch: 1, critVolume: 1, critPitch: 1 }),
    allow: SOUND_KEYS,
    label: `verify: apply sound ${pick}`,
  })
  if (!soundResult.ok) {
    fail(`[${soundResult.reason}] ${soundResult.message}（已回滚: ${soundResult.rolledBack}）`)
  }
  console.log(`  写入 ${soundResult.written.length} 个键`)
}

// 5. 幂等性
console.log("\n幂等性检查: 再次应用同一个背景…")
const firstPass = JSON.stringify(parseSettings(await adapter.readFile(settingsPath)).raw)
await applySettingsPatch({
  adapter,
  backup,
  settingsPath,
  patch: themeToPatch(target),
  allow: THEME_KEYS,
  label: "verify: idempotence",
})
const secondPass = JSON.stringify(parseSettings(await adapter.readFile(settingsPath)).raw)
if (firstPass !== secondPass) fail("同一个背景应用两次结果不一致，幂等性被破坏")
console.log("  两次结果一致 ✓")

// 6. 手感设置未变
const feelAfter = await snapshotFeel()
if (JSON.stringify(feelBefore) !== JSON.stringify(feelAfter)) {
  console.error("手感设置被改动，这是严重缺陷")
  console.error("  写入前:", feelBefore)
  console.error("  写入后:", feelAfter)
  fail("手感设置未变: 否")
}
console.log("\n手感设置未变: 是 ✓")

// 7. 回滚
console.log("回滚到出厂快照…")
await backup.restorePristine()
const restored = parseSettings(await adapter.readFile(settingsPath))
console.log(`  当前 theme: ${readKey(restored, "stringSettings", "EStringSettingId::CurrentThemeName")}`)

console.log("\n全部通过 ✓")
