import { describe, it, expect } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { installTheme } from "../src/install/install-theme.js"
import { makeFixture } from "./helpers/fixture.js"

const bytesOf = (o: unknown) => new TextEncoder().encode(JSON.stringify(o, null, "\t"))

const VALID = {
  themeName: "内部名字",
  wallMaterial: "MARBLE POLISHED",
  wallRoughness: 1,
  wallMetallic: 0,
  wallFullBright: 0,
  wallTint: { x: 1, y: 1, z: 1 },
  floorMaterial: "DRYWALL",
  floorRoughness: 1,
  floorMetallic: 0,
  floorFullBright: 0,
  floorTint: { x: 1, y: 1, z: 1 },
  overrideEnemyHeadColor: true,
  overrideEnemyBodyColor: true,
  setEnemyBodyColorAsAttackColor: false,
  enemyColorRoughness: 1,
  enemyColorMetallic: 0,
  enemyColorFullBright: 0,
  enemyHeadColor: { x: 1, y: 0, z: 0 },
  enemyBodyColor: { x: 0, y: 1, z: 0 },
  skyPresetId: 0,
  cloudCoverId: 0,
  solidSkyColor: false,
  sunVisible: false,
  skyColor: { b: 1, g: 2, r: 3, a: 4 },
}

describe("installTheme 身份对齐（C1）", () => {
  it("文件名 stem 与写入后的 themeName 相等", async () => {
    const fx = await makeFixture()
    try {
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf(VALID),
        displayName: "我的主题",
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.fileName).toBe("我的主题.json")
      expect(r.canonicalName).toBe("我的主题")

      const written = JSON.parse(await readFile(join(fx.themesDir, r.fileName), "utf-8"))
      expect(written.themeName).toBe("我的主题") // 内容里的名字被改写成与文件名一致
    } finally {
      await fx.cleanup()
    }
  })

  it("未给 displayName 时用文件内部的 themeName", async () => {
    const fx = await makeFixture()
    try {
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf(VALID),
      })
      if (!r.ok) throw new Error(r.error)
      expect(r.canonicalName).toBe("内部名字")

      const written = JSON.parse(await readFile(join(fx.themesDir, r.fileName), "utf-8"))
      expect(written.themeName).toBe("内部名字")
    } finally {
      await fx.cleanup()
    }
  })

  it("在真实语料上修复文件名与 themeName 不一致（就地覆盖）", async () => {
    // 语料里约 20% 的 theme 是这种：文件叫 Hauntr.json，内部 themeName 却是 idk3。
    // CurrentThemeName 该写哪个尚未真机确认，所以安装时把两者强行对齐，两种读法都对。
    const fx = await makeFixture()
    try {
      const file = join(fx.themesDir, "Hauntr.json")
      const before = JSON.parse(await readFile(file, "utf-8"))
      expect(before.themeName).not.toBe("Hauntr") // 前提：语料确实不一致

      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: new Uint8Array(await readFile(file)),
        displayName: "Hauntr",
        overwrite: true,
      })
      if (!r.ok) throw new Error(r.error)
      expect(r.fileName).toBe("Hauntr.json")

      const after = JSON.parse(await readFile(file, "utf-8"))
      expect(after.themeName).toBe("Hauntr")
      expect(r.fileName.replace(/\.json$/, "")).toBe(after.themeName)
      // 除名字外其余内容一字未动
      expect(after).toEqual({ ...before, themeName: "Hauntr" })
    } finally {
      await fx.cleanup()
    }
  })

  it("不覆盖模式下，撞上语料里已有的名字时自动改名而非覆盖", async () => {
    const fx = await makeFixture()
    try {
      const original = await readFile(join(fx.themesDir, "Hauntr.json"), "utf-8")
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf({ ...VALID, themeName: "whatever" }),
        displayName: "Hauntr",
      })
      if (!r.ok) throw new Error(r.error)
      expect(r.fileName).toBe("Hauntr-2.json")
      expect(r.renamedFrom).toBe("Hauntr")
      // 原文件分毫未动
      expect(await readFile(join(fx.themesDir, "Hauntr.json"), "utf-8")).toBe(original)
    } finally {
      await fx.cleanup()
    }
  })

  it("空 themeName 被净化为 unnamed，且两侧一致", async () => {
    const fx = await makeFixture()
    try {
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf({ ...VALID, themeName: "" }),
      })
      if (!r.ok) throw new Error(r.error)
      expect(r.canonicalName).toBe("unnamed")
      const written = JSON.parse(await readFile(join(fx.themesDir, "unnamed.json"), "utf-8"))
      expect(written.themeName).toBe("unnamed")
    } finally {
      await fx.cleanup()
    }
  })
})

