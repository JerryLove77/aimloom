import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { BackupManager } from "../src/safety/backup.js"
import { applySettingsPatch } from "../src/safety/apply.js"
import { findMissingSounds, partitionByExistence, themeFileExists } from "../src/safety/integrity.js"
import { parseSettings, readKey } from "../src/settings/settings-doc.js"
import { themeToPatch } from "../src/settings/theme-applier.js"
import { soundsToPatch } from "../src/settings/sound-binder.js"
import { scanThemes } from "../src/theme/scan.js"
import { THEME_KEYS, SOUND_KEYS } from "../src/settings/keys.js"
import { makeFixture } from "./helpers/fixture.js"

const NO_SOUNDS = {
  killConfirmed: null,
  spawn: null,
  mbsGood: null,
  mbsOkay: null,
  mbsBad: null,
  mbsChangeNow: null,
}

const readRaw = async (p: string) => parseSettings(new Uint8Array(await readFile(p))).raw

describe("引用完整性（C4）", () => {
  it("findMissingSounds 报出 sounds/ 里不存在的绑定名", async () => {
    const fx = await makeFixture()
    try {
      const missing = await findMissingSounds(new NodeAdapter(), fx.soundsDir, {
        ...NO_SOUNDS,
        killConfirmed: "definitely-not-here",
        spawn: "also-missing",
      })
      expect(missing).toEqual(["definitely-not-here", "also-missing"])
    } finally {
      await fx.cleanup()
    }
  })

  it("null 绑定不算缺失", async () => {
    const fx = await makeFixture()
    try {
      expect(await findMissingSounds(new NodeAdapter(), fx.soundsDir, NO_SOUNDS)).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("已存在的音效不算缺失，.ogg 与 .wav 都认", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const files = await adapter.listDir(fx.soundsDir)
      const anyOgg = files.find((f) => f.endsWith(".ogg"))!.replace(/\.ogg$/, "")
      const anyWav = files.find((f) => f.endsWith(".wav"))!.replace(/\.wav$/, "")

      expect(
        await findMissingSounds(adapter, fx.soundsDir, {
          ...NO_SOUNDS,
          killConfirmed: anyOgg,
          spawn: anyWav,
        }),
      ).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("大小写不同也视为存在（Windows 与 macOS 文件系统如此）", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const anyOgg = (await adapter.listDir(fx.soundsDir))
        .find((f) => f.endsWith(".ogg"))!
        .replace(/\.ogg$/, "")
      expect(
        await findMissingSounds(adapter, fx.soundsDir, {
          ...NO_SOUNDS,
          killConfirmed: anyOgg.toUpperCase(),
        }),
      ).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })

  it("themeFileExists 正确判断 theme 文件在不在", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const scan = await scanThemes(adapter, fx.themesDir)
      const stem = scan.themes[1]!.source.path.split("/").pop()!.replace(/\.json$/, "")

      expect(await themeFileExists(adapter, fx.themesDir, stem)).toBe(true)
      expect(await themeFileExists(adapter, fx.themesDir, "no-such-theme")).toBe(false)
    } finally {
      await fx.cleanup()
    }
  })
})

describe("未知键策略（C5）", () => {
  it("partitionByExistence 把目标文件里没有的键挑出来", async () => {
    const fx = await makeFixture()
    const doc = parseSettings(new Uint8Array(await readFile(fx.settingsPath)))
    await fx.cleanup()

    const { known, unknown } = partitionByExistence(doc, {
      stringSettings: {
        "EStringSettingId::CurrentThemeName": "x", // 存在
        "EStringSettingId::TotallyNewKeyFromFutureVersion": "y", // 不存在
      },
    })
    expect(known.stringSettings).toEqual({ "EStringSettingId::CurrentThemeName": "x" })
    expect(unknown).toEqual(["EStringSettingId::TotallyNewKeyFromFutureVersion"])
  })

  it("applySettingsPatch 默认跳过未知键并在结果里报告", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: {
          stringSettings: {
            "EStringSettingId::CurrentThemeName": "renamed",
            "EStringSettingId::CurrentThemeName2": "ghost",
          },
        },
        allow: new Set([...THEME_KEYS, "EStringSettingId::CurrentThemeName2"]),
        label: "unknown key test",
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.unknownKeys).toEqual(["EStringSettingId::CurrentThemeName2"])
      expect(r.written).toEqual(["EStringSettingId::CurrentThemeName"])

      const doc = parseSettings(new Uint8Array(await readFile(fx.settingsPath)))
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe("renamed")
      // 未知键没有被新增进文件
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName2")).toBeUndefined()
    } finally {
      await fx.cleanup()
    }
  })

  it("skipUnknownKeys: false 时允许新增键", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::BrandNewKey": "v" } },
        allow: new Set(["EStringSettingId::BrandNewKey"]),
        label: "allow new key",
        skipUnknownKeys: false,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.unknownKeys).toEqual([])

      const doc = parseSettings(new Uint8Array(await readFile(fx.settingsPath)))
      expect(readKey(doc, "stringSettings", "EStringSettingId::BrandNewKey")).toBe("v")
    } finally {
      await fx.cleanup()
    }
  })

  it("整个 patch 都是未知键时，文件内容不变但仍算成功", async () => {
    const fx = await makeFixture()
    try {
      const before = await readRaw(fx.settingsPath)
      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::GhostA": "1", "EStringSettingId::GhostB": "2" } },
        allow: new Set(["EStringSettingId::GhostA", "EStringSettingId::GhostB"]),
        label: "all ghosts",
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.unknownKeys).toHaveLength(2)
      expect(r.written).toEqual([])
      expect(await readRaw(fx.settingsPath)).toEqual(before)
    } finally {
      await fx.cleanup()
    }
  })
})

