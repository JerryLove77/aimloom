import { describe, it, expect } from "vitest"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { parseSettings } from "../src/settings/settings-doc.js"
import {
  listSounds,
  readAudioLevels,
  readSoundBinding,
  soundsToPatch,
} from "../src/settings/sound-binder.js"
import { filterPatch } from "../src/settings/field-policy.js"
import { SOUND_KEYS } from "../src/settings/keys.js"
import { makeFixture } from "./helpers/fixture.js"

const LEVELS = { hitVolume: 1, hitPitch: 1, critVolume: 1, critPitch: 1 }

const NO_SOUNDS = {
  killConfirmed: null,
  spawn: null,
  mbsGood: null,
  mbsOkay: null,
  mbsBad: null,
  mbsChangeNow: null,
}

describe("listSounds", () => {
  it("返回不含扩展名、无重复、已排序的名字", async () => {
    const fx = await makeFixture()
    try {
      const names = await listSounds(new NodeAdapter(), fx.soundsDir)
      expect(names.length).toBeGreaterThan(0)
      expect(names.every((n) => !/\.(ogg|wav)$/i.test(n))).toBe(true)
      expect(new Set(names).size).toBe(names.length)
      expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())))
    } finally {
      await fx.cleanup()
    }
  })

  it("排除 .sfk 波形缓存——它不是音效", async () => {
    const fx = await makeFixture()
    try {
      await writeFile(join(fx.soundsDir, "waveform-cache.ogg.sfk"), Buffer.alloc(8))
      const names = await listSounds(new NodeAdapter(), fx.soundsDir)
      expect(names.some((n) => n.includes(".sfk"))).toBe(false)
      expect(names).not.toContain("waveform-cache.ogg")
    } finally {
      await fx.cleanup()
    }
  })

  it("同名的 .ogg 与 .wav 去重后只出现一次", async () => {
    const fx = await makeFixture()
    try {
      await writeFile(join(fx.soundsDir, "dual-format.ogg"), Buffer.alloc(8))
      await writeFile(join(fx.soundsDir, "dual-format.wav"), Buffer.alloc(8))
      const names = await listSounds(new NodeAdapter(), fx.soundsDir)
      expect(names.filter((n) => n === "dual-format")).toHaveLength(1)
    } finally {
      await fx.cleanup()
    }
  })

  it("只有 .wav 而无同名 .ogg 时也会被列出", async () => {
    const fx = await makeFixture()
    try {
      await writeFile(join(fx.soundsDir, "only-a-wav.wav"), Buffer.alloc(8))
      const names = await listSounds(new NodeAdapter(), fx.soundsDir)
      expect(names).toContain("only-a-wav")
    } finally {
      await fx.cleanup()
    }
  })

  it("带空格与非 ASCII 的文件名照常列出", async () => {
    const fx = await makeFixture()
    try {
      const names = await listSounds(new NodeAdapter(), fx.soundsDir)
      expect(names).toContain("Vice Hit 18")
      expect(names).toContain("音效测试")
      expect(names).toContain("Smári-hit")
    } finally {
      await fx.cleanup()
    }
  })
})

