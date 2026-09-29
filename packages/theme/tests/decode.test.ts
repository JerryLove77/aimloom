import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { detectEncoding, decodeText } from "../src/theme/decode.js"
import { makeFixture } from "./helpers/fixture.js"

const bytes = (...b: number[]) => new Uint8Array(b)

describe("detectEncoding", () => {
  it("识别 UTF-8 BOM", () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x7b))).toBe("utf-8-bom")
  })
  it("识别 UTF-16LE BOM", () => {
    expect(detectEncoding(bytes(0xff, 0xfe, 0x7b, 0x00))).toBe("utf-16le")
  })
  it("识别 UTF-16BE BOM", () => {
    expect(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x7b))).toBe("utf-16be")
  })
  it("无 BOM 时按空字节位置判定 UTF-16LE", () => {
    expect(detectEncoding(bytes(0x7b, 0x00, 0x22, 0x00))).toBe("utf-16le")
  })
  it("无 BOM 时按空字节位置判定 UTF-16BE", () => {
    expect(detectEncoding(bytes(0x00, 0x7b, 0x00, 0x22))).toBe("utf-16be")
  })
  it("纯 ASCII 判为 UTF-8", () => {
    expect(detectEncoding(bytes(0x7b, 0x22, 0x61, 0x22))).toBe("utf-8")
  })
})

describe("decodeText", () => {
  it("剥离 UTF-8 BOM，使 JSON.parse 可直接消费", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')])
    const { text } = decodeText(withBom)
    expect(text).toBe('{"a":1}')
    expect(JSON.parse(text)).toEqual({ a: 1 })
  })

  it("解码语料中真实的 UTF-16 theme 文件", async () => {
    const fx = await makeFixture()
    try {
      const raw = await readFile(join(fx.themesDir, "Smári-ctrl.json"))
      expect(raw[0]).toBe(0xff) // 确认样本仍是 UTF-16LE
      const { text, encoding } = decodeText(new Uint8Array(raw))
      expect(encoding).toBe("utf-16le")
      const parsed = JSON.parse(text)
      expect(typeof parsed.themeName).toBe("string")
    } finally {
      await fx.cleanup()
    }
  })

  it("UTF-16BE 走手工字节交换路径也能正确解码", () => {
    // 手工构造 UTF-16BE 的 {"a":1}
    const src = '{"a":1}'
    const be = new Uint8Array(2 + src.length * 2)
    be[0] = 0xfe
    be[1] = 0xff
    for (let i = 0; i < src.length; i++) {
      be[2 + i * 2] = 0x00
      be[2 + i * 2 + 1] = src.charCodeAt(i)
    }
    const { text, encoding } = decodeText(be)
    expect(encoding).toBe("utf-16be")
    expect(JSON.parse(text)).toEqual({ a: 1 })
  })
})
