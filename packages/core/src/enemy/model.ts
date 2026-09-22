import { LocalizedError, type EnemyAppearance, type Vec3 } from "../types.js"

export const COLOR_FIELDS = ["headColor", "bodyColor", "headColorOnHit", "bodyColorOnHit", "headColorOnLookAt", "bodyColorOnLookAt"] as const
export const MATERIAL_FIELDS = ["roughness", "metallic", "fullBright"] as const
export const GLOW_FIELDS = ["glowUpHead", "glowUpBody", "glowUpHeadOnHit", "glowUpBodyOnHit", "glowUpHeadOnLookAt", "glowUpBodyOnLookAt"] as const
export const BOOLEAN_FIELDS = ["overrideHead", "overrideBody", "changeOnHit", "changeOnLookAt", "bodyColorAsAttackColor"] as const
export const ENEMY_FIELDS = [...COLOR_FIELDS, ...MATERIAL_FIELDS, ...GLOW_FIELDS, ...BOOLEAN_FIELDS] as const
export type EnemyField = keyof EnemyAppearance
export type EnemySelection = Partial<Omit<EnemyAppearance, typeof COLOR_FIELDS[number]>> &
  Partial<Record<typeof COLOR_FIELDS[number], Vec3 | string>>
export type EnemySource = { kind: "builtin" | "imported" | "custom" | "generated"; provider?: string; prompt?: string }
export type EnemyDocument = {
  schemaVersion: 1
  kind: "enemy-appearance"
  name: string
  appearance: Partial<EnemyAppearance>
  source?: EnemySource
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new LocalizedError(`${path} 必须是 JSON 对象`, `${path} must be a JSON object`)
  }
  return value as Record<string, unknown>
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new LocalizedError(`${path}.${key} 暂不支持`, `${path}.${key} is not supported`)
  }
}
function number(value: unknown, path: string, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new LocalizedError(
      `${path} 必须是 0 到 ${max === Infinity ? "有限正数" : max} 范围内的数值`,
      `${path} must be a value between 0 and ${max === Infinity ? "a finite positive number" : max}`,
    )
  }
  return value
}
export function parseEnemyColor(value: unknown, path = "color"): Vec3 {
  if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) {
    return { x: parseInt(value.slice(1, 3), 16) / 255, y: parseInt(value.slice(3, 5), 16) / 255, z: parseInt(value.slice(5, 7), 16) / 255 }
  }
  const raw = object(value, path)
  onlyKeys(raw, ["x", "y", "z"], path)
  return { x: number(raw.x, `${path}.x`, 1), y: number(raw.y, `${path}.y`, 1), z: number(raw.z, `${path}.z`, 1) }
}

/** Strict at user/provider boundaries. Missing fields stay missing; never silently clamp intent. */
export function validateEnemySelection(value: unknown): Partial<EnemyAppearance> {
  const raw = object(value, "enemy")
  onlyKeys(raw, ENEMY_FIELDS, "enemy")
  const result: Partial<EnemyAppearance> = {}
  for (const field of COLOR_FIELDS) if (Object.hasOwn(raw, field)) result[field] = parseEnemyColor(raw[field], `enemy.${field}`)
  for (const field of MATERIAL_FIELDS) if (Object.hasOwn(raw, field)) result[field] = number(raw[field], `enemy.${field}`, 1)
  for (const field of GLOW_FIELDS) if (Object.hasOwn(raw, field)) result[field] = number(raw[field], `enemy.${field}`)
  for (const field of BOOLEAN_FIELDS) if (Object.hasOwn(raw, field)) {
    if (typeof raw[field] !== "boolean") throw new LocalizedError(`enemy.${field} 必须是布尔值`, `enemy.${field} must be a boolean`)
    result[field] = raw[field]
  }
  return result
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new LocalizedError(`${path} 必须是 1–${max} 字符的文本`, `${path} must be text between 1 and ${max} characters`)
  }
  return value
}

export function parseEnemyDocument(json: string): EnemyDocument {
  if (json.length > 65536) throw new LocalizedError("enemy JSON 超过 64 KiB", "enemy JSON exceeds 64 KiB")
  let value: unknown
  try { value = JSON.parse(json.replace(/^\uFEFF/, "")) } catch { throw new LocalizedError("enemy JSON 格式错误", "enemy JSON is malformed") }
  const raw = object(value, "enemy document")
  onlyKeys(raw, ["schemaVersion", "kind", "name", "appearance", "source"], "enemy document")
  if (raw.schemaVersion !== 1 || raw.kind !== "enemy-appearance") {
    throw new LocalizedError("不支持的 enemy 文件格式或版本", "Unsupported enemy file format or version")
  }
  const result: EnemyDocument = { schemaVersion: 1, kind: "enemy-appearance", name: text(raw.name, "name", 120), appearance: validateEnemySelection(raw.appearance) }
  if (Object.hasOwn(raw, "source")) {
    const source = object(raw.source, "source")
    onlyKeys(source, ["kind", "provider", "prompt"], "source")
    if (typeof source.kind !== "string" || !["builtin", "imported", "custom", "generated"].includes(source.kind)) {
      throw new LocalizedError("不支持的 enemy 来源", "Unsupported enemy source")
    }
    result.source = { kind: source.kind as EnemySource["kind"] }
    if (Object.hasOwn(source, "provider")) result.source.provider = text(source.provider, "source.provider", 120)
    if (Object.hasOwn(source, "prompt")) result.source.prompt = text(source.prompt, "source.prompt", 4000)
  }
  return result
}

export function serializeEnemyDocument(doc: EnemyDocument): string {
  // Validate before stringify, which otherwise turns NaN into null and drops undefined.
  validateEnemySelection(doc.appearance)
  return JSON.stringify(parseEnemyDocument(JSON.stringify(doc)), null, 2) + "\n"
}

/** Always resolve a NEW choice against the original current appearance, never the previous choice. */
export function resolveEnemyAppearance(current: Partial<EnemyAppearance>, selection: EnemySelection | null): Partial<EnemyAppearance> {
  return { ...validateEnemySelection(current), ...(selection === null ? {} : validateEnemySelection(selection)) }
}
