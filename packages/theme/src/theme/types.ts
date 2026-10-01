import type { SkyAppearance, Surface } from "../types.js"

export const SURFACE_SLOTS = ["wall", "floor", "ceiling", "ramp"] as const
export type SurfaceSlot = (typeof SURFACE_SLOTS)[number]
export type ThemeEnvironment = Record<SurfaceSlot, Surface> & { sky: SkyAppearance }

/** Small, JSON-serializable authoring format; independent of providers and file storage. */
export type ThemeDocument = {
  schemaVersion: 1
  name: string
  environment: ThemeEnvironment
  provenance?: { kind: "imported" | "local" | "generated"; generator?: string }
  warnings: string[]
}
