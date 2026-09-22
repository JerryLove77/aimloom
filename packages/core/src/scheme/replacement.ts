import type { JsonValue, Section, SettingsPatch } from "../types.js"
import { B, C, F, I, S, V } from "../settings/keys.js"
import { applyPatch, readKey, type SettingsDoc } from "../settings/settings-doc.js"
import { decodeText } from "../theme/decode.js"
import { parseTheme } from "../theme/parse.js"
import { object, validateScheme } from "./document.js"
import { SURFACE_SLOTS, type SchemeDocument } from "./types.js"
import { equalJson, nativeEnvironmentFields } from "./native-fields.js"

/** Environment ownership only. Never use the full legacy themeToPatch for a scheme. */
export function schemeToPatch(document: SchemeDocument): SettingsPatch {
  const { name, environment: env } = validateScheme(document)
  const stringSettings: Record<string, JsonValue> = { [S("CurrentThemeName")]: name }
  const floatSettings: Record<string, JsonValue> = {}
  const vectorSettings: Record<string, JsonValue> = {}
  for (const slot of SURFACE_SLOTS) {
    const native = slot[0]!.toUpperCase() + slot.slice(1)
    const surface = env[slot]
    stringSettings[S(`${native}Material`)] = surface.material
    vectorSettings[V(`${native}Color`)] = surface.tint
    floatSettings[F(`${native}Roughness`)] = surface.roughness
    floatSettings[F(`${native}Metallic`)] = surface.metallic
    floatSettings[F(`${native}FullBright`)] = surface.fullBright
    floatSettings[F(`${native}TextureScale`)] = surface.textureScale
  }
  return {
    stringSettings, floatSettings, vectorSettings,
    integerSettings: { [I("SkyPreset")]: env.sky.presetId, [I("CloudCover")]: env.sky.cloudCoverId },
    booleanSettings: { [B("SolidSkyColor")]: env.sky.solid, [B("ShowSunInSkybox")]: env.sky.sunVisible },
    colorSettings: { [C("SkyColor")]: env.sky.color },
  }
}

export type SchemeChange = { section: Section; key: string; before: JsonValue | undefined; after: JsonValue }
export type SchemeBlocker = { code: "missing-native-key" | "material-binding-unverified"; key: string; message: string }
export type SchemeReplacement = {
  patch: SettingsPatch
  /** Candidate data only; native execution must consume the review through its own boundary. */
  next: SettingsDoc
  changes: SchemeChange[]
  blockers: SchemeBlocker[]
  gameActivation: "unverified"
}

export function prepareSchemeReplacement(current: SettingsDoc, document: SchemeDocument | null): SchemeReplacement {
  const patch = document === null ? {} : schemeToPatch(document)
  const changes: SchemeChange[] = []
  const blockers: SchemeBlocker[] = []
  for (const [section, entries] of Object.entries(patch) as [Section, Record<string, JsonValue>][]) {
    for (const [key, after] of Object.entries(entries)) {
      const before = readKey(current, section, key)
      if (equalJson(before, after)) continue
      changes.push({ section, key, before: structuredClone(before), after: structuredClone(after) })
      if (before === undefined) blockers.push({ code: "missing-native-key", key, message: `${key} 在当前设置中不存在，不能跳过后报告替换成功` })
      if (/::(?:Wall|Floor|Ceiling|Ramp)Material$/.test(key)) {
        blockers.push({ code: "material-binding-unverified", key, message: `${key} 材质绑定仍待游戏验证，不能推测整数索引` })
      }
    }
  }
  return { patch, next: applyPatch(structuredClone(current), patch), changes, blockers, gameActivation: "unverified" }
}

/** Baseline is a native theme, not current Primary settings. Its enemy values remain intact. */
export function composeSchemeTheme(baseline: Uint8Array, document: SchemeDocument): Uint8Array {
  const parsed = parseTheme(baseline, "baseline")
  if (!parsed.ok) throw new Error(`基础主题无效: ${parsed.error}`)
  const raw = object(JSON.parse(decodeText(baseline).text), "baseline")
  const { name, environment: env } = validateScheme(document)
  raw.themeName = name
  Object.assign(raw, nativeEnvironmentFields(env))
  return new TextEncoder().encode(JSON.stringify(raw, null, "\t") + "\n")
}