describe("幂等性（C6）", () => {
  it("同一个 theme 连续应用两次，文件内容逐键相同", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const backup = new BackupManager(adapter, join(fx.root, "backups"))
      const scan = await scanThemes(adapter, fx.themesDir)
      const theme = scan.themes[1]!

      const apply = () =>
        applySettingsPatch({
          adapter,
          backup,
          settingsPath: fx.settingsPath,
          patch: themeToPatch(theme),
          allow: THEME_KEYS,
          label: "idempotence",
        })

      await apply()
      const first = await readRaw(fx.settingsPath)
      await apply()
      const second = await readRaw(fx.settingsPath)

      expect(second).toEqual(first)
    } finally {
      await fx.cleanup()
    }
  })

  it("语料中每个 theme 应用两次都幂等（抽样 10 个）", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const backup = new BackupManager(adapter, join(fx.root, "backups"))
      const scan = await scanThemes(adapter, fx.themesDir)

      for (const theme of scan.themes.slice(0, 10)) {
        const opts = {
          adapter,
          backup,
          settingsPath: fx.settingsPath,
          patch: themeToPatch(theme),
          allow: THEME_KEYS,
          label: `idempotence ${theme.name}`,
        }
        await applySettingsPatch(opts)
        const a = await readRaw(fx.settingsPath)
        await applySettingsPatch(opts)
        const b = await readRaw(fx.settingsPath)
        expect(b, `theme ${theme.name} 应用两次结果不一致`).toEqual(a)
      }
    } finally {
      await fx.cleanup()
    }
  })

  it("应用音效两次同样幂等", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const backup = new BackupManager(adapter, join(fx.root, "backups"))
      const anyOgg = (await adapter.listDir(fx.soundsDir))
        .find((f) => f.endsWith(".ogg"))!
        .replace(/\.ogg$/, "")

      const opts = {
        adapter,
        backup,
        settingsPath: fx.settingsPath,
        patch: soundsToPatch(
          { ...NO_SOUNDS, killConfirmed: anyOgg },
          { hitVolume: 0.7, hitPitch: 1, critVolume: 1, critPitch: 1 },
        ),
        allow: SOUND_KEYS,
        label: "sound idempotence",
      }
      await applySettingsPatch(opts)
      const a = await readRaw(fx.settingsPath)
      await applySettingsPatch(opts)
      const b = await readRaw(fx.settingsPath)
      expect(b).toEqual(a)
    } finally {
      await fx.cleanup()
    }
  })
})
