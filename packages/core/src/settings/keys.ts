import type { Section } from "../types.js"

export const B = (k: string) => `EBooleanSettingId::${k}`
export const I = (k: string) => `EIntegerSettingId::${k}`
export const F = (k: string) => `EFloatSettingId::${k}`
export const S = (k: string) => `EStringSettingId::${k}`
export const V = (k: string) => `EVectorSettingId::${k}`
export const C = (k: string) => `EColorSettingId::${k}`

export const SECTION_OF_PREFIX: Record<string, Section> = {
  "EBooleanSettingId::": "booleanSettings",
  "EIntegerSettingId::": "integerSettings",
  "EFloatSettingId::": "floatSettings",
  "EStringSettingId::": "stringSettings",
  "EVectorSettingId::": "vectorSettings",
  "EColorSettingId::": "colorSettings",
}

const SURFACES = ["Wall", "Floor", "Ceiling", "Ramp"] as const

/**
 * 应用背景时允许写入的键。
 *
 * 只列 ThemeApplier 真正会产出的键——theme 文件里没有的字段一律不授权。
 * 相对 spec §5.1 已剔除：*ColorFade*（theme 无 fade 字段）、
 * Team{Head,Body}Color 与 Team{Roughness,Metallic,FullBright}（theme 仅有 teamGlowUp*）。
 */
export const THEME_KEYS: ReadonlySet<string> = new Set<string>([
  S("CurrentThemeName"),
  ...SURFACES.map((s) => S(`${s}Material`)),
  ...SURFACES.map((s) => F(`${s}Roughness`)),
  ...SURFACES.map((s) => F(`${s}Metallic`)),
  ...SURFACES.map((s) => F(`${s}FullBright`)),
  ...SURFACES.map((s) => F(`${s}TextureScale`)),
  ...SURFACES.map((s) => V(`${s}Color`)),

  F("EnemyRoughness"),
  F("EnemyMetalic"), // 游戏侧拼写错误，少一个 l，必须照抄
  F("EnemyFullBright"),
  V("EnemyHeadColor"),
  V("EnemyBodyColor"),
  V("EnemyHeadColorOnHit"),
  V("EnemyBodyColorOnHit"),
  V("EnemyHeadColorOnLookAt"),
  V("EnemyBodyColorOnLookAt"),
  F("EnemyGlowUpHead"),
  F("EnemyGlowUpBody"),
  F("EnemyGlowUpHeadOnHit"),
  F("EnemyGlowUpBodyOnHit"),
  F("EnemyGlowUpHeadOnLookAt"),
  F("EnemyGlowUpBodyOnLookAt"),
  B("OverrideEnemyHeadColor"),
  B("OverrideEnemyBodyColor"),
  B("ChangeEnemyColorOnHit"),
  B("ChangeEnemyColorOnLookAt"),
  B("EnemyAttacksColoredByBody"),

  F("TeamGlowUpHead"),
  F("TeamGlowUpBody"),

  I("SkyPreset"),
  I("CloudCover"),
  B("SolidSkyColor"),
  B("ShowSunInSkybox"),
  C("SkyColor"),
])

/**
 * 待 spec §10.1 真机验证后才启用的键。
 *
 * integerSettings 中存在 WallMat / FloorMat，与 stringSettings 的
 * WallMaterial / FloorMaterial 并存，但没有对应的 CeilingMat / RampMat。
 * 在确认游戏读的是字符串还是整数索引之前，一律不写。
 */
export const GATED_KEYS: ReadonlySet<string> = new Set<string>([I("WallMat"), I("FloorMat")])

/** 应用音效时允许写入的键 */
export const SOUND_KEYS: ReadonlySet<string> = new Set<string>([
  S("KillConfirmedSound"),
  S("SpawnSound"),
  S("MBSGoodSound"),
  S("MBSOkaySound"),
  S("MBSBadSound"),
  S("MBSChangeNowSound"),
  F("HitVolume"),
  F("HitPitch"),
  F("CritVolume"),
  F("CritPitch"),
])

/**
 * 手感设置——任何写入路径都必须无条件剔除。
 * 与白名单相互独立：两者同时失效才会误改用户手感。
 */
export const NEVER_WRITE: ReadonlySet<string> = new Set<string>([
  F("XSens"),
  F("YSens"),
  F("FOV"),
  F("CustomYaw"),
  F("CustomFOVYawMult"),
  I("DPI"),
  I("FOVScalarTargetEnum"),
  I("SensitivityScaleTargetEnum"),
  I("FILMSCustomAspectX"),
  I("FILMSCustomAspectY"),
  S("FOVScaleString"),
  S("SensScaleString"),
  S("FILMSCustomFOV"),
])
