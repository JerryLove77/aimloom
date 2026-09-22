export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

/** A validation/refusal error carrying both languages. `.message` (from `super(zh)`) stays the
 * Chinese text, so existing tests and Node callers that only read `.message` are unaffected. */
export class LocalizedError extends Error {
  constructor(readonly zh: string, readonly en: string) {
    super(zh)
  }
}

/** Theme 中的颜色向量，各分量 0–1 */
export type Vec3 = { x: number; y: number; z: number }

/** 天空颜色，各分量 0–255。注意字段顺序与游戏一致：b, g, r, a */
export type Rgba = { b: number; g: number; r: number; a: number }

export type Surface = {
  material: string
  tint: Vec3
  roughness: number
  metallic: number
  fullBright: number
  textureScale: number
}

export type EnemyAppearance = {
  headColor: Vec3
  bodyColor: Vec3
  headColorOnHit: Vec3
  bodyColorOnHit: Vec3
  headColorOnLookAt: Vec3
  bodyColorOnLookAt: Vec3
  roughness: number
  metallic: number
  fullBright: number
  overrideHead: boolean
  overrideBody: boolean
  changeOnHit: boolean
  changeOnLookAt: boolean
  bodyColorAsAttackColor: boolean
  glowUpHead: number
  glowUpBody: number
  glowUpHeadOnHit: number
  glowUpBodyOnHit: number
  glowUpHeadOnLookAt: number
  glowUpBodyOnLookAt: number
}

export type SkyAppearance = {
  presetId: number
  cloudCoverId: number
  solid: boolean
  sunVisible: boolean
  color: Rgba
}

export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be"

export type ThemeSource = {
  path: string
  encoding: Encoding
  /** 原文件缺失、由默认值或回退填充的字段名 */
  missingFields: string[]
  /** 值越界被钳制等非致命问题 */
  warnings: string[]
}

export type Theme = {
  name: string
  wall: Surface
  floor: Surface
  ceiling: Surface
  ramp: Surface
  enemy: EnemyAppearance
  team: { glowUpHead: number; glowUpBody: number }
  sky: SkyAppearance
  source: ThemeSource
}

export type Section =
  | "booleanSettings"
  | "integerSettings"
  | "floatSettings"
  | "stringSettings"
  | "vectorSettings"
  | "colorSettings"

/** 待写入 PrimaryUserSettings 的补丁。键为含前缀的完整键名。 */
export type SettingsPatch = Partial<Record<Section, Record<string, JsonValue>>>

export type SoundBinding = {
  killConfirmed: string | null
  spawn: string | null
  mbsGood: string | null
  mbsOkay: string | null
  mbsBad: string | null
  mbsChangeNow: string | null
}

export type AudioLevels = {
  hitVolume: number
  hitPitch: number
  critVolume: number
  critPitch: number
}

export type Profile = {
  id: string
  name: string
  createdAt: string
  source?: { kind: "import" | "local" | "web"; author?: string; url?: string }
  theme: { name: string; hash: string } | null
  sounds: SoundBinding
  audio: AudioLevels
  extras?: { paletteIni?: string; uiJson?: string }
}
