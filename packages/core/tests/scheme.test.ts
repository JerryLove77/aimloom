import { describe, expect, it } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import * as scheme from "../src/index.js"

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const native = {
  themeName: "Evening", wallMaterial: "DRYWALL", floorMaterial: "MARBLE POLISHED",
  wallTint: { x: 0.2, y: 0.3, z: 0.4 }, floorTint: { x: 0.5, y: 0.6, z: 0.7 },
  solidSkyColor: true, skyColor: { r: 20, g: 40, b: 60, a: 255 },
  enemyBodyColor: { x: 1, y: 0, z: 0 }, enemyColorFullBright: 5,
}

describe("scheme import and generated documents", () => {
  it("imports native background values without owning the source enemy", () => {
    const document = scheme.parseScheme(bytes(native))
    expect(document.environment.wall.tint).toEqual({ x: 0.2, y: 0.3, z: 0.4 })
    expect(document.environment.ceiling.material).toBe("DRYWALL")
    expect(document.environment).not.toHaveProperty("enemy")
    expect(document.warnings.length).toBeGreaterThan(0)
  })

  it("reports native fallback and clamping for every changed environment field", () => {
    const document = scheme.parseScheme(bytes({
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
    const document = scheme.parseScheme(bytes({
      ...native, wallTint: { z: 0.4, x: 0.2, y: 0.3 },
      skyColor: { a: 255, r: 20, b: 60, g: 40 },
    }))
    expect(document.warnings.some((warning) => /wallTint|skyColor/.test(warning))).toBe(false)
  })

  it("round-trips a generated document through the same format and preview", () => {
    const generated = scheme.parseScheme(bytes(native))
    generated.name = "玩家场景"
    generated.provenance = { kind: "generated", generator: "future-provider" }
    generated.environment.floor.tint = { x: 0, y: 1, z: 0 }
    const reopened = scheme.parseScheme(scheme.serializeScheme(generated))
    expect(reopened.name).toBe("玩家场景")
    expect(reopened.provenance).toEqual({ kind: "generated", generator: "future-provider" })
    expect(scheme.renderSchemePreview(reopened)).toContain("#00ff00")
  })

  it.each([null, [], {}, { schemaVersion: 2 }, { ...native, wallMaterial: "" }, { ...native, themeName: "" }])(
    "rejects unusable input %j", (value) => {
      expect(() => scheme.parseScheme(bytes(value))).toThrow()
    },
  )

  it("rejects invalid generated values instead of silently changing the scene", () => {
    const generated = scheme.parseScheme(bytes(native))
    generated.environment.wall.textureScale = 0
    expect(() => scheme.serializeScheme(generated)).toThrow(/textureScale/)
    generated.environment.wall.textureScale = 1
    generated.environment.wall.tint.x = Number.NaN
    expect(() => scheme.validateScheme(generated)).toThrow(/tint/)
  })

  it("does not silently accept unsupported custom texture files", () => {
    const generated = scheme.parseScheme(bytes(native))
    expect(() => scheme.validateScheme({ ...generated, textures: { wall: "generated.png" } }))
      .toThrow(/textures/)
  })

  it("decodes BOM and UTF-16 theme files through the same scheme importer", () => {
    const text = JSON.stringify(native)
    const little = Buffer.from(text, "utf16le")
    const big = Buffer.from(little)
    big.swap16()
    const variants = [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
      Buffer.concat([Buffer.from([0xff, 0xfe]), little]),
      Buffer.concat([Buffer.from([0xfe, 0xff]), big]),
    ]
    for (const encoded of variants) expect(scheme.parseScheme(encoded).environment.floor.material).toBe("MARBLE POLISHED")
  })

  it("rejects generated sky values and unknown nested properties", () => {
    const document = scheme.parseScheme(bytes(native))
    document.environment.sky.presetId = 99
    expect(() => scheme.validateScheme(document)).toThrow(/presetId/)
    document.environment.sky.presetId = 1
    document.environment.sky.color.r = 256
    expect(() => scheme.validateScheme(document)).toThrow(/color.r/)
    document.environment.sky.color.r = 20
    expect(() => scheme.validateScheme({ ...document, environment: { ...document.environment, wall: { ...document.environment.wall, textureFile: "x.png" } } })).toThrow(/textureFile/)
  })

  it("imports named community themes and reports the corpus's empty-name file", async () => {
    const root = fileURLToPath(new URL("../../../KVK Settings 2025/Themes/", import.meta.url))
    const files = (await readdir(root)).filter((name) => name.endsWith(".json"))
    for (const file of files) {
      const original = await readFile(root + file)
      if (file === ".json") {
        expect(() => scheme.parseScheme(original)).toThrow(/name/)
        continue
      }
      const document = scheme.parseScheme(original)
      expect(scheme.parseScheme(scheme.serializeScheme(document)).environment).toEqual(document.environment)
      expect(await readFile(root + file)).toEqual(original)
    }
  })
})

describe("offline preview", () => {
  it.each(["\ufffe", "\uffff", "\ud800", "\udfff"])("rejects XML-invalid text %j", (character) => {
    const document = scheme.parseScheme(bytes(native))
    document.name = `Scene ${character}`
    expect(() => scheme.renderSchemePreview(document)).toThrow(/name/)
    document.name = "Valid scene"
    document.environment.wall.material = `Material ${character}`
    expect(() => scheme.renderSchemePreview(document)).toThrow(/material/)
  })

  it("preserves valid astral Unicode text in previews", () => {
    const document = scheme.parseScheme(bytes(native))
    document.name = "玩家场景 🌤️"
    expect(scheme.renderSchemePreview(document)).toContain("玩家场景 🌤️")
  })

  it("escapes untrusted text and labels the limitations without fetching assets", () => {
    const document = scheme.parseScheme(bytes({ ...native, themeName: '<script>alert("x")</script>', wallMaterial: '<image href="https://bad.invalid/" />' }))
    const svg = scheme.renderSchemePreview(document)
    expect(svg).not.toContain("<script>")
    expect(svg).not.toContain('<image href="')
    expect(svg).toContain("&lt;script&gt;")
    expect(svg).toContain("近似预览")
    expect(svg).toContain("MARBLE POLISHED")
  })
})
