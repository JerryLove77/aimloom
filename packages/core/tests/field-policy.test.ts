import { describe, it, expect } from "vitest"
import { NEVER_WRITE, SOUND_KEYS, THEME_KEYS, GATED_KEYS } from "../src/settings/keys.js"
import { filterPatch } from "../src/settings/field-policy.js"

describe("键集合的自洽性", () => {
  it("白名单与黑名单没有交集", () => {
    for (const k of THEME_KEYS) expect(NEVER_WRITE.has(k)).toBe(false)
    for (const k of SOUND_KEYS) expect(NEVER_WRITE.has(k)).toBe(false)
  })

  it("黑名单覆盖全部手感设置", () => {
    const required = [
      "EFloatSettingId::XSens",
      "EFloatSettingId::YSens",
      "EFloatSettingId::FOV",
      "EFloatSettingId::CustomYaw",
      "EFloatSettingId::CustomFOVYawMult",
      "EIntegerSettingId::DPI",
      "EIntegerSettingId::FOVScalarTargetEnum",
      "EIntegerSettingId::SensitivityScaleTargetEnum",
      "EIntegerSettingId::FILMSCustomAspectX",
      "EIntegerSettingId::FILMSCustomAspectY",
      "EStringSettingId::FOVScaleString",
      "EStringSettingId::SensScaleString",
      "EStringSettingId::FILMSCustomFOV",
    ]
    for (const k of required) expect(NEVER_WRITE.has(k)).toBe(true)
  })

  it("白名单不含 theme 文件里不存在的字段（spec §5.1 修正）", () => {
    const mustNotBeThere = [
      "EFloatSettingId::OnHitColorFadeIn",
      "EFloatSettingId::OnHitColorFadeOut",
      "EFloatSettingId::OnLookAtColorFadeIn",
      "EFloatSettingId::OnLookAtColorFadeOut",
      "EVectorSettingId::TeamHeadColor",
      "EVectorSettingId::TeamBodyColor",
      "EFloatSettingId::TeamRoughness",
      "EFloatSettingId::TeamMetallic",
      "EFloatSettingId::TeamFullBright",
    ]
    for (const k of mustNotBeThere) expect(THEME_KEYS.has(k)).toBe(false)
  })

  it("WallMat / FloorMat 处于 gated 状态，未进入 THEME_KEYS", () => {
    expect(GATED_KEYS.has("EIntegerSettingId::WallMat")).toBe(true)
    expect(GATED_KEYS.has("EIntegerSettingId::FloorMat")).toBe(true)
    expect(THEME_KEYS.has("EIntegerSettingId::WallMat")).toBe(false)
    expect(THEME_KEYS.has("EIntegerSettingId::FloorMat")).toBe(false)
  })

  it("音效白名单包含全部六个音效键与四个音量音调键", () => {
    for (const k of [
      "EStringSettingId::KillConfirmedSound",
      "EStringSettingId::SpawnSound",
      "EStringSettingId::MBSGoodSound",
      "EStringSettingId::MBSOkaySound",
      "EStringSettingId::MBSBadSound",
      "EStringSettingId::MBSChangeNowSound",
      "EFloatSettingId::HitVolume",
      "EFloatSettingId::HitPitch",
      "EFloatSettingId::CritVolume",
      "EFloatSettingId::CritPitch",
    ]) {
      expect(SOUND_KEYS.has(k)).toBe(true)
    }
  })

  it("EnemyMetalic 用游戏的拼写（少一个 l），且不含拼写正确的变体", () => {
    expect(THEME_KEYS.has("EFloatSettingId::EnemyMetalic")).toBe(true)
    expect(THEME_KEYS.has("EFloatSettingId::EnemyMetallic")).toBe(false)
  })

  it("两个白名单不重叠", () => {
    for (const k of THEME_KEYS) expect(SOUND_KEYS.has(k)).toBe(false)
  })
})

describe("filterPatch", () => {
  it("放行白名单内的键", () => {
    const { patch, rejected } = filterPatch(
      { stringSettings: { "EStringSettingId::CurrentThemeName": "x" } },
      THEME_KEYS,
    )
    expect(patch.stringSettings).toEqual({ "EStringSettingId::CurrentThemeName": "x" })
    expect(rejected).toEqual([])
  })

  it("剔除白名单外的键并记录", () => {
    const { patch, rejected } = filterPatch(
      {
        stringSettings: {
          "EStringSettingId::CurrentThemeName": "x",
          "EStringSettingId::StartupMode": "sandbox",
        },
      },
      THEME_KEYS,
    )
    expect(patch.stringSettings).toEqual({ "EStringSettingId::CurrentThemeName": "x" })
    expect(rejected).toEqual(["EStringSettingId::StartupMode"])
  })

  it("黑名单键即使被误列入白名单也会被剔除（第二道闸）", () => {
    const sabotaged = new Set([...THEME_KEYS, "EFloatSettingId::XSens"])
    const { patch, rejected } = filterPatch(
      { floatSettings: { "EFloatSettingId::XSens": 999 } },
      sabotaged,
    )
    expect(patch.floatSettings).toBeUndefined()
    expect(rejected).toContain("EFloatSettingId::XSens")
  })

  it("过滤后为空的 section 不出现在结果里", () => {
    const { patch } = filterPatch({ floatSettings: { "EFloatSettingId::FOV": 120 } }, THEME_KEYS)
    expect(patch).toEqual({})
  })

  it("不修改传入的 patch", () => {
    const input = { floatSettings: { "EFloatSettingId::FOV": 120 } }
    filterPatch(input, THEME_KEYS)
    expect(input.floatSettings["EFloatSettingId::FOV"]).toBe(120)
  })

  it("gated 键不被 THEME_KEYS 放行", () => {
    const { patch, rejected } = filterPatch(
      { integerSettings: { "EIntegerSettingId::WallMat": 50 } },
      THEME_KEYS,
    )
    expect(patch).toEqual({})
    expect(rejected).toContain("EIntegerSettingId::WallMat")
  })
})