describe("installTheme 保留未知字段（兼容游戏版本演进）", () => {
  it("我们不认识的字段原样保留，不被规范化序列化吃掉", async () => {
    const fx = await makeFixture()
    try {
      const withFuture = {
        ...VALID,
        someFutureGameField: { nested: [1, 2, 3], flag: true },
        anotherUnknown: "keep me",
      }
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf(withFuture),
        displayName: "future",
      })
      if (!r.ok) throw new Error(r.error)

      const written = JSON.parse(await readFile(join(fx.themesDir, r.fileName), "utf-8"))
      expect(written.someFutureGameField).toEqual({ nested: [1, 2, 3], flag: true })
      expect(written.anotherUnknown).toBe("keep me")
      // 除 themeName 外其余字段逐一未变
      expect(written).toEqual({ ...withFuture, themeName: "future" })
    } finally {
      await fx.cleanup()
    }
  })

  it("UTF-16 输入被规范化为 UTF-8 写出，内容不变", async () => {
    const fx = await makeFixture()
    try {
      const json = JSON.stringify({ ...VALID, themeName: "utf16src" })
      const utf16 = new Uint8Array(2 + json.length * 2)
      utf16[0] = 0xff
      utf16[1] = 0xfe
      for (let i = 0; i < json.length; i++) {
        const c = json.charCodeAt(i)
        utf16[2 + i * 2] = c & 0xff
        utf16[2 + i * 2 + 1] = c >> 8
      }

      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: utf16,
        displayName: "from-utf16",
      })
      if (!r.ok) throw new Error(r.error)

      const raw = await readFile(join(fx.themesDir, r.fileName))
      expect(raw[0]).toBe(0x7b) // '{'，说明已是 UTF-8 而非 UTF-16
      expect(JSON.parse(raw.toString("utf-8")).themeName).toBe("from-utf16")
    } finally {
      await fx.cleanup()
    }
  })

  it("从语料里取一个真实 theme 装进去，除 themeName 外内容一字不差", async () => {
    const fx = await makeFixture()
    try {
      const sample = (await readdir(fx.themesDir)).find((f) => f.endsWith(".json") && f !== ".json")!
      const original = JSON.parse(await readFile(join(fx.themesDir, sample), "utf-8"))

      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: new Uint8Array(await readFile(join(fx.themesDir, sample))),
        displayName: "round-tripped",
      })
      if (!r.ok) throw new Error(r.error)

      const written = JSON.parse(await readFile(join(fx.themesDir, r.fileName), "utf-8"))
      expect(written).toEqual({ ...original, themeName: "round-tripped" })
    } finally {
      await fx.cleanup()
    }
  })
})

