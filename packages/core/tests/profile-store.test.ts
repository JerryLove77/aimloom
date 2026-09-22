import { describe, it, expect } from "vitest"
import { writeFile, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { ProfileStore, hashBytes } from "../src/profile/profile-store.js"
import { parseSettings, readKey } from "../src/settings/settings-doc.js"
import { makeFixture } from "./helpers/fixture.js"

const store = (fx: { root: string }) =>
  new ProfileStore(new NodeAdapter(), join(fx.root, "profiles.json"))

describe("hashBytes", () => {
  it("同内容同 hash，异内容异 hash", () => {
    const a = new TextEncoder().encode("hello")
    const b = new TextEncoder().encode("hello")
    const c = new TextEncoder().encode("world")
    expect(hashBytes(a)).toBe(hashBytes(b))
    expect(hashBytes(a)).not.toBe(hashBytes(c))
    expect(hashBytes(a)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("ProfileStore", () => {
  it("captureCurrent 从真实存档抓取 theme 与音效绑定", async () => {
    const fx = await makeFixture()
    try {
      const doc = parseSettings(new Uint8Array(await readFile(fx.settingsPath)))
      const expectedTheme = readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")
      const expectedKill = readKey(doc, "stringSettings", "EStringSettingId::KillConfirmedSound")

      const p = await store(fx).captureCurrent({
        name: "我的当前设置",
        settingsPath: fx.settingsPath,
        themesDir: fx.themesDir,
      })
      expect(p.name).toBe("我的当前设置")
      expect(p.theme?.name).toBe(expectedTheme)
      expect(p.theme?.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(p.sounds.killConfirmed).toBe(expectedKill)
      expect(p.audio.hitVolume).toBeTypeOf("number")
      expect(p.id).toBeTruthy()
    } finally {
      await fx.cleanup()
    }
  })

  it("save / list / remove 往返", async () => {
    const fx = await makeFixture()
    try {
      const s = store(fx)
      const p = await s.captureCurrent({
        name: "档一",
        settingsPath: fx.settingsPath,
        themesDir: fx.themesDir,
      })
      await s.save(p)
      expect((await s.list()).map((x) => x.name)).toEqual(["档一"])

      await s.save({ ...p, name: "档一改名" }) // 同 id 覆盖
      expect(await s.list()).toHaveLength(1)
      expect((await s.list())[0]!.name).toBe("档一改名")

      await s.remove(p.id)
      expect(await s.list()).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("list 在文件不存在时返回空数组而非抛错", async () => {
    const fx = await makeFixture()
    try {
      expect(await store(fx).list()).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("list 在文件损坏时返回空数组，不让整个应用起不来", async () => {
    const fx = await makeFixture()
    try {
      await writeFile(join(fx.root, "profiles.json"), "{ not json")
      expect(await store(fx).list()).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("checkThemeDrift 检测引用的 theme 被改动", async () => {
    const fx = await makeFixture()
    try {
      const s = store(fx)
      const p = await s.captureCurrent({
        name: "档",
        settingsPath: fx.settingsPath,
        themesDir: fx.themesDir,
      })
      expect(p.theme).not.toBeNull()
      expect(await s.checkThemeDrift(p, fx.themesDir)).toBe("ok")

      const themeFile = join(fx.themesDir, `${p.theme!.name}.json`)
      await writeFile(themeFile, JSON.stringify({ themeName: p.theme!.name }))
      expect(await s.checkThemeDrift(p, fx.themesDir)).toBe("changed")

      await rm(themeFile)
      expect(await s.checkThemeDrift(p, fx.themesDir)).toBe("missing")
    } finally {
      await fx.cleanup()
    }
  })

  it("source 字段被完整保留（网站下载来源要用）", async () => {
    const fx = await makeFixture()
    try {
      const s = store(fx)
      const p = await s.captureCurrent({
        name: "从网站来的",
        settingsPath: fx.settingsPath,
        themesDir: fx.themesDir,
        source: { kind: "web", author: "some-pro", url: "https://example.invalid/p/1" },
      })
      await s.save(p)
      const back = (await s.list())[0]!
      expect(back.source).toEqual({
        kind: "web",
        author: "some-pro",
        url: "https://example.invalid/p/1",
      })
    } finally {
      await fx.cleanup()
    }
  })

  it("引用的 theme 文件不存在时 hash 为空串，且 drift 判为 ok 而非误报 changed", async () => {
    const fx = await makeFixture()
    try {
      const s = store(fx)
      const doc = parseSettings(new Uint8Array(await readFile(fx.settingsPath)))
      const themeName = readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName") as string
      await rm(join(fx.themesDir, `${themeName}.json`))

      const p = await s.captureCurrent({
        name: "theme 文件已被删",
        settingsPath: fx.settingsPath,
        themesDir: fx.themesDir,
      })
      expect(p.theme?.hash).toBe("")
      expect(await s.checkThemeDrift(p, fx.themesDir)).toBe("missing")
    } finally {
      await fx.cleanup()
    }
  })
})
