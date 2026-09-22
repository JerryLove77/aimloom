import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import {
  parseEnemyDocument, serializeEnemyDocument, validateEnemySelection,
  resolveEnemyAppearance, enemyToPatch, readEnemyAppearance,
  composeSchemeEnemyPatch, prepareEnemyReplacement, createEnemyPreview, renderEnemySvg,
} from "../src/enemy/index.js"
import { parseTheme } from "../src/theme/parse.js"
import { applyPatch, parseSettings } from "../src/settings/settings-doc.js"
import type { EnemyAppearance } from "../src/types.js"

export const currentEnemy: EnemyAppearance = {
  headColor: { x: 1, y: 0, z: 0 }, bodyColor: { x: 0, y: 0, z: 0 },
  headColorOnHit: { x: 0, y: 1, z: 0 }, bodyColorOnHit: { x: 0, y: 1, z: 0 },
  headColorOnLookAt: { x: 0, y: 0, z: 1 }, bodyColorOnLookAt: { x: 0, y: 0, z: 1 },
  roughness: 0.8, metallic: 0, fullBright: 1, overrideHead: true, overrideBody: true,
  changeOnHit: false, changeOnLookAt: true, bodyColorAsAttackColor: false,
  glowUpHead: 1, glowUpBody: 1, glowUpHeadOnHit: 2, glowUpBodyOnHit: 3,
  glowUpHeadOnLookAt: 4, glowUpBodyOnLookAt: 5,
}
const native = () => ({ raw: {
  ...enemyToPatch(currentEnemy),
  version: 42, characterModelOverride: "scenario-owned",
  stringSettings: { "EStringSettingId::CurrentThemeName": "original" },
  floatSettings: { ...enemyToPatch(currentEnemy).floatSettings, "EFloatSettingId::XSens": 0.91 },
} })

describe("enemy document boundary", () => {
  it("normalizes hex without filling unspecified fields and round-trips generated metadata", () => {
    const input = { schemaVersion: 1, kind: "enemy-appearance", name: "自定义",
      appearance: { bodyColor: "#0080FF", fullBright: 0 },
      source: { kind: "generated", provider: "future-local", prompt: "蓝色目标" } }
    const doc = parseEnemyDocument(JSON.stringify(input))
    expect(doc.appearance).toEqual({ bodyColor: { x: 0, y: 128 / 255, z: 1 }, fullBright: 0 })
    expect(parseEnemyDocument(serializeEnemyDocument(doc))).toEqual(doc)
    expect(doc.source).toEqual(input.source)
  })
  it.each([
    { bodyColor: "red" }, { bodyColor: { x: 0, y: 0 } }, { bodyColor: { x: 2, y: 0, z: 0 } },
    { roughness: -1 }, { metallic: 1.01 }, { fullBright: Infinity }, { glowUpHead: NaN },
    { overrideBody: "false" }, { bodyColor: null }, { model: "enemy.glb" }, { size: 2 },
    { bodyColor: undefined }, [],
  ])("rejects invalid or unsupported appearance %j", (value) => {
    expect(() => validateEnemySelection(value)).toThrow()
  })
  it("rejects future formats and arbitrary metadata rather than dropping intent", () => {
    for (const extra of [{ schemaVersion: 2 }, { model: "enemy.glb" }, { source: { kind: ["generated"] } }, { source: { kind: "generated", script: "run" } }]) {
      expect(() => parseEnemyDocument(JSON.stringify({ schemaVersion: 1, kind: "enemy-appearance", name: "test", appearance: {}, ...extra }))).toThrow()
    }
    expect(() => parseEnemyDocument("null")).toThrow()
    expect(() => parseEnemyDocument("{")).toThrow()
  })
  it("replacing a selection does not keep fields from the previous choice or mutate inputs", () => {
    const old = resolveEnemyAppearance(currentEnemy, { bodyColor: "#ffffff", metallic: 1 })
    const next = resolveEnemyAppearance(currentEnemy, { bodyColor: "#0080ff" })
    expect(next.metallic).toBe(0)
    expect(old.metallic).toBe(1)
    next.headColor!.x = 0
    expect(currentEnemy.headColor.x).toBe(1)
    expect(resolveEnemyAppearance(currentEnemy, null)).toEqual(currentEnemy)
  })
})

