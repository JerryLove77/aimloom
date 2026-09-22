import { decodeText } from "../theme/decode.js"
import type { JsonValue, Section, SettingsPatch } from "../types.js"

export type SettingsDoc = { raw: Record<string, JsonValue> }

export function parseSettings(bytes: Uint8Array): SettingsDoc {
  const { text } = decodeText(bytes)
  const raw = JSON.parse(text) as unknown
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("PrimaryUserSettings.json 顶层不是对象")
  }
  return { raw: raw as Record<string, JsonValue> }
}

export function readKey(doc: SettingsDoc, section: Section, key: string): JsonValue | undefined {
  const bucket = doc.raw[section]
  if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) return undefined
  return (bucket as Record<string, JsonValue>)[key]
}

/**
 * 应用补丁，返回新文档。未在 patch 中出现的键——包括六个 section 之外的
 * version / characterModelOverride / currentlySelectedBoundingBoxType——原样保留。
 */
export function applyPatch(doc: SettingsDoc, patch: SettingsPatch): SettingsDoc {
  const next: Record<string, JsonValue> = { ...doc.raw }

  for (const [section, entries] of Object.entries(patch) as [Section, Record<string, JsonValue>][]) {
    if (!entries) continue
    const existing = next[section]
    const base =
      typeof existing === "object" && existing !== null && !Array.isArray(existing)
        ? (existing as Record<string, JsonValue>)
        : {}
    next[section] = { ...base, ...entries }
  }

  return { raw: next }
}

/**
 * 序列化。用 tab 缩进贴近游戏原始风格。
 *
 * 注意：JSON.stringify 会把浮点数输出为最短往返表示
 * （如 0.40000000596046448 → 0.4000000059604645），字符串不同但
 * IEEE754 双精度值完全相同，游戏读取结果一致。断言请比较解析后的值。
 */
export function serializeSettings(doc: SettingsDoc): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc.raw, null, "\t") + "\n")
}
