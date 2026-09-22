import { describe, it, expect } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { parseTheme } from "../src/theme/parse.js"
import { themeToPatch } from "../src/settings/theme-applier.js"
import { filterPatch } from "../src/settings/field-policy.js"
import { THEME_KEYS } from "../src/settings/keys.js"
import { makeFixture } from "./helpers/fixture.js"
import type { Surface, Theme } from "../src/types.js"

/**
 * 映射表测试用手工构造的 Theme，不依赖语料中的任何具体文件——
 * 语料会随项目演进整批替换，而映射表的正确性与语料无关。
 * 每个字段给一个独一无二的值，任何串位都会被立刻发现。
 */
const surf = (material: string, base: number): Surface => ({
  material,
  tint: { x: base, y: base + 0.01, z: base + 0.02 },
  roughness: base + 0.03,
  metallic: base + 0.04,
  fullBright: base + 0.05,
  textureScale: base + 0.06,
})

const FIXTURE_THEME: Theme = {
  name: "unit-test-theme",
  wall: surf("MARBLE POLISHED", 0.1),
  floor: surf("DRYWALL", 0.2),
  ceiling: surf("BRICK GREY", 0.3),
  ramp: surf("CONCRETE TILES", 0.4),
  enemy: {
    headColor: { x: 0.5, y: 0.51, z: 0.52 },
    bodyColor: { x: 0.53, y: 0.54, z: 0.55 },
    headColorOnHit: { x: 0.56, y: 0.57, z: 0.58 },
    bodyColorOnHit: { x: 0.59, y: 0.6, z: 0.61 },
    headColorOnLookAt: { x: 0.62, y: 0.63, z: 0.64 },
    bodyColorOnLookAt: { x: 0.65, y: 0.66, z: 0.67 },
    roughness: 0.71,
    metallic: 0.72,
    fullBright: 0.73,
    overrideHead: true,
    overrideBody: false,
    changeOnHit: true,
    changeOnLookAt: false,
    bodyColorAsAttackColor: true,
    glowUpHead: 1.1,
    glowUpBody: 1.2,
    glowUpHeadOnHit: 1.3,
    glowUpBodyOnHit: 1.4,
    glowUpHeadOnLookAt: 1.5,
    glowUpBodyOnLookAt: 1.6,
  },
  team: { glowUpHead: 2.1, glowUpBody: 2.2 },
  sky: {
    presetId: 7,
    cloudCoverId: 4,
    solid: true,
    sunVisible: true,
    color: { b: 11, g: 22, r: 33, a: 44 },
  },
  source: { path: "unit-test", encoding: "utf-8", missingFields: [], warnings: [] },
}

describe("themeToPatch 不规则命名（spec §5.2）", () => {
  const p = themeToPatch(FIXTURE_THEME)

  it("wallTint → WallColor（Tint 变 Color）", () => {
    expect(p.vectorSettings!["EVectorSettingId::WallColor"]).toEqual(FIXTURE_THEME.wall.tint)
    expect(p.vectorSettings!["EVectorSettingId::WallTint"]).toBeUndefined()
  })

  it("enemyColorMetallic → EnemyMetalic（游戏拼写错误，少一个 l）", () => {
    expect(p.floatSettings!["EFloatSettingId::EnemyMetalic"]).toBe(0.72)
    expect(p.floatSettings!["EFloatSettingId::EnemyMetallic"]).toBeUndefined()
  })

  it("enemyColorFullBright / Roughness → 丢掉 Color", () => {
    expect(p.floatSettings!["EFloatSettingId::EnemyFullBright"]).toBe(0.73)
    expect(p.floatSettings!["EFloatSettingId::EnemyRoughness"]).toBe(0.71)
    expect(p.floatSettings!["EFloatSettingId::EnemyColorFullBright"]).toBeUndefined()
  })

  it("sunVisible → ShowSunInSkybox（完全换名）", () => {
    expect(p.booleanSettings!["EBooleanSettingId::ShowSunInSkybox"]).toBe(true)
    expect(p.booleanSettings!["EBooleanSettingId::SunVisible"]).toBeUndefined()
  })

  it("skyPresetId → SkyPreset，cloudCoverId → CloudCover（去掉 Id）", () => {
    expect(p.integerSettings!["EIntegerSettingId::SkyPreset"]).toBe(7)
    expect(p.integerSettings!["EIntegerSettingId::CloudCover"]).toBe(4)
  })

  it("setEnemyBodyColorAsAttackColor → EnemyAttacksColoredByBody（完全换名）", () => {
    expect(p.booleanSettings!["EBooleanSettingId::EnemyAttacksColoredByBody"]).toBe(true)
  })
})

