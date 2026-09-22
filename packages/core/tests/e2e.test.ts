import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  BackupManager,
  NodeAdapter,
  ProfileStore,
  THEME_KEYS,
  SOUND_KEYS,
  applySettingsPatch,
  findMissingSounds,
  installTheme,
  listSounds,
  parseSettings,
  readKey,
  scanThemes,
  soundsToPatch,
  themeToPatch,
} from "../src/index.js"
import { makeFixture } from "./helpers/fixture.js"

const readDoc = async (p: string) => parseSettings(new Uint8Array(await readFile(p)))

const NO_SOUNDS = {
  killConfirmed: null,
  spawn: null,
  mbsGood: null,
  mbsOkay: null,
  mbsBad: null,
  mbsChangeNow: null,
}

describe("端到端：应用背景 + 音效 + 回滚", () => {
  it("完整流程走通，且手感设置分毫未动", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const backup = new BackupManager(adapter, join(fx.root, "backups"))

      const before = await readDoc(fx.settingsPath)
      const sensBefore = {
        x: readKey(before, "floatSettings", "EFloatSettingId::XSens"),
        y: readKey(before, "floatSettings", "EFloatSettingId::YSens"),
        dpi: readKey(before, "integerSettings", "EIntegerSettingId::DPI"),
        fov: readKey(before, "floatSettings", "EFloatSettingId::FOV"),
        scale: readKey(before, "stringSettings", "EStringSettingId::FOVScaleString"),
      }
      const originalTheme = readKey(before, "stringSettings", "EStringSettingId::CurrentThemeName")

      // 1. 扫描并挑一个 theme
      const scan = await scanThemes(adapter, fx.themesDir)
      const target = scan.themes.find((t) => t.name.length > 0)!
      expect(target).toBeDefined()

      // 2. 应用背景
      const themeResult = await applySettingsPatch({
        adapter,
        backup,
        settingsPath: fx.settingsPath,
        patch: themeToPatch(target),
        allow: THEME_KEYS,
        label: `apply theme ${target.name}`,
      })
      expect(themeResult.ok).toBe(true)
      if (!themeResult.ok) return
      expect(themeResult.unknownKeys).toEqual([])

      let doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe(target.name)
      expect(readKey(doc, "stringSettings", "EStringSettingId::WallMaterial")).toBe(
        target.wall.material,
      )

      // 3. 应用音效（先确认引用完整性）
      const sounds = await listSounds(adapter, fx.soundsDir)
      const pick = sounds[0]!
      const binding = { ...NO_SOUNDS, killConfirmed: pick }
      expect(await findMissingSounds(adapter, fx.soundsDir, binding)).toEqual([])

      const soundResult = await applySettingsPatch({
        adapter,
        backup,
        settingsPath: fx.settingsPath,
        patch: soundsToPatch(binding, {
          hitVolume: 0.8,
          hitPitch: 1,
          critVolume: 1,
          critPitch: 1,
        }),
        allow: SOUND_KEYS,
        label: `apply sound ${pick}`,
      })
      expect(soundResult.ok).toBe(true)
      if (!soundResult.ok) return

      doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::KillConfirmedSound")).toBe(pick)
      expect(readKey(doc, "floatSettings", "EFloatSettingId::HitVolume")).toBe(0.8)

      // 4. 手感设置全程未变
      expect({
        x: readKey(doc, "floatSettings", "EFloatSettingId::XSens"),
        y: readKey(doc, "floatSettings", "EFloatSettingId::YSens"),
        dpi: readKey(doc, "integerSettings", "EIntegerSettingId::DPI"),
        fov: readKey(doc, "floatSettings", "EFloatSettingId::FOV"),
        scale: readKey(doc, "stringSettings", "EStringSettingId::FOVScaleString"),
      }).toEqual(sensBefore)

      // 5. 回滚到音效应用前：音效复原，背景仍是刚才那个
      await backup.restore(soundResult.backupId)
      doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::KillConfirmedSound")).toBe(
        readKey(before, "stringSettings", "EStringSettingId::KillConfirmedSound"),
      )
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe(target.name)

      // 6. 回到出厂
      await backup.restorePristine()
      doc = await readDoc(fx.settingsPath)
      expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe(originalTheme)
      expect(doc.raw).toEqual(before.raw)
    } finally {
      await fx.cleanup()
    }
  })

  it("配置档能捕获并检测漂移", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const store = new ProfileStore(adapter, join(fx.root, "profiles.json"))
      const p = await store.captureCurrent({
        name: "出厂",
        settingsPath: fx.settingsPath,
        themesDir: fx.themesDir,
        source: { kind: "import", author: "KVK Settings 2025" },
      })
      await store.save(p)

      expect((await store.list())[0]!.source?.author).toBe("KVK Settings 2025")
      expect(await store.checkThemeDrift(p, fx.themesDir)).toBe("ok")
    } finally {
      await fx.cleanup()
    }
  })

  it("安装外来 theme 后立即应用它，身份对齐使 CurrentThemeName 与文件名一致", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const backup = new BackupManager(adapter, join(fx.root, "backups"))

      // 拿一个文件名与内部 themeName 不一致的真实 theme，重新安装以对齐
      const source = new Uint8Array(await readFile(join(fx.themesDir, "Hauntr.json")))
      const installed = await installTheme({
        adapter,
        themesDir: fx.themesDir,
        bytes: source,
        displayName: "Hauntr",
        overwrite: true,
      })
      expect(installed.ok).toBe(true)
      if (!installed.ok) return

      const scan = await scanThemes(adapter, fx.themesDir)
      const theme = scan.themes.find((t) => t.name === installed.canonicalName)!
      expect(theme).toBeDefined()

      const r = await applySettingsPatch({
        adapter,
        backup,
        settingsPath: fx.settingsPath,
        patch: themeToPatch(theme),
        allow: THEME_KEYS,
        label: "apply freshly installed theme",
      })
      expect(r.ok).toBe(true)

      const doc = await readDoc(fx.settingsPath)
      const current = readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")
      // 写进存档的名字，与磁盘上的文件名 stem 完全一致
      expect(current).toBe(installed.fileName.replace(/\.json$/, ""))
    } finally {
      await fx.cleanup()
    }
  })
})