describe("installTheme 净化与冲突（C2、C3）", () => {
  it("非法字符被净化，文件真的落盘", async () => {
    const fx = await makeFixture()
    try {
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf(VALID),
        displayName: "bad/name:with*chars",
      })
      if (!r.ok) throw new Error(r.error)
      expect(r.fileName).toBe("bad_name_with_chars.json")
      expect((await readdir(fx.themesDir)).includes("bad_name_with_chars.json")).toBe(true)
    } finally {
      await fx.cleanup()
    }
  })

  it("默认不覆盖同名文件，改名为 -2 并报告 renamedFrom", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      await installTheme({ adapter, themesDir: fx.themesDir, bytes: bytesOf(VALID), displayName: "dup" })
      const second = await installTheme({
        adapter,
        themesDir: fx.themesDir,
        bytes: bytesOf(VALID),
        displayName: "dup",
      })
      if (!second.ok) throw new Error(second.error)
      expect(second.fileName).toBe("dup-2.json")
      expect(second.canonicalName).toBe("dup-2")
      expect(second.renamedFrom).toBe("dup")

      // 改名后身份仍对齐
      const written = JSON.parse(await readFile(join(fx.themesDir, "dup-2.json"), "utf-8"))
      expect(written.themeName).toBe("dup-2")
    } finally {
      await fx.cleanup()
    }
  })

  it("大小写不同也算冲突，不会静默覆盖", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      await installTheme({ adapter, themesDir: fx.themesDir, bytes: bytesOf(VALID), displayName: "Case" })
      const second = await installTheme({
        adapter,
        themesDir: fx.themesDir,
        bytes: bytesOf(VALID),
        displayName: "case",
      })
      if (!second.ok) throw new Error(second.error)
      expect(second.fileName).toBe("case-2.json")

      // 原文件仍在，没被覆盖
      const written = JSON.parse(await readFile(join(fx.themesDir, "Case.json"), "utf-8"))
      expect(written.themeName).toBe("Case")
    } finally {
      await fx.cleanup()
    }
  })

  it("overwrite: true 时覆盖同名文件且不改名", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      await installTheme({ adapter, themesDir: fx.themesDir, bytes: bytesOf(VALID), displayName: "ow" })
      const second = await installTheme({
        adapter,
        themesDir: fx.themesDir,
        bytes: bytesOf({ ...VALID, wallMaterial: "BRICK GREY" }),
        displayName: "ow",
        overwrite: true,
      })
      if (!second.ok) throw new Error(second.error)
      expect(second.fileName).toBe("ow.json")
      expect(second.renamedFrom).toBeNull()

      const written = JSON.parse(await readFile(join(fx.themesDir, "ow.json"), "utf-8"))
      expect(written.wallMaterial).toBe("BRICK GREY")
    } finally {
      await fx.cleanup()
    }
  })

  it("目标目录不存在时会被创建", async () => {
    const fx = await makeFixture()
    try {
      const dir = join(fx.root, "brand", "new", "Themes")
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: dir,
        bytes: bytesOf(VALID),
        displayName: "fresh",
      })
      if (!r.ok) throw new Error(r.error)
      expect(await readdir(dir)).toEqual(["fresh.json"])
    } finally {
      await fx.cleanup()
    }
  })
})

describe("installTheme 拒绝无效输入", () => {
  it("非 JSON 被拒绝，且不在目录里留下任何文件", async () => {
    const fx = await makeFixture()
    try {
      const before = (await readdir(fx.themesDir)).length
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: new TextEncoder().encode("not json"),
        displayName: "junk",
      })
      expect(r.ok).toBe(false)
      expect((await readdir(fx.themesDir)).length).toBe(before)
    } finally {
      await fx.cleanup()
    }
  })

  it("缺少必需字段的 JSON 被拒绝", async () => {
    const fx = await makeFixture()
    try {
      const r = await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf({ themeName: "只有名字" }),
        displayName: "incomplete",
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error).toBeTruthy()
    } finally {
      await fx.cleanup()
    }
  })

  it("安装不会破坏目录中已有的其他文件", async () => {
    const fx = await makeFixture()
    try {
      const existing = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))

      await installTheme({
        adapter: new NodeAdapter(),
        themesDir: fx.themesDir,
        bytes: bytesOf(VALID),
        displayName: "a-brand-new-theme",
      })

      const after = (await readdir(fx.themesDir)).filter((f) => f.endsWith(".json"))
      expect(after.length).toBe(existing.length + 1)
      for (const f of existing) expect(after).toContain(f)
    } finally {
      await fx.cleanup()
    }
  })
})
