import { describe, it, expect } from "vitest"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import type { PlatformAdapter } from "../src/platform/adapter.js"
import { BackupManager } from "../src/safety/backup.js"
import { applySettingsPatch } from "../src/safety/apply.js"
import { THEME_KEYS, SOUND_KEYS } from "../src/settings/keys.js"
import { parseSettings, readKey } from "../src/settings/settings-doc.js"
import { makeFixture } from "./helpers/fixture.js"

const readDoc = async (p: string) => parseSettings(new Uint8Array(await readFile(p)))

/**
 * The corpus at fixture.ts's PACK_SOURCE is the real one privately and a neutral synthetic
 * one in the public export (scripts/public/sample-corpus); their XSens/DPI values differ.
 * Read the fixture's own JSON for the expected (pre-patch) value instead of hard-coding it.
 */
const readRawSettings = async (p: string): Promise<any> => JSON.parse(await readFile(p, "utf-8"))

describe("applySettingsPatch", () => {
  it("正常路径：写入成功并返回 backupId", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "apply 3 AM",
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.written).toEqual(["EStringSettingId::CurrentThemeName"])

      const doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe("3 AM")
    } finally {
      await fx.cleanup()
    }
  })

  it("游戏运行中一律拒写，文件不变", async () => {
    const fx = await makeFixture()
    try {
      const before = await readFile(fx.settingsPath)
      const adapter = new NodeAdapter({ gameRunning: true })
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "should be blocked",
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe("game-running")

      const after = await readFile(fx.settingsPath)
      expect(after.equals(before)).toBe(true)
    } finally {
      await fx.cleanup()
    }
  })

  it("手感设置在任何情况下都不被写入", async () => {
    const fx = await makeFixture()
    try {
      const original = await readRawSettings(fx.settingsPath)
      const originalXSens = original.floatSettings["EFloatSettingId::XSens"]
      const originalDpi = original.integerSettings["EIntegerSettingId::DPI"]
      // sabotage values are offset from the real originals, never a fixed literal, so the
      // final assertion can't coincidentally pass just because the corpus already held it
      const sabotageXSens = originalXSens + 957
      const sabotageDpi = originalDpi + 800

      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        // 恶意 patch：白名单被撑大到包含 XSens
        patch: {
          floatSettings: { "EFloatSettingId::XSens": sabotageXSens, "EFloatSettingId::HitVolume": 0.5 },
          integerSettings: { "EIntegerSettingId::DPI": sabotageDpi },
        },
        allow: new Set([...SOUND_KEYS, "EFloatSettingId::XSens", "EIntegerSettingId::DPI"]),
        label: "sabotage attempt",
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.rejected).toContain("EFloatSettingId::XSens")
      expect(r.rejected).toContain("EIntegerSettingId::DPI")

      const doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "floatSettings", "EFloatSettingId::XSens")).toBe(originalXSens)
      expect(readKey(doc, "integerSettings", "EIntegerSettingId::DPI")).toBe(originalDpi)
      expect(readKey(doc, "floatSettings", "EFloatSettingId::HitVolume")).toBe(0.5)
    } finally {
      await fx.cleanup()
    }
  })

  it("白名单之外的键不写入，其余键值逐一不变", async () => {
    const fx = await makeFixture()
    try {
      const before = await readDoc(fx.settingsPath)
      const adapter = new NodeAdapter()
      await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "single key",
      })
      const after = await readDoc(fx.settingsPath)

      const expected = JSON.parse(JSON.stringify(before.raw))
      expected.stringSettings["EStringSettingId::CurrentThemeName"] = "3 AM"
      expect(after.raw).toEqual(expected)
    } finally {
      await fx.cleanup()
    }
  })

  it("写后校验失败时自动回滚", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      // 委托给真实 adapter，但把写入内容替换成损坏的 JSON，模拟磁盘异常
      const sabotaged: PlatformAdapter = {
        isGameRunning: () => adapter.isGameRunning(),
        exists: (p) => adapter.exists(p),
        readFile: (p) => adapter.readFile(p),
        listDir: (p) => adapter.listDir(p),
        stat: (p) => adapter.stat(p),
        mkdirp: (p) => adapter.mkdirp(p),
        copyFile: (a, b) => adapter.copyFile(a, b),
        removeFile: (p) => adapter.removeFile(p),
        removeDir: (p) => adapter.removeDir(p),
        writeFileAtomic: (p) =>
          adapter.writeFileAtomic(p, new TextEncoder().encode("{ corrupted")),
      }

      const r = await applySettingsPatch({
        adapter: sabotaged,
        // 备份走真实 adapter，否则备份本身也会被写坏
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "corrupt write",
      })

      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe("verify-failed")
      expect(r.rolledBack).toBe(true)

      // 回滚后文件仍是合法 JSON 且内容为原值
      const doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe(
        "clover-alternate",
      )
    } finally {
      await fx.cleanup()
    }
  })

  it("首次调用会建立 pristine 快照", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const backup = new BackupManager(adapter, join(fx.root, "backups"))
      await applySettingsPatch({
        adapter,
        backup,
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "first apply",
      })

      await writeFile(fx.settingsPath, '{"gone":1}')
      await backup.restorePristine()
      const doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe(
        "clover-alternate",
      )
    } finally {
      await fx.cleanup()
    }
  })

  it("存档文件本身已损坏时拒绝写入，且不改动它", async () => {
    const fx = await makeFixture()
    try {
      await writeFile(fx.settingsPath, "{ this file is already broken")
      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: fx.settingsPath,
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "on a broken file",
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe("io-error")
      expect(await readFile(fx.settingsPath, "utf-8")).toBe("{ this file is already broken")
    } finally {
      await fx.cleanup()
    }
  })

  it("存档文件不存在时报 io-error 而不是崩溃", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const r = await applySettingsPatch({
        adapter,
        backup: new BackupManager(adapter, join(fx.root, "backups")),
        settingsPath: join(fx.root, "nowhere", "PrimaryUserSettings.json"),
        patch: { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } },
        allow: THEME_KEYS,
        label: "missing file",
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe("io-error")
    } finally {
      await fx.cleanup()
    }
  })
})
