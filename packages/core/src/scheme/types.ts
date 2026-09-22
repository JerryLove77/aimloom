import type { SkyAppearance, Surface } from "../types.js"

export const SURFACE_SLOTS = ["wall", "floor", "ceiling", "ramp"] as const
export type SurfaceSlot = (typeof SURFACE_SLOTS)[number]
export type SchemeEnvironment = Record<SurfaceSlot, Surface> & { sky: SkyAppearance }

/** Small, JSON-serializable authoring format; independent of providers and file storage. */
export type SchemeDocument = {
  schemaVersion: 1
  name: string
  environment: SchemeEnvironment
  provenance?: { kind: "imported" | "local" | "generated"; generator?: string }
  warnings: string[]
}

/** Profile stores only the selected filename and path; null keeps current. */
export type SchemeSelection = { name: string; path: string } | null
export type SchemeFileReader = (file: string) => Promise<Uint8Array>