describe("themeToPatch 无串位", () => {
  const p = themeToPatch(FIXTURE_THEME)

  it("四个面各自的值不互相串", () => {
    expect(p.stringSettings!["EStringSettingId::WallMaterial"]).toBe("MARBLE POLISHED")
    expect(p.stringSettings!["EStringSettingId::FloorMaterial"]).toBe("DRYWALL")
    expect(p.stringSettings!["EStringSettingId::CeilingMaterial"]).toBe("BRICK GREY")
    expect(p.stringSettings!["EStringSettingId::RampMaterial"]).toBe("CONCRETE TILES")
    expect(p.floatSettings!["EFloatSettingId::WallRoughness"]).toBe(0.13)
    expect(p.floatSettings!["EFloatSettingId::FloorRoughness"]).toBe(0.23)
    expect(p.floatSettings!["EFloatSettingId::CeilingTextureScale"]).toBe(0.36)
    expect(p.floatSettings!["EFloatSettingId::RampMetallic"]).toBe(0.44)
  })

  it("六个敌人颜色各自独立，OnHit / OnLookAt 不与基础色混淆", () => {
    const v = p.vectorSettings!
    expect(v["EVectorSettingId::EnemyHeadColor"]).toEqual({ x: 0.5, y: 0.51, z: 0.52 })
    expect(v["EVectorSettingId::EnemyBodyColor"]).toEqual({ x: 0.53, y: 0.54, z: 0.55 })
    expect(v["EVectorSettingId::EnemyHeadColorOnHit"]).toEqual({ x: 0.56, y: 0.57, z: 0.58 })
    expect(v["EVectorSettingId::EnemyBodyColorOnLookAt"]).toEqual({ x: 0.65, y: 0.66, z: 0.67 })
  })

  it("team 的两个 glowUp 不与 enemy 的混淆", () => {
    expect(p.floatSettings!["EFloatSettingId::TeamGlowUpHead"]).toBe(2.1)
    expect(p.floatSettings!["EFloatSettingId::TeamGlowUpBody"]).toBe(2.2)
    expect(p.floatSettings!["EFloatSettingId::EnemyGlowUpHead"]).toBe(1.1)
  })

  it("两个 override 布尔值不混淆", () => {
    expect(p.booleanSettings!["EBooleanSettingId::OverrideEnemyHeadColor"]).toBe(true)
    expect(p.booleanSettings!["EBooleanSettingId::OverrideEnemyBodyColor"]).toBe(false)
    expect(p.booleanSettings!["EBooleanSettingId::ChangeEnemyColorOnHit"]).toBe(true)
    expect(p.booleanSettings!["EBooleanSettingId::ChangeEnemyColorOnLookAt"]).toBe(false)
  })

  it("CurrentThemeName 取 theme.name", () => {
    expect(p.stringSettings!["EStringSettingId::CurrentThemeName"]).toBe("unit-test-theme")
  })

  it("skyColor 以 b/g/r/a 形状原样写入", () => {
    expect(p.colorSettings!["EColorSettingId::SkyColor"]).toEqual({ b: 11, g: 22, r: 33, a: 44 })
  })
})

describe("themeToPatch 与白名单的一致性", () => {
  it("手工 theme 产出的键全部落在 THEME_KEYS 内", () => {
    expect(filterPatch(themeToPatch(FIXTURE_THEME), THEME_KEYS).rejected).toEqual([])
  })

  it("语料中每个 theme 产出的键都落在 THEME_KEYS 内，无一被拒", async () => {
    const fx = await makeFixture()
    try {
      const files = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))
      for (const f of files) {
        const buf = await readFile(join(fx.themesDir, f))
        const r = parseTheme(new Uint8Array(buf), f)
        if (!r.ok) continue
        const { rejected } = filterPatch(themeToPatch(r.theme), THEME_KEYS)
        expect(rejected, `${f} 产出了未授权的键: ${rejected.join(", ")}`).toEqual([])
      }
    } finally {
      await fx.cleanup()
    }
  })

  it("绝不产出任何手感设置键", async () => {
    const fx = await makeFixture()
    try {
      const files = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))
      for (const f of files) {
        const buf = await readFile(join(fx.themesDir, f))
        const r = parseTheme(new Uint8Array(buf), f)
        if (!r.ok) continue
        const all = Object.values(themeToPatch(r.theme)).flatMap((sec) => Object.keys(sec ?? {}))
        for (const k of all) {
          expect(k).not.toMatch(/Sens|DPI|FOV|FILMS/)
        }
      }
    } finally {
      await fx.cleanup()
    }
  })
})
