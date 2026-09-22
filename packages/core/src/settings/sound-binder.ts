import type { PlatformAdapter } from "../platform/adapter.js"
import type { AudioLevels, SettingsPatch, SoundBinding } from "../types.js"
import { F, S } from "./keys.js"
import { readKey, type SettingsDoc } from "./settings-doc.js"

/** 游戏用字符串 "None" 表示未绑定 */
const NONE = "None"

/** 可播放的音效扩展名。.sfk 是音频编辑器的波形缓存，不是音效。 */
const SOUND_EXT = /\.(ogg|wav)$/i

const stripExt = (name: string) => name.replace(SOUND_EXT, "")
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * 列出可用音效名（不含扩展名），按名称不区分大小写排序。
 *
 * 同名的 .ogg 与 .wav 会被去重——语料中存在这种成对文件，
 * 不去重会让 UI 列表出现重复项。
 */
export async function listSounds(adapter: PlatformAdapter, soundsDir: string): Promise<string[]> {
  const entries = await adapter.listDir(soundsDir)
  const unique = new Set(entries.filter((f) => SOUND_EXT.test(f)).map(stripExt))
  return [...unique].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

function readSound(doc: SettingsDoc, key: string): string | null {
  const v = readKey(doc, "stringSettings", key)
  if (typeof v !== "string" || v === NONE || v === "") return null
  return v
}

export function readSoundBinding(doc: SettingsDoc): SoundBinding {
  return {
    killConfirmed: readSound(doc, S("KillConfirmedSound")),
    spawn: readSound(doc, S("SpawnSound")),
    mbsGood: readSound(doc, S("MBSGoodSound")),
    mbsOkay: readSound(doc, S("MBSOkaySound")),
    mbsBad: readSound(doc, S("MBSBadSound")),
    mbsChangeNow: readSound(doc, S("MBSChangeNowSound")),
  }
}

export function readAudioLevels(doc: SettingsDoc): AudioLevels {
  const f = (key: string, fallback: number) => {
    const v = readKey(doc, "floatSettings", key)
    return typeof v === "number" ? v : fallback
  }
  return {
    hitVolume: f(F("HitVolume"), 1),
    hitPitch: f(F("HitPitch"), 1),
    critVolume: f(F("CritVolume"), 1),
    critPitch: f(F("CritPitch"), 1),
  }
}

export function soundsToPatch(binding: SoundBinding, audio: AudioLevels): SettingsPatch {
  const name = (v: string | null) => (v === null || v === "" ? NONE : stripExt(v))
  return {
    stringSettings: {
      [S("KillConfirmedSound")]: name(binding.killConfirmed),
      [S("SpawnSound")]: name(binding.spawn),
      [S("MBSGoodSound")]: name(binding.mbsGood),
      [S("MBSOkaySound")]: name(binding.mbsOkay),
      [S("MBSBadSound")]: name(binding.mbsBad),
      [S("MBSChangeNowSound")]: name(binding.mbsChangeNow),
    },
    floatSettings: {
      [F("HitVolume")]: clamp(audio.hitVolume, 0, 1),
      [F("HitPitch")]: clamp(audio.hitPitch, 0.5, 2),
      [F("CritVolume")]: clamp(audio.critVolume, 0, 1),
      [F("CritPitch")]: clamp(audio.critPitch, 0.5, 2),
    },
  }
}
