import { describe, it, expect } from "vitest"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { inspectPack, installPack } from "../src/pack/importer.js"
import { makePackFixture } from "./helpers/fixture.js"

const tempDest = () => mkdtemp(join(tmpdir(), "kvk-dest-"))

describe("inspectPack", () => {
  it("识别配置包的全部内容", async () => {
    const pack = await makePackFixture()
    try {
      const m = await inspectPack(new NodeAdapter(), pack.root)
      expect(m.themes.length).toBeGreaterThan(0)
      expect(m.themes.filter((t) => t.ok).length / m.themes.length).toBeGreaterThanOrEqual(0.95)
      // 音效以「待拷贝的文件名」形式列出：含扩展名、不去重
      expect(m.sounds.length).toBeGreaterThan(0)
      expect(m.sounds.every((f) => /\.(ogg|wav)$/i.test(f))).toBe(true)
      expect(m.sounds.some((f) => f.endsWith(".sfk"))).toBe(false)
      expect(m.crosshairs.every((f) => f.endsWith(".png"))).toBe(true)
      expect(m.hasPrimaryUserSettings).toBe(true)
      expect(m.hasUiJson).toBe(true)
      expect(m.hasPaletteIni).toBe(true)
      expect(m.readme).toContain("FPSAimTrainer")
    } finally {
      await pack.cleanup()
    }
  })

  it("同名的 .ogg 与 .wav 都列出（是两个要各自拷贝的文件）", async () => {
    const pack = await makePackFixture()
    try {
      const m = await inspectPack(new NodeAdapter(), pack.root)
      expect(m.sounds).toContain("Health Hit 3.ogg")
      expect(m.sounds).toContain("Health Hit 3.wav")
    } finally {
      await pack.cleanup()
    }
  })

  it(".png~ 备份不被当成准星", async () => {
    const pack = await makePackFixture()
    try {
      const m = await inspectPack(new NodeAdapter(), pack.root)
      expect(m.crosshairs).not.toContain("mycrosshair.png~")
      expect(m.crosshairs).toContain("mycrosshair.png")
    } finally {
      await pack.cleanup()
    }
  })

  it("解析失败的 theme 带上错误原因而不是被丢掉", async () => {
    const pack = await makePackFixture()
    try {
      const m = await inspectPack(new NodeAdapter(), pack.root)
      for (const f of m.themes.filter((t) => !t.ok)) expect(f.error).toBeTruthy()
    } finally {
      await pack.cleanup()
    }
  })

  it("空目录不抛错，各项为空", async () => {
    const empty = await mkdtemp(join(tmpdir(), "kvk-empty-"))
    try {
      const m = await inspectPack(new NodeAdapter(), empty)
      expect(m.themes).toEqual([])
      expect(m.sounds).toEqual([])
      expect(m.crosshairs).toEqual([])
      expect(m.hasPrimaryUserSettings).toBe(false)
      expect(m.readme).toBeNull()
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe("installPack", () => {
  it("只拷贝勾选的素材", async () => {
    const pack = await makePackFixture()
    const dest = await tempDest()
    try {
      const adapter = new NodeAdapter()
      const manifest = await inspectPack(adapter, pack.root)
      const someTheme = manifest.themes.find((t) => t.ok)!.file

      const report = await installPack(
        adapter,
        manifest,
        {
          themesDir: join(dest, "Themes"),
          soundsDir: join(dest, "sounds"),
          crosshairsDir: join(dest, "crosshairs"),
        },
        { themes: [someTheme], sounds: ["Q3Railgun.ogg"], crosshairs: ["dot.png"] },
      )

      expect(report.copied).toBe(3)
      expect(await readdir(join(dest, "Themes"))).toEqual([someTheme])
      expect(await readdir(join(dest, "sounds"))).toEqual(["Q3Railgun.ogg"])
      expect(await readdir(join(dest, "crosshairs"))).toEqual(["dot.png"])
    } finally {
      await pack.cleanup()
      await rm(dest, { recursive: true, force: true })
    }
  })

  it("勾选了不存在的文件时记入 skipped 而不中断（C7 部分失败）", async () => {
    const pack = await makePackFixture()
    const dest = await tempDest()
    try {
      const adapter = new NodeAdapter()
      const manifest = await inspectPack(adapter, pack.root)
      const someTheme = manifest.themes.find((t) => t.ok)!.file

      const report = await installPack(
        adapter,
        manifest,
        { themesDir: join(dest, "Themes"), soundsDir: join(dest, "s"), crosshairsDir: join(dest, "c") },
        { themes: [someTheme, "does-not-exist.json"], sounds: [], crosshairs: [] },
      )
      expect(report.copied).toBe(1)
      expect(report.skipped).toHaveLength(1)
      expect(report.skipped[0]!.file).toBe("does-not-exist.json")
      expect(report.skipped[0]!.reason).toBeTruthy()
    } finally {
      await pack.cleanup()
      await rm(dest, { recursive: true, force: true })
    }
  })

  it("中间一项失败后，其后的项仍继续拷贝", async () => {
    const pack = await makePackFixture()
    const dest = await tempDest()
    try {
      const adapter = new NodeAdapter()
      const manifest = await inspectPack(adapter, pack.root)
      const ok = manifest.themes.filter((t) => t.ok).slice(0, 2).map((t) => t.file)
      expect(ok).toHaveLength(2)

      const report = await installPack(
        adapter,
        manifest,
        { themesDir: join(dest, "Themes"), soundsDir: join(dest, "s"), crosshairsDir: join(dest, "c") },
        { themes: [ok[0]!, "ghost.json", ok[1]!], sounds: [], crosshairs: [] },
      )
      expect(report.copied).toBe(2)
      expect(report.skipped).toHaveLength(1)
      const written = await readdir(join(dest, "Themes"))
      expect(written).toContain(ok[0])
      expect(written).toContain(ok[1])
    } finally {
      await pack.cleanup()
      await rm(dest, { recursive: true, force: true })
    }
  })

  it("绝不触碰 PrimaryUserSettings.json / UI.json / Palette.ini", async () => {
    const pack = await makePackFixture()
    const dest = await tempDest()
    try {
      const adapter = new NodeAdapter()
      const manifest = await inspectPack(adapter, pack.root)
      const someTheme = manifest.themes.find((t) => t.ok)!.file

      await installPack(
        adapter,
        manifest,
        { themesDir: join(dest, "Themes"), soundsDir: join(dest, "s"), crosshairsDir: join(dest, "c") },
        { themes: [someTheme], sounds: [], crosshairs: [] },
      )
      const all = await readdir(dest, { recursive: true })
      const flat = (all as string[]).join("|")
      expect(flat).not.toContain("PrimaryUserSettings.json")
      expect(flat).not.toContain("UI.json")
      expect(flat).not.toContain("Palette.ini")
    } finally {
      await pack.cleanup()
      await rm(dest, { recursive: true, force: true })
    }
  })

  it("目标目录已存在时不报错", async () => {
    const pack = await makePackFixture()
    const dest = await tempDest()
    try {
      await mkdir(join(dest, "Themes"), { recursive: true })
      const adapter = new NodeAdapter()
      const manifest = await inspectPack(adapter, pack.root)
      const someTheme = manifest.themes.find((t) => t.ok)!.file

      const report = await installPack(
        adapter,
        manifest,
        { themesDir: join(dest, "Themes"), soundsDir: join(dest, "s"), crosshairsDir: join(dest, "c") },
        { themes: [someTheme], sounds: [], crosshairs: [] },
      )
      expect(report.copied).toBe(1)
    } finally {
      await pack.cleanup()
      await rm(dest, { recursive: true, force: true })
    }
  })
})
