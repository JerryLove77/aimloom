import type { EnemyAppearance, JsonValue, Section, SettingsPatch, Theme } from "../types.js"
import { B, F, V } from "../settings/keys.js"
import { readKey, type SettingsDoc } from "../settings/settings-doc.js"
import { schemeToPatch } from "../scheme/replacement.js"
import type { SchemeDocument } from "../scheme/types.js"
import { ENEMY_FIELDS, validateEnemySelection, type EnemyField, type EnemySelection } from "./model.js"

/** Explicit native names: notably EnemyMetalic (one l) and EnemyAttacksColoredByBody. */
export const ENEMY_BINDINGS: Readonly<Record<EnemyField, readonly [Section, string]>> = {
  headColor: ["vectorSettings", V("EnemyHeadColor")], bodyColor: ["vectorSettings", V("EnemyBodyColor")],
  headColorOnHit: ["vectorSettings", V("EnemyHeadColorOnHit")], bodyColorOnHit: ["vectorSettings", V("EnemyBodyColorOnHit")],
  headColorOnLookAt: ["vectorSettings", V("EnemyHeadColorOnLookAt")], bodyColorOnLookAt: ["vectorSettings", V("EnemyBodyColorOnLookAt")],
  roughness: ["floatSettings", F("EnemyRoughness")], metallic: ["floatSettings", F("EnemyMetalic")], fullBright: ["floatSettings", F("EnemyFullBright")],
  glowUpHead: ["floatSettings", F("EnemyGlowUpHead")], glowUpBody: ["floatSettings", F("EnemyGlowUpBody")],
  glowUpHeadOnHit: ["floatSettings", F("EnemyGlowUpHeadOnHit")], glowUpBodyOnHit: ["floatSettings", F("EnemyGlowUpBodyOnHit")],
  glowUpHeadOnLookAt: ["floatSettings", F("EnemyGlowUpHeadOnLookAt")], glowUpBodyOnLookAt: ["floatSettings", F("EnemyGlowUpBodyOnLookAt")],
  overrideHead: ["booleanSettings", B("OverrideEnemyHeadColor")], overrideBody: ["booleanSettings", B("OverrideEnemyBodyColor")],
  changeOnHit: ["booleanSettings", B("ChangeEnemyColorOnHit")], changeOnLookAt: ["booleanSettings", B("ChangeEnemyColorOnLookAt")],
  bodyColorAsAttackColor: ["booleanSettings", B("EnemyAttacksColoredByBody")],
}
export const ENEMY_KEYS: ReadonlySet<string> = new Set(Object.values(ENEMY_BINDINGS).map(([, key]) => key))

export function enemyToPatch(selection: EnemySelection | null): SettingsPatch {
  const appearance = selection === null ? {} : validateEnemySelection(selection)
  const patch: SettingsPatch = {}
  for (const field of ENEMY_FIELDS) if (Object.hasOwn(appearance, field)) {
    const [section, key] = ENEMY_BINDINGS[field]
    ;(patch[section] ??= {})[key] = appearance[field] as JsonValue
  }
  return patch
}

/** Missing native keys remain absent, so neither preview nor apply invents a game default. */
export function readEnemyAppearance(doc: SettingsDoc): Partial<EnemyAppearance> {
  const appearance: Record<string, unknown> = {}
  for (const field of ENEMY_FIELDS) {
    const [section, key] = ENEMY_BINDINGS[field]
    const value = readKey(doc, section, key)
    if (value !== undefined) appearance[field] = value
  }
  return validateEnemySelection(appearance)
}

/** Composition only, NOT proof of activation. A future scheme writer must own combined-theme loading. */
export function composeSchemeEnemyPatch(scheme: SchemeDocument | Theme | null, enemy: EnemySelection | null): SettingsPatch {
  // Retain legacy callers while taking only environment-owned values from their theme.
  const document: SchemeDocument | null = scheme === null ? null : "environment" in scheme ? scheme : {
    schemaVersion: 1, name: scheme.name, warnings: [],
    environment: { wall: scheme.wall, floor: scheme.floor, ceiling: scheme.ceiling, ramp: scheme.ramp, sky: scheme.sky },
  }
  const patch = document === null ? {} : schemeToPatch(document)
  for (const bucket of Object.values(patch)) for (const key of Object.keys(bucket ?? {})) if (ENEMY_KEYS.has(key)) delete bucket?.[key]
  const explicit = enemyToPatch(enemy)
  for (const [section, entries] of Object.entries(explicit) as [Section, Record<string, JsonValue>][]) {
    patch[section] = { ...patch[section], ...entries }
  }
  return patch
}

export type EnemyChange = { field: EnemyField; before: JsonValue; after: JsonValue }
export function prepareEnemyReplacement(current: SettingsDoc, selection: EnemySelection | null): { patch: SettingsPatch; changes: EnemyChange[] } {
  const desired = selection === null ? {} : validateEnemySelection(selection)
  const currentAppearance = readEnemyAppearance(current)
  const changed: Record<string, unknown> = {}
  const changes: EnemyChange[] = []
  for (const field of ENEMY_FIELDS) if (Object.hasOwn(desired, field)) {
    const before = currentAppearance[field]
    const after = desired[field]
    if (before === undefined) throw new Error(`当前设置缺少 ${ENEMY_BINDINGS[field][1]}，请先验证此游戏版本的绑定`)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = after
      changes.push({ field, before: before as JsonValue, after: after as JsonValue })
    }
  }
  return { patch: enemyToPatch(validateEnemySelection(changed)), changes }
}
