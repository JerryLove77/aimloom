import { describe, it, expect } from "vitest"
import { readdir, readFile } from "node:fs/promises"
import { makeFixture } from "./helpers/fixture.js"

describe("makeFixture", () => {
  it("复制出一份可写副本，三类素材与存档就位", async () => {
    const fx = await makeFixture()
    try {
      // 断言结构与非空，不断言精确数量——样本内容会随项目演进替换
      expect((await readdir(fx.themesDir)).filter((f) => f.endsWith(".json")).length).toBeGreaterThan(0)
      expect((await readdir(fx.soundsDir)).filter((f) => /\.(ogg|wav)$/i.test(f)).length).toBeGreaterThan(0)
      expect((await readdir(fx.crosshairsDir)).filter((f) => f.endsWith(".png")).length).toBeGreaterThan(0)

      const settings = JSON.parse(await readFile(fx.settingsPath, "utf-8"))
      for (const s of [
        "booleanSettings",
        "integerSettings",
        "floatSettings",
        "stringSettings",
        "vectorSettings",
        "colorSettings",
      ]) {
        expect(settings[s]).toBeTypeOf("object")
      }
      expect(settings.stringSettings["EStringSettingId::CurrentThemeName"]).toBeTypeOf("string")
    } finally {
      await fx.cleanup()
    }
  })

  it("副本与原始 pack 相互隔离", async () => {
    const fx = await makeFixture()
    try {
      expect(fx.root).not.toContain("KVK Settings 2025")
    } finally {
      await fx.cleanup()
    }
  })
})