describe("enemy replacement and scheme ownership", () => {
  it("emits a narrow patch with native irregular spellings, preserving false and zero", () => {
    expect(enemyToPatch({ metallic: 0, bodyColor: "#0080ff", overrideBody: false })).toEqual({
      floatSettings: { "EFloatSettingId::EnemyMetalic": 0 },
      vectorSettings: { "EVectorSettingId::EnemyBodyColor": { x: 0, y: 128 / 255, z: 1 } },
      booleanSettings: { "EBooleanSettingId::OverrideEnemyBodyColor": false },
    })
    expect(enemyToPatch(null)).toEqual({})
  })
  it("reads only available settings and identifies missing fields rather than inventing native defaults", () => {
    expect(readEnemyAppearance(native())).toEqual(currentEnemy)
    expect(readEnemyAppearance({ raw: {} })).toEqual({})
    expect(() => prepareEnemyReplacement({ raw: {} }, { bodyColor: "#ffffff" })).toThrow(/EnemyBodyColor/)
  })
  it("scheme replacement cannot overwrite current enemy, explicit enemy fields win", () => {
    const result = parseTheme(new TextEncoder().encode(JSON.stringify({ themeName: "other", wallMaterial: "DRYWALL", floorMaterial: "DRYWALL", enemyHeadColor: {x:0,y:1,z:0} })), "fixture")
    if (!result.ok) throw new Error(result.error)
    const patch = composeSchemeEnemyPatch(result.theme, { bodyColor: "#ffffff" })
    const changed = applyPatch(native(), patch)
    expect(readEnemyAppearance(changed).headColor).toEqual({ x: 1, y: 0, z: 0 })
    expect(readEnemyAppearance(changed).bodyColor).toEqual({ x: 1, y: 1, z: 1 })
    expect(changed.raw.stringSettings).toMatchObject({ "EStringSettingId::CurrentThemeName": "other" })
    expect(readEnemyAppearance(applyPatch(native(), composeSchemeEnemyPatch(result.theme, null)))).toEqual(currentEnemy)
    expect(result.theme.enemy.headColor).toEqual({ x: 0, y: 1, z: 0 })
  })
  it("prepares actual differences only, preserves unrelated settings, and rejects invalid current values", () => {
    const before = native()
    const result = prepareEnemyReplacement(before, { bodyColor: "#ffffff", metallic: 0 })
    expect(result.changes).toEqual([{ field: "bodyColor", before: { x: 0, y: 0, z: 0 }, after: { x: 1, y: 1, z: 1 } }])
    expect(result.patch).toEqual({ vectorSettings: { "EVectorSettingId::EnemyBodyColor": { x: 1, y: 1, z: 1 } } })
    const after = applyPatch(before, result.patch)
    expect(after.raw.floatSettings).toMatchObject({ "EFloatSettingId::XSens": 0.91 })
    expect(after.raw.characterModelOverride).toBe("scenario-owned")
    expect(prepareEnemyReplacement(before, null).changes).toEqual([])
    expect(() => prepareEnemyReplacement({ raw: { floatSettings: { "EFloatSettingId::EnemyMetalic": "bad" } } }, { metallic: 0 })).toThrow()
  })
  it("reads and composes the real supplied settings without writing the corpus", async () => {
    const bytes = await readFile(new URL("../../../KVK Settings 2025/PrimaryUserSettings.json", import.meta.url))
    const doc = parseSettings(bytes)
    const replacement = prepareEnemyReplacement(doc, { bodyColor: "#3298ff" })
    const after = applyPatch(doc, replacement.patch)
    expect(readEnemyAppearance(after).bodyColor).toEqual({ x: 50/255, y: 152/255, z: 1 })
    expect(after.raw.floatSettings).toEqual(doc.raw.floatSettings)
  })
})

describe("enemy preview", () => {
  it("uses hit/look-at colors only when enabled and reports disabled overrides as unknown", () => {
    expect(createEnemyPreview(currentEnemy, {}, "hit").body.color).toEqual({ x: 0, y: 0, z: 0 })
    const hit = createEnemyPreview(currentEnemy, { changeOnHit: true }, "hit")
    expect(hit.body.color).toEqual({ x: 0, y: 1, z: 0 })
    expect(hit.body.glow).toBe(3)
    expect(createEnemyPreview(currentEnemy, {}, "look-at").body.color).toEqual({ x: 0, y: 0, z: 1 })
    const unknown = createEnemyPreview(currentEnemy, { overrideBody: false }, "normal")
    expect(unknown.body.color).toBeNull()
    expect(unknown.warnings.length).toBeGreaterThan(0)
    expect(createEnemyPreview({}, null, "normal").body.color).toBeNull()
  })
  it("SVG is standalone, shows all three states and does not embed untrusted text as markup", () => {
    const svg = renderEnemySvg(currentEnemy, { bodyColor: "#00ff00" }, { title: '<script>alert("x")</script>', background: "#101018" })
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain("#00ff00")
    expect(svg).toContain("#101018")
    expect(svg).toContain("普通")
    expect(svg).toContain("命中")
    expect(svg).toContain("瞄准")
    expect(svg).not.toContain("<script>")
    expect(svg).not.toContain("NaN")
    expect(() => renderEnemySvg(currentEnemy, null, { background: 'url(https://example.com)' })).toThrow()
  })
})
