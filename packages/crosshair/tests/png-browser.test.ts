import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../src/node'
import { canonicalPngIssue, encodePng, isCanonicalPng, sha256Hex, type RgbaImage } from '../src/png'

/** A tiny image with a transparent field, an opaque arm and a semi-transparent arm. */
function sample(width = 5, height = 3): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    const alpha = index % 3 === 0 ? 0 : index % 3 === 1 ? 255 : 128
    data[index * 4] = (index * 7) % 256
    data[index * 4 + 1] = (index * 13) % 256
    data[index * 4 + 2] = (index * 29) % 256
    data[index * 4 + 3] = alpha
  }
  return { width, height, data, warnings: [] }
}

describe('browser-safe PNG encoder', () => {
  it('emits a PNG the existing Node decoder reads back pixel for pixel', () => {
    const image = sample()
    const bytes = encodePng(image)
    // The Node decoder is an independent implementation; agreeing with it is the real check.
    const decoded = decodePng(bytes)
    expect(decoded.width).toBe(image.width)
    expect(decoded.height).toBe(image.height)
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data))
  })

  it('emits the canonical shape the Windows replacement adapter demands', () => {
    const bytes = encodePng(sample())
    // kvk-crosshair.ps1 rejects anything but 8-bit RGBA, non-interlaced, with a plain IDAT.
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(canonicalPngIssue(bytes)).toBeNull()
    expect(isCanonicalPng(bytes)).toBe(true)
  })

  it('produces identical bytes for identical pixels', () => {
    // Reproducibility is the reason stored deflate was chosen over CompressionStream.
    expect(Array.from(encodePng(sample()))).toEqual(Array.from(encodePng(sample())))
  })

  it('survives the largest permitted image within the byte ceiling', () => {
    const bytes = encodePng({ width: 512, height: 512, data: new Uint8Array(512 * 512 * 4), warnings: [] })
    expect(canonicalPngIssue(bytes)).toBeNull()
    expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(decodePng(bytes).width).toBe(512)
  })

  it('rejects an image that cannot describe a PNG', () => {
    expect(() => encodePng({ width: 0, height: 4, data: new Uint8Array(0), warnings: [] })).toThrow()
    expect(() => encodePng({ width: 513, height: 1, data: new Uint8Array(513 * 4), warnings: [] })).toThrow()
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(8), warnings: [] })).toThrow()
  })

  it('describes why a PNG is not canonical instead of accepting it', () => {
    const good = encodePng(sample())
    expect(canonicalPngIssue(good)).toBeNull()
    expect(canonicalPngIssue(new Uint8Array([1, 2, 3]))?.zh).toMatch(/签名|损坏/)
    expect(canonicalPngIssue(new Uint8Array([1, 2, 3]))?.en).toMatch(/signature|incomplete/i)
    // Colour type 2 (RGB) and bit depth 16 are the two shapes the adapter refuses.
    const rgb = Uint8Array.from(good); rgb[25] = 2
    expect(canonicalPngIssue(rgb)?.zh).toMatch(/RGBA|颜色类型/)
    expect(canonicalPngIssue(rgb)?.en).toMatch(/RGBA|color type/i)
    const deep = Uint8Array.from(good); deep[24] = 16
    expect(canonicalPngIssue(deep)?.zh).toMatch(/8 位|位深/)
    expect(canonicalPngIssue(deep)?.en).toMatch(/8-bit|depth/i)
    const interlaced = Uint8Array.from(good); interlaced[28] = 1
    expect(canonicalPngIssue(interlaced)?.zh).toMatch(/隔行/)
    expect(canonicalPngIssue(interlaced)?.en).toMatch(/interlaced/i)
  })

  it('hashes bytes exactly as Node does', async () => {
    const bytes = encodePng(sample())
    expect(await sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})
