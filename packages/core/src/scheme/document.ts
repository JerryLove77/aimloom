import { decodeText } from "../theme/decode.js"
import { parseTheme } from "../theme/parse.js"
import { LocalizedError } from "../types.js"
import { SURFACE_SLOTS, type SchemeDocument } from "./types.js"
import { equalJson, nativeEnvironmentFields } from "./native-fields.js"

export function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalizedError(`${path} 必须是对象`, `${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new LocalizedError(`${path}.${key} 暂不支持`, `${path}.${key} is not supported`)
  }
}

export function nonempty(value: unknown, path: string): asserts value is string {
  // Unicode mode matches isolated surrogates, while allowing valid astral characters.
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) {
    throw new LocalizedError(`${path} 必须是非空文本，且不能包含无效字符`, `${path} must be non-empty text with no invalid characters`)
  }
}

function number(value: unknown, path: string, min: number, max: number, integer = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new LocalizedError(
      `${path} 必须是 ${min} 到 ${max} 范围内的${integer ? "整数" : "有限数值"}`,
      `${path} must be ${integer ? "an integer" : "a finite number"} between ${min} and ${max}`,
    )
  }
}

/** Strict for authored/generated documents. Unsupported fields never vanish silently. */
export function validateScheme(value: unknown): SchemeDocument {
  const doc = object(value, "scheme")
  keys(doc, ["schemaVersion", "name", "environment", "provenance", "warnings"], "scheme")
  if (doc.schemaVersion !== 1) throw new LocalizedError("不支持的 scheme schemaVersion", "Unsupported scheme schemaVersion")
  nonempty(doc.name, "scheme.name")
  const env = object(doc.environment, "environment")
  keys(env, [...SURFACE_SLOTS, "sky"], "environment")
  for (const slot of SURFACE_SLOTS) {
    const surface = object(env[slot], slot)
    keys(surface, ["material", "tint", "roughness", "metallic", "fullBright", "textureScale"], slot)
    nonempty(surface.material, `${slot}.material`)
    const tint = object(surface.tint, `${slot}.tint`)
    keys(tint, ["x", "y", "z"], `${slot}.tint`)
    for (const channel of ["x", "y", "z"]) number(tint[channel], `${slot}.tint.${channel}`, 0, 1)
    for (const property of ["roughness", "metallic", "fullBright"]) number(surface[property], `${slot}.${property}`, 0, 1)
    number(surface.textureScale, `${slot}.textureScale`, Number.MIN_VALUE, Number.MAX_VALUE)
  }
  const sky = object(env.sky, "sky")
  keys(sky, ["presetId", "cloudCoverId", "solid", "sunVisible", "color"], "sky")
  number(sky.presetId, "sky.presetId", 0, 13, true)
  number(sky.cloudCoverId, "sky.cloudCoverId", 0, 5, true)
  for (const flag of ["solid", "sunVisible"]) {
    if (typeof sky[flag] !== "boolean") throw new LocalizedError(`sky.${flag} 必须是布尔值`, `sky.${flag} must be a boolean`)
  }
  const color = object(sky.color, "sky.color")
  keys(color, ["r", "g", "b", "a"], "sky.color")
  for (const channel of ["r", "g", "b", "a"]) number(color[channel], `sky.color.${channel}`, 0, 255, true)
  if (!Array.isArray(doc.warnings) || doc.warnings.some((warning) => typeof warning !== "string")) {
    throw new LocalizedError("scheme.warnings 必须是文本数组", "scheme.warnings must be an array of text")
  }
  if (doc.provenance !== undefined) {
    const provenance = object(doc.provenance, "provenance")
    keys(provenance, ["kind", "generator"], "provenance")
    if (!["imported", "local", "generated"].includes(provenance.kind as string)) throw new LocalizedError("不支持的 provenance.kind", "Unsupported provenance.kind")
    if (provenance.generator !== undefined) nonempty(provenance.generator, "provenance.generator")
  }
  return structuredClone(doc) as SchemeDocument
}

// Diagnostic notes attached to a parsed document's `warnings`. Only the Chinese half is used
// today (the App only counts them, in `renderSchemePreview`'s own language); the English half
// is kept alongside it so a future bilingual surface has it ready.
const COMPAT_NOTE = {
  zh: (field: string) => `${field} 已使用兼容值修正，请检查预览与导出结果`,
  en: (field: string) => `${field} was replaced with a compatible value; check the preview and export result`,
}
const MISSING_NOTE = {
  zh: (field: string) => `${field} 缺失，使用兼容默认值`,
  en: (field: string) => `${field} is missing; a compatible default was used`,
}

/** Native files retain the legacy parser's documented fallback/color-clamping behavior. */
export function parseScheme(bytes: Uint8Array): SchemeDocument {
  const raw = object(JSON.parse(decodeText(bytes).text), "scheme")
  if ("schemaVersion" in raw) return validateScheme(raw)
  const parsed = parseTheme(bytes, "scheme")
  if (!parsed.ok) throw new Error(parsed.error)
  const theme = parsed.theme
  const environment = { wall: theme.wall, floor: theme.floor, ceiling: theme.ceiling, ramp: theme.ramp, sky: theme.sky }
  // The legacy parser's warnings do not cover every fallback/type conversion. Compare
  // all environment fields so the caller can review every changed source value.
  const warnings = Object.entries(nativeEnvironmentFields(environment))
    .filter(([field, value]) => !equalJson(raw[field], value))
    .map(([field]) => Object.hasOwn(raw, field) ? COMPAT_NOTE.zh(field) : MISSING_NOTE.zh(field))
  return validateScheme({
    schemaVersion: 1,
    name: theme.name,
    environment,
    provenance: { kind: "imported" },
    warnings,
  })
}

export function serializeScheme(document: SchemeDocument): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(validateScheme(document), null, 2) + "\n")
}
