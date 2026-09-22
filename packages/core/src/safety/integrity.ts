import type { PlatformAdapter } from "../platform/adapter.js"
import type { JsonValue, Section, SettingsPatch, SoundBinding } from "../types.js"
import type { SettingsDoc } from "../settings/settings-doc.js"

const SECTIONS: Section[] = [
  "booleanSettings",
  "integerSettings",
  "floatSettings",
  "stringSettings",
  "vectorSettings",
  "colorSettings",
]

const joinPath = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, "")}/${name}`

/**
 * C4：返回绑定中在 sounds/ 里找不到对应文件的音效名。
 * 绑定一个不存在的音效会让游戏静音或回退默认，且用户无从得知原因。
 */
export async function findMissingSounds(
  adapter: PlatformAdapter,
  soundsDir: string,
  binding: SoundBinding,
): Promise<string[]> {
  const wanted = Object.values(binding).filter((v): v is string => typeof v === "string" && v !== "")
  if (wanted.length === 0) return []

  let available: Set<string>
  try {
    available = new Set(
      (await adapter.listDir(soundsDir))
        .filter((f) => /\.(ogg|wav)$/i.test(f))
        .map((f) => f.replace(/\.(ogg|wav)$/i, "").toLowerCase()),
    )
  } catch {
    return wanted // 目录读不到，视为全部缺失，交由调用方报错
  }

  return wanted.filter((name) => !available.has(name.toLowerCase()))
}

/** C4：确认 theme 文件存在（大小写不敏感，与 Windows/macOS 行为一致） */
export async function themeFileExists(
  adapter: PlatformAdapter,
  themesDir: string,
  themeName: string,
): Promise<boolean> {
  if (await adapter.exists(joinPath(themesDir, `${themeName}.json`))) return true
  try {
    const target = `${themeName.toLowerCase()}.json`
    return (await adapter.listDir(themesDir)).some((f) => f.toLowerCase() === target)
  } catch {
    return false
  }
}

/**
 * C5：把 patch 拆成「目标文件里已存在的键」与「不存在的键」。
 *
 * 游戏更新可能重命名或删除设置键（EnemyMetalic 这个拼写错误随时可能被修正）。
 * 新增一个游戏不认识的键是无害的死数据，但会掩盖「映射表已过时」这一事实，
 * 因此默认跳过并向用户报告，让问题可见。
 */
export function partitionByExistence(
  doc: SettingsDoc,
  patch: SettingsPatch,
): { known: SettingsPatch; unknown: string[] } {
  const known: SettingsPatch = {}
  const unknown: string[] = []

  for (const section of SECTIONS) {
    const entries = patch[section]
    if (!entries) continue

    const bucket = doc.raw[section]
    const existing =
      typeof bucket === "object" && bucket !== null && !Array.isArray(bucket)
        ? (bucket as Record<string, JsonValue>)
        : {}

    const kept: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(entries)) {
      if (key in existing) kept[key] = value
      else unknown.push(key)
    }
    if (Object.keys(kept).length > 0) known[section] = kept
  }

  return { known, unknown }
}
