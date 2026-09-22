import { describe, it, expect } from "vitest"
import { readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { scanThemes } from "../src/theme/scan.js"
import { makeFixture } from "./helpers/fixture.js"

describe("scanThemes", () => {
  it("每个 .json 文件都有归宿：成功进 themes，失败进 failures，总数守恒", async () => {
    const fx = await makeFixture()
    try {
      const fileCount = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json")).length
      const r = await scanThemes(new NodeAdapter(), fx.themesDir)
      expect(r.themes.length + r.failures.length).toBe(fileCount)
      expect(r.themes.every((t) => typeof t.name === "string")).toBe(true)
    } finally {
      await fx.cleanup()
    }
  })

  it("themeName 为空字符串的 theme 照常解析，不算失败", async () => {
    // 语料中文件名为 ".json" 的那个就是这种情况。解析器不该拒收它——
    // 修正名字是安装环节的事（sanitizeFileName 会把空名变成 "unnamed"）。
    const fx = await makeFixture()
    try {
      const r = await scanThemes(new NodeAdapter(), fx.themesDir)
      expect(r.themes.some((t) => t.name === "")).toBe(true)
      expect(r.failures.some((f) => f.path.endsWith("/.json"))).toBe(false)
    } finally {
      await fx.cleanup()
    }
  })

  it("一个损坏文件不影响其余文件（成功数不减）", async () => {
    const fx = await makeFixture()
    try {
      const clean = await scanThemes(new NodeAdapter(), fx.themesDir)
      await writeFile(join(fx.themesDir, "zzz-broken.json"), "{ this is not json")
      const dirty = await scanThemes(new NodeAdapter(), fx.themesDir)

      expect(dirty.themes.length).toBe(clean.themes.length)
      const broken = dirty.failures.find((f) => f.path.endsWith("zzz-broken.json"))
      expect(broken).toBeDefined()
      expect(broken!.error).toMatch(/JSON/i)
    } finally {
      await fx.cleanup()
    }
  })

  it("忽略非 .json 文件", async () => {
    const fx = await makeFixture()
    try {
      await writeFile(join(fx.themesDir, "notes.txt"), "hello")
      const r = await scanThemes(new NodeAdapter(), fx.themesDir)
      expect(r.failures.some((f) => f.path.endsWith("notes.txt"))).toBe(false)
    } finally {
      await fx.cleanup()
    }
  })

  it("结果按 theme 名称不区分大小写排序，便于 UI 直接渲染", async () => {
    const fx = await makeFixture()
    try {
      const r = await scanThemes(new NodeAdapter(), fx.themesDir)
      const names = r.themes.map((t) => t.name.toLowerCase())
      // 必须用与实现相同的比较器。localeCompare 按标点权重排序，
      // 默认 sort() 按 UTF-16 码位，两者在 "a-b" 与 "a'b" 这类名字上结论相反。
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    } finally {
      await fx.cleanup()
    }
  })
})

describe("NodeAdapter", () => {
  it("isGameRunning 默认 false，可由构造参数覆盖", async () => {
    expect(await new NodeAdapter().isGameRunning()).toBe(false)
    expect(await new NodeAdapter({ gameRunning: true }).isGameRunning()).toBe(true)
  })

  it("writeFileAtomic 写入后可读回，且不留下临时文件", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const target = join(fx.root, "nested", "deep", "out.txt")
      await adapter.writeFileAtomic(target, new TextEncoder().encode("hello"))

      expect(new TextDecoder().decode(await adapter.readFile(target))).toBe("hello")
      expect((await readdir(join(fx.root, "nested", "deep"))).filter((f) => f.includes(".tmp"))).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("exists 对存在与不存在的路径给出正确结果", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      expect(await adapter.exists(fx.settingsPath)).toBe(true)
      expect(await adapter.exists(join(fx.root, "nope.txt"))).toBe(false)
    } finally {
      await fx.cleanup()
    }
  })
})
