import type { JsonValue, Section, SettingsPatch } from "../types.js"
import { NEVER_WRITE } from "./keys.js"

const SECTIONS: Section[] = [
  "booleanSettings",
  "integerSettings",
  "floatSettings",
  "stringSettings",
  "vectorSettings",
  "colorSettings",
]

/**
 * 双保险过滤：键必须在 allow 白名单内，且必须不在 NEVER_WRITE 黑名单内。
 * 返回新对象，不修改入参。被剔除的键名收集在 rejected 中供日志与测试断言。
 */
export function filterPatch(
  patch: SettingsPatch,
  allow: ReadonlySet<string>,
): { patch: SettingsPatch; rejected: string[] } {
  const out: SettingsPatch = {}
  const rejected: string[] = []

  for (const section of SECTIONS) {
    const entries = patch[section]
    if (!entries) continue
    const kept: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(entries)) {
      if (NEVER_WRITE.has(key) || !allow.has(key)) {
        rejected.push(key)
        continue
      }
      kept[key] = value
    }
    if (Object.keys(kept).length > 0) out[section] = kept
  }

  return { patch: out, rejected }
}
