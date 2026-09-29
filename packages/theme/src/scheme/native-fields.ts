import type { JsonValue } from "../types.js"
import { SURFACE_SLOTS, type SchemeEnvironment } from "./types.js"

/** One environment mapping for import diagnostics and native-theme composition. */
export function nativeEnvironmentFields(env: SchemeEnvironment): Record<string, JsonValue> {
  const fields: Record<string, JsonValue> = {}
  for (const slot of SURFACE_SLOTS) {
    const surface = env[slot]
    fields[`${slot}Material`] = surface.material
    fields[`${slot}Tint`] = surface.tint
    fields[`${slot}Roughness`] = surface.roughness
    fields[`${slot}Metallic`] = surface.metallic
    fields[`${slot}FullBright`] = surface.fullBright
    fields[`${slot}TextureScale`] = surface.textureScale
  }
  return {
    ...fields,
    skyPresetId: env.sky.presetId,
    cloudCoverId: env.sky.cloudCoverId,
    solidSkyColor: env.sky.solid,
    sunVisible: env.sky.sunVisible,
    skyColor: env.sky.color,
  }
}

/** JSON value equality without depending on object-property insertion order. */
export function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false
  const names = Object.keys(left)
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  return names.length === Object.keys(right).length && names.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]))
}
