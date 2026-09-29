import { decodeText } from "./decode.js"
import type { EnemyAppearance, Rgba, Surface, Theme, ThemeSource, Vec3 } from "../types.js"

export type ParseResult = { ok: true; theme: Theme } | { ok: false; path: string; error: string }

const SKY_PRESET_MAX = 13
const CLOUD_COVER_MAX = 5

type Ctx = { missing: string[]; warnings: string[] }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback
}

function clamp01(n: number, label: string, ctx: Ctx): number {
  if (n < 0 || n > 1) {
    ctx.warnings.push(`${label} 越界 (${n})，已钳制到 [0,1]`)
    return Math.min(1, Math.max(0, n))
  }
  return n
}

function vec3(raw: unknown, label: string, ctx: Ctx, fallback: Vec3): Vec3 {
  if (!isObj(raw)) return fallback
  return {
    x: clamp01(num(raw.x, fallback.x), `${label}.x`, ctx),
    y: clamp01(num(raw.y, fallback.y), `${label}.y`, ctx),
    z: clamp01(num(raw.z, fallback.z), `${label}.z`, ctx),
  }
}

function rgba(raw: unknown, fallback: Rgba): Rgba {
  if (!isObj(raw)) return fallback
  const chan = (v: unknown, f: number) => Math.min(255, Math.max(0, Math.round(num(v, f))))
  return {
    b: chan(raw.b, fallback.b),
    g: chan(raw.g, fallback.g),
    r: chan(raw.r, fallback.r),
    a: chan(raw.a, fallback.a),
  }
}

/**
 * 解析一个表面。fallback 非 null 时（ceiling→wall、ramp→floor），
 * 若该表面的 Material 字段缺失，整体沿用 fallback。
 */
function surface(
  raw: Record<string, unknown>,
  prefix: "wall" | "floor" | "ceiling" | "ramp",
  ctx: Ctx,
  fallback: Surface | null,
): Surface {
  const materialKey = `${prefix}Material`
  if (typeof raw[materialKey] !== "string") {
    if (fallback) {
      ctx.missing.push(`${prefix}*`)
      return { ...fallback, tint: { ...fallback.tint } }
    }
    // wall / floor 是必需字段，交由调用方判定为解析失败
    throw new Error(`缺少必需字段 ${materialKey}`)
  }
  const scaleKey = `${prefix}TextureScale`
  if (typeof raw[scaleKey] !== "number") ctx.missing.push(scaleKey)

  return {
    material: raw[materialKey] as string,
    tint: vec3(raw[`${prefix}Tint`], `${prefix}Tint`, ctx, { x: 1, y: 1, z: 1 }),
    roughness: num(raw[`${prefix}Roughness`], 1),
    metallic: num(raw[`${prefix}Metallic`], 0),
    fullBright: num(raw[`${prefix}FullBright`], 0),
    textureScale: num(raw[scaleKey], 1),
  }
}

