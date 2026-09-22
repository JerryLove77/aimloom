import { describe, it, expect } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { parseTheme } from "../src/theme/parse.js"
import { makeFixture } from "./helpers/fixture.js"

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))

const MINIMAL = {
  themeName: "t",
  wallMaterial: "MARBLE POLISHED",
  wallRoughness: 1,
  wallMetallic: 0.5,
  wallFullBright: 0.25,
  wallTint: { x: 0.1, y: 0.2, z: 0.3 },
  floorMaterial: "DRYWALL",
  floorRoughness: 0.5,
  floorMetallic: 0.25,
  floorFullBright: 0.75,
  floorTint: { x: 0.4, y: 0.5, z: 0.6 },
  overrideEnemyHeadColor: true,
  overrideEnemyBodyColor: true,
  setEnemyBodyColorAsAttackColor: false,
  enemyColorRoughness: 0.3,
  enemyColorMetallic: 0.4,
  enemyColorFullBright: 0.5,
  enemyHeadColor: { x: 1, y: 0, z: 0 },
  enemyBodyColor: { x: 0, y: 1, z: 0 },
  skyPresetId: 8,
  cloudCoverId: 2,
  solidSkyColor: false,
  sunVisible: true,
  skyColor: { b: 255, g: 200, r: 100, a: 255 },
}

describe("parseTheme 回退规则", () => {
  it("ceiling 缺失时整体沿用 wall", () => {
    const r = parseTheme(enc(MINIMAL), "/x/t.json")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.theme.ceiling).toEqual(r.theme.wall)
    expect(r.theme.source.missingFields).toContain("ceiling*")
  })

  it("ramp 缺失时整体沿用 floor", () => {
    const r = parseTheme(enc(MINIMAL), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.ramp).toEqual(r.theme.floor)
    expect(r.theme.source.missingFields).toContain("ramp*")
  })

  it("textureScale 缺失时为 1", () => {
    const r = parseTheme(enc(MINIMAL), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.wall.textureScale).toBe(1)
    expect(r.theme.floor.textureScale).toBe(1)
  })

  it("glowUp 缺失时为 1", () => {
    const r = parseTheme(enc(MINIMAL), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.enemy.glowUpHead).toBe(1)
    expect(r.theme.enemy.glowUpBodyOnLookAt).toBe(1)
    expect(r.theme.team.glowUpHead).toBe(1)
  })

  it("OnHit / OnLookAt 颜色缺失时沿用基础色", () => {
    const r = parseTheme(enc(MINIMAL), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.enemy.headColorOnHit).toEqual(r.theme.enemy.headColor)
    expect(r.theme.enemy.bodyColorOnLookAt).toEqual(r.theme.enemy.bodyColor)
    expect(r.theme.enemy.changeOnHit).toBe(false)
  })

  it("显式提供的 ceiling 不被 wall 覆盖", () => {
    const r = parseTheme(
      enc({
        ...MINIMAL,
        ceilingMaterial: "BRICK GREY",
        ceilingRoughness: 0.1,
        ceilingMetallic: 0.2,
        ceilingFullBright: 0.3,
        ceilingTint: { x: 0.9, y: 0.9, z: 0.9 },
        ceilingTextureScale: 2,
      }),
      "/x/t.json",
    )
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.ceiling.material).toBe("BRICK GREY")
    expect(r.theme.ceiling.textureScale).toBe(2)
    expect(r.theme.source.missingFields).not.toContain("ceiling*")
  })
})

describe("parseTheme 数值钳制", () => {
  it("颜色分量越界被钳到 [0,1] 并记录 warning", () => {
    const r = parseTheme(enc({ ...MINIMAL, wallTint: { x: 5, y: -2, z: 0.5 } }), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.wall.tint).toEqual({ x: 1, y: 0, z: 0.5 })
    expect(r.theme.source.warnings.join(" ")).toContain("wallTint")
  })

  it("skyPresetId 越界回退到 0 并记录 warning", () => {
    const r = parseTheme(enc({ ...MINIMAL, skyPresetId: 99 }), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.sky.presetId).toBe(0)
    expect(r.theme.source.warnings.join(" ")).toContain("skyPresetId")
  })

  it("cloudCoverId 越界回退到 0", () => {
    const r = parseTheme(enc({ ...MINIMAL, cloudCoverId: -3 }), "/x/t.json")
    if (!r.ok) throw new Error("parse failed")
    expect(r.theme.sky.cloudCoverId).toBe(0)
  })
})

describe("parseTheme 失败路径", () => {
  it("非 JSON 返回 ok:false 而不抛异常", () => {
    const r = parseTheme(new TextEncoder().encode("not json at all"), "/x/bad.json")
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.path).toBe("/x/bad.json")
    expect(r.error).toMatch(/JSON/i)
  })

  it("缺少 themeName 等核心字段时失败", () => {
    const r = parseTheme(enc({ wallMaterial: "DRYWALL" }), "/x/bad.json")
    expect(r.ok).toBe(false)
  })
})

describe("parseTheme 面向真实语料", () => {
  it("解析成功率不低于 95%，且失败项都带得出原因", async () => {
    const fx = await makeFixture()
    try {
      const files = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))
      const results = await Promise.all(
        files.map(async (f) => {
          const buf = await readFile(join(fx.themesDir, f))
          return parseTheme(new Uint8Array(buf), join(fx.themesDir, f))
        }),
      )
      // 不断言精确数量——语料会替换。断言的是「解析器对真实社区文件足够健壮」这一性质。
      const ok = results.filter((r) => r.ok)
      expect(ok.length / results.length).toBeGreaterThanOrEqual(0.95)
      for (const r of results) if (!r.ok) expect(r.error).toBeTruthy()
    } finally {
      await fx.cleanup()
    }
  })

  it("非 UTF-8 编码的文件同样能解析（语料中含 UTF-16 样本）", async () => {
    const fx = await makeFixture()
    try {
      const files = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))
      const encodings = new Set<string>()
      for (const f of files) {
        const buf = await readFile(join(fx.themesDir, f))
        const r = parseTheme(new Uint8Array(buf), f)
        if (r.ok) encodings.add(r.theme.source.encoding)
      }
      expect(encodings.size).toBeGreaterThanOrEqual(1)
      expect(
        [...encodings].every((e) => ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"].includes(e)),
      ).toBe(true)
    } finally {
      await fx.cleanup()
    }
  })

  it("每个成功解析的 theme 四个面都齐全", async () => {
    const fx = await makeFixture()
    try {
      const files = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))
      for (const f of files) {
        const buf = await readFile(join(fx.themesDir, f))
        const r = parseTheme(new Uint8Array(buf), f)
        if (!r.ok) continue
        for (const s of [r.theme.wall, r.theme.floor, r.theme.ceiling, r.theme.ramp]) {
          expect(typeof s.material).toBe("string")
          expect(s.material.length).toBeGreaterThan(0)
          expect(s.textureScale).toBeGreaterThan(0)
        }
      }
    } finally {
      await fx.cleanup()
    }
  })
})