describe("readSoundBinding / readAudioLevels", () => {
  it('读出的绑定与存档中的原始字段一致，"None" 归一化为 null', async () => {
    const fx = await makeFixture()
    const raw = JSON.parse(await readFile(fx.settingsPath, "utf-8"))
    const doc = parseSettings(new Uint8Array(await readFile(fx.settingsPath)))
    await fx.cleanup()

    const norm = (v: unknown) => (typeof v === "string" && v !== "None" && v !== "" ? v : null)
    expect(readSoundBinding(doc)).toEqual({
      killConfirmed: norm(raw.stringSettings["EStringSettingId::KillConfirmedSound"]),
      spawn: norm(raw.stringSettings["EStringSettingId::SpawnSound"]),
      mbsGood: norm(raw.stringSettings["EStringSettingId::MBSGoodSound"]),
      mbsOkay: norm(raw.stringSettings["EStringSettingId::MBSOkaySound"]),
      mbsBad: norm(raw.stringSettings["EStringSettingId::MBSBadSound"]),
      mbsChangeNow: norm(raw.stringSettings["EStringSettingId::MBSChangeNowSound"]),
    })
    expect(readAudioLevels(doc)).toEqual({
      hitVolume: raw.floatSettings["EFloatSettingId::HitVolume"],
      hitPitch: raw.floatSettings["EFloatSettingId::HitPitch"],
      critVolume: raw.floatSettings["EFloatSettingId::CritVolume"],
      critPitch: raw.floatSettings["EFloatSettingId::CritPitch"],
    })
  })

  it('"None" 与空串都归一化为 null', () => {
    const doc = parseSettings(
      new TextEncoder().encode(
        JSON.stringify({
          stringSettings: {
            "EStringSettingId::KillConfirmedSound": "None",
            "EStringSettingId::SpawnSound": "",
            "EStringSettingId::MBSGoodSound": "real_sound",
          },
          floatSettings: {},
        }),
      ),
    )
    const b = readSoundBinding(doc)
    expect(b.killConfirmed).toBeNull()
    expect(b.spawn).toBeNull()
    expect(b.mbsGood).toBe("real_sound")
  })
})

describe("soundsToPatch", () => {
  it("绑定写入六个音效键", () => {
    const p = soundsToPatch({ ...NO_SOUNDS, killConfirmed: "Q3Railgun", spawn: "Bell5" }, LEVELS)
    expect(p.stringSettings!["EStringSettingId::KillConfirmedSound"]).toBe("Q3Railgun")
    expect(p.stringSettings!["EStringSettingId::SpawnSound"]).toBe("Bell5")
  })

  it('null 写成游戏认识的 "None"，不是空串', () => {
    const p = soundsToPatch(NO_SOUNDS, LEVELS)
    expect(p.stringSettings!["EStringSettingId::KillConfirmedSound"]).toBe("None")
  })

  it("传入带扩展名的文件名会被剥掉（.ogg 与 .wav 都认）", () => {
    expect(
      soundsToPatch({ ...NO_SOUNDS, killConfirmed: "Q3Railgun.ogg" }, LEVELS).stringSettings![
        "EStringSettingId::KillConfirmedSound"
      ],
    ).toBe("Q3Railgun")
    expect(
      soundsToPatch({ ...NO_SOUNDS, killConfirmed: "Health Hit 3.wav" }, LEVELS).stringSettings![
        "EStringSettingId::KillConfirmedSound"
      ],
    ).toBe("Health Hit 3")
  })

  it("音量钳制到 [0,1]，音调钳制到 [0.5,2]", () => {
    const p = soundsToPatch(NO_SOUNDS, {
      hitVolume: 5,
      hitPitch: 99,
      critVolume: -1,
      critPitch: 0,
    })
    expect(p.floatSettings!["EFloatSettingId::HitVolume"]).toBe(1)
    expect(p.floatSettings!["EFloatSettingId::HitPitch"]).toBe(2)
    expect(p.floatSettings!["EFloatSettingId::CritVolume"]).toBe(0)
    expect(p.floatSettings!["EFloatSettingId::CritPitch"]).toBe(0.5)
  })

  it("产出的键全部在 SOUND_KEYS 白名单内", () => {
    const p = soundsToPatch(
      { killConfirmed: "x", spawn: "y", mbsGood: "a", mbsOkay: "b", mbsBad: "c", mbsChangeNow: "d" },
      LEVELS,
    )
    expect(filterPatch(p, SOUND_KEYS).rejected).toEqual([])
  })

  it("绝不产出任何手感设置键", () => {
    const p = soundsToPatch({ ...NO_SOUNDS, killConfirmed: "x" }, LEVELS)
    const all = Object.values(p).flatMap((sec) => Object.keys(sec ?? {}))
    for (const k of all) expect(k).not.toMatch(/Sens|DPI|FOV|FILMS/)
  })
})