function enemy(raw: Record<string, unknown>, ctx: Ctx): EnemyAppearance {
  const headColor = vec3(raw.enemyHeadColor, "enemyHeadColor", ctx, { x: 1, y: 1, z: 1 })
  const bodyColor = vec3(raw.enemyBodyColor, "enemyBodyColor", ctx, { x: 1, y: 1, z: 1 })

  const derived = (key: string, base: Vec3): Vec3 => {
    if (!isObj(raw[key])) {
      ctx.missing.push(key)
      return { ...base }
    }
    return vec3(raw[key], key, ctx, base)
  }
  const glow = (key: string): number => {
    if (typeof raw[key] !== "number") ctx.missing.push(key)
    return num(raw[key], 1)
  }
  const flag = (key: string): boolean => {
    if (typeof raw[key] !== "boolean") ctx.missing.push(key)
    return bool(raw[key], false)
  }

  return {
    headColor,
    bodyColor,
    headColorOnHit: derived("enemyHeadColorOnHit", headColor),
    bodyColorOnHit: derived("enemyBodyColorOnHit", bodyColor),
    headColorOnLookAt: derived("enemyHeadColorOnLookAt", headColor),
    bodyColorOnLookAt: derived("enemyBodyColorOnLookAt", bodyColor),
    roughness: num(raw.enemyColorRoughness, 1),
    metallic: num(raw.enemyColorMetallic, 0),
    fullBright: num(raw.enemyColorFullBright, 0),
    overrideHead: bool(raw.overrideEnemyHeadColor, true),
    overrideBody: bool(raw.overrideEnemyBodyColor, true),
    changeOnHit: flag("changeEnemyColorOnHit"),
    changeOnLookAt: flag("changeEnemyColorOnLookAt"),
    bodyColorAsAttackColor: bool(raw.setEnemyBodyColorAsAttackColor, false),
    glowUpHead: glow("enemyGlowUpHead"),
    glowUpBody: glow("enemyGlowUpBody"),
    glowUpHeadOnHit: glow("enemyGlowUpHeadOnHit"),
    glowUpBodyOnHit: glow("enemyGlowUpBodyOnHit"),
    glowUpHeadOnLookAt: glow("enemyGlowUpHeadOnLookAt"),
    glowUpBodyOnLookAt: glow("enemyGlowUpBodyOnLookAt"),
  }
}

function intInRange(v: unknown, max: number, label: string, ctx: Ctx): number {
  const n = Math.round(num(v, 0))
  if (n < 0 || n > max) {
    ctx.warnings.push(`${label} 越界 (${n})，已回退到 0`)
    return 0
  }
  return n
}

function teamGlow(raw: Record<string, unknown>, key: string, ctx: Ctx): number {
  if (typeof raw[key] !== "number") {
    ctx.missing.push(key)
    return 1
  }
  return raw[key] as number
}

export function parseTheme(bytes: Uint8Array, path: string): ParseResult {
  let text: string
  let encoding: ThemeSource["encoding"]
  try {
    const decoded = decodeText(bytes)
    text = decoded.text
    encoding = decoded.encoding
  } catch (e) {
    return { ok: false, path, error: `解码失败: ${(e as Error).message}` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, path, error: `JSON 解析失败: ${(e as Error).message}` }
  }
  if (!isObj(raw)) return { ok: false, path, error: "JSON 顶层不是对象" }
  if (typeof raw.themeName !== "string") {
    return { ok: false, path, error: "缺少必需字段 themeName" }
  }

  const ctx: Ctx = { missing: [], warnings: [] }
  let wall: Surface
  let floor: Surface
  try {
    wall = surface(raw, "wall", ctx, null)
    floor = surface(raw, "floor", ctx, null)
  } catch (e) {
    return { ok: false, path, error: (e as Error).message }
  }

  const theme: Theme = {
    name: raw.themeName,
    wall,
    floor,
    ceiling: surface(raw, "ceiling", ctx, wall),
    ramp: surface(raw, "ramp", ctx, floor),
    enemy: enemy(raw, ctx),
    team: {
      glowUpHead: teamGlow(raw, "teamGlowUpHead", ctx),
      glowUpBody: teamGlow(raw, "teamGlowUpBody", ctx),
    },
    sky: {
      presetId: intInRange(raw.skyPresetId, SKY_PRESET_MAX, "skyPresetId", ctx),
      cloudCoverId: intInRange(raw.cloudCoverId, CLOUD_COVER_MAX, "cloudCoverId", ctx),
      solid: bool(raw.solidSkyColor, false),
      sunVisible: bool(raw.sunVisible, false),
      color: rgba(raw.skyColor, { b: 255, g: 255, r: 255, a: 255 }),
    },
    source: { path, encoding, missingFields: ctx.missing, warnings: ctx.warnings },
  }

  return { ok: true, theme }
}
