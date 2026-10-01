import { describe, expect, it } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import * as theme from "../src/index.js"

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const native = {
  themeName: "Evening", wallMaterial: "DRYWALL", floorMaterial: "MARBLE POLISHED",
  wallTint: { x: 0.2, y: 0.3, z: 0.4 }, floorTint: { x: 0.5, y: 0.6, z: 0.7 },
  solidSkyColor: true, skyColor: { r: 20, g: 40, b: 60, a: 255 },
  enemyBodyColor: { x: 1, y: 0, z: 0 }, enemyColorFullBright: 5,
}

describe("theme import and generated documents", () => {
  it("imports native background values without owning the source enemy", () => {
    const document = theme.parseThemeDocument(bytes(native))
    expect(document.environment.wall.tint).toEqual({ x: 0.2, y: 0.3, z: 0.4 })
    expect(document.environment.ceiling.material).toBe("DRYWALL")
    expect(document.environment).not.toHaveProperty("enemy")
    expect(document.warnings.length).toBeGreaterThan(0)
  })

  it("reports native fallback and clamping for every changed environment field", () => {
    const document = theme.parseThemeDocument(bytes({
      ...native, wallRoughness: "oops", solidSkyColor: "false",
      skyColor: { r: 999, g: 40, b: 60, a: 255 },
    }))
    expect(document.environment.wall.roughness).toBe(1)
    expect(document.environment.sky.solid).toBe(false)
    expect(document.environment.sky.color.r).toBe(255)
    for (const field of ["wallRoughness", "solidSkyColor", "skyColor"]) {
      expect(document.warnings.some((warning) => warning.includes(field)), field).toBe(true)
    }
  })

  it("does not warn for equivalent native colors with reordered properties", () => {
    const document = theme.parseThemeDocument(bytes({
      ...native, wallTint: { z: 0.4, x: 0.2, y: 0.3 },
      skyColor: { a: 255, r: 20, b: 60, g: 40 },
    }))
    expect(document.warnings.some((warning) => /wallTint|skyColor/.test(warning))).toBe(false)
  })

  it("round-trips a generated document through the same format and preview", () => {
    const generated = theme.parseThemeDocument(bytes(native))
    generated.name = "玩家场景"
    generated.provenance = { kind: "generated", generator: "future-provider" }
    generated.environment.floor.tint = { x: 0, y: 1, z: 0 }
    const reopened = theme.parseThemeDocument(theme.serializeThemeDocument(generated))
    expect(reopened.name).toBe("玩家场景")
    expect(reopened.provenance).toEqual({ kind: "generated", generator: "future-provider" })
    expect(theme.renderThemePreview(reopened)).toContain("#00ff00")
  })

  it.each([null, [], {}, { schemaVersion: 2 }, { ...native, wallMaterial: "" }, { ...native, themeName: "" }])(
    "rejects unusable input %j", (value) => {
      expect(() => theme.parseThemeDocument(bytes(value))).toThrow()
    },
  )

  it("rejects invalid generated values instead of silently changing the scene", () => {
    const generated = theme.parseThemeDocument(bytes(native))
    generated.environment.wall.textureScale = 0
    expect(() => theme.serializeThemeDocument(generated)).toThrow(/textureScale/)
    generated.environment.wall.textureScale = 1
    generated.environment.wall.tint.x = Number.NaN
    expect(() => theme.validateThemeDocument(generated)).toThrow(/tint/)
  })

  it("does not silently accept unsupported custom texture files", () => {
    const generated = theme.parseThemeDocument(bytes(native))
    expect(() => theme.validateThemeDocument({ ...generated, textures: { wall: "generated.png" } }))
      .toThrow(/textures/)
  })

  it("decodes BOM and UTF-16 theme files through the same theme importer", () => {
    const text = JSON.stringify(native)
    const little = Buffer.from(text, "utf16le")
    const big = Buffer.from(little)
    big.swap16()
    const variants = [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
      Buffer.concat([Buffer.from([0xff, 0xfe]), little]),
      Buffer.concat([Buffer.from([0xfe, 0xff]), big]),
    ]
    for (const encoded of variants) expect(theme.parseThemeDocument(encoded).environment.floor.material).toBe("MARBLE POLISHED")
  })

  it("rejects generated sky values and unknown nested properties", () => {
    const document = theme.parseThemeDocument(bytes(native))
    document.environment.sky.presetId = 99
    expect(() => theme.validateThemeDocument(document)).toThrow(/presetId/)
    document.environment.sky.presetId = 1
    document.environment.sky.color.r = 256
    expect(() => theme.validateThemeDocument(document)).toThrow(/color.r/)
    document.environment.sky.color.r = 20
    expect(() => theme.validateThemeDocument({ ...document, environment: { ...document.environment, wall: { ...document.environment.wall, textureFile: "x.png" } } })).toThrow(/textureFile/)
  })

  it("imports named community themes and reports the corpus's empty-name file", async () => {
    const root = fileURLToPath(new URL("../../../KVK Settings 2025/Themes/", import.meta.url))
    const files = (await readdir(root)).filter((name) => name.endsWith(".json"))
    for (const file of files) {
      const original = await readFile(root + file)
      if (file === ".json") {
        expect(() => theme.parseThemeDocument(original)).toThrow(/name/)
        continue
      }
      const document = theme.parseThemeDocument(original)
      expect(theme.parseThemeDocument(theme.serializeThemeDocument(document)).environment).toEqual(document.environment)
      expect(await readFile(root + file)).toEqual(original)
    }
  })
})

describe("offline preview", () => {
  it.each(["\ufffe", "\uffff", "\ud800", "\udfff"])("rejects XML-invalid text %j", (character) => {
    const document = theme.parseThemeDocument(bytes(native))
    document.name = `Scene ${character}`
    expect(() => theme.renderThemePreview(document)).toThrow(/name/)
    document.name = "Valid scene"
    document.environment.wall.material = `Material ${character}`
    expect(() => theme.renderThemePreview(document)).toThrow(/material/)
  })

  it("preserves valid astral Unicode text in previews", () => {
    const document = theme.parseThemeDocument(bytes(native))
    document.name = "玩家场景 🌤️"
    expect(theme.renderThemePreview(document)).toContain("玩家场景 🌤️")
  })

  it("escapes untrusted text and labels the limitations without fetching assets", () => {
    const document = theme.parseThemeDocument(bytes({ ...native, themeName: '<script>alert("x")</script>', wallMaterial: '<image href="https://bad.invalid/" />' }))
    const svg = theme.renderThemePreview(document)
    expect(svg).not.toContain("<script>")
    expect(svg).not.toContain('<image href="')
    expect(svg).toContain("&lt;script&gt;")
    expect(svg).toContain("近似预览")
    expect(svg).toContain("MARBLE POLISHED")
  })
})
