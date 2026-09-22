import type { RasterImage } from './render-types'

/**
 * Browser-safe PNG encoding. The Node entry's encoder uses `pngjs`, `node:zlib` and
 * `Buffer`, none of which exist in the shipping installer, so this is a second
 * implementation with no Node or DOM dependency.
 *
 * Output shape is fixed deliberately: 8-bit RGBA, colour type 6, no interlace, one IDAT.
 * That is what `scripts/installer/kvk-crosshair.ps1` accepts and what the game reads.
 */
export const MAX_PNG_BYTES = 2 * 1024 * 1024
export const MAX_DIMENSION = 512

export interface RgbaImage extends RasterImage {}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + payload.length)
  for (let index = 0; index < 4; index++) body[index] = type.charCodeAt(index)
  body.set(payload, 4)
  const out = new Uint8Array(body.length + 8)
  const view = new DataView(out.buffer)
  view.setUint32(0, payload.length)
  out.set(body, 4)
  view.setUint32(out.length - 4, crc32(body))
  return out
}

/**
 * zlib stream using stored (uncompressed) deflate blocks.
 *
 * Chosen over `CompressionStream('deflate')` so the encoder needs nothing from the host
 * (whose WebView2 support would otherwise have to be verified), and so identical pixels
 * always produce identical bytes. The cost is size: 512x512 RGBA is ~1.05 MiB against the
 * 2 MiB ceiling the replacement adapter enforces.
 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4)
  let offset = 0
  out[offset++] = 0x78
  out[offset++] = 0x01
  for (let block = 0; block < blocks; block++) {
    const start = block * 65535
    const size = Math.min(65535, raw.length - start)
    out[offset++] = block === blocks - 1 ? 1 : 0
    out[offset++] = size & 0xff
    out[offset++] = (size >>> 8) & 0xff
    out[offset++] = ~size & 0xff
    out[offset++] = (~size >>> 8) & 0xff
    out.set(raw.subarray(start, start + size), offset)
    offset += size
  }
  new DataView(out.buffer).setUint32(offset, adler32(raw))
  return out.subarray(0, offset + 4)
}

/** Bilingual: the zh side is what the CLI and the engine-facing messages have always shown. */
export interface CanonicalPngIssue { zh: string; en: string }

/** Describe why bytes are not a canonical RGBA PNG, or null when they are. */
export function canonicalPngIssue(bytes: Uint8Array): CanonicalPngIssue | null {
  if (bytes.length < 33) return { zh: 'PNG 数据不完整或签名不正确。', en: 'The PNG data is incomplete or its signature is wrong.' }
  for (let index = 0; index < SIGNATURE.length; index++) {
    if (bytes[index] !== SIGNATURE[index]) return { zh: 'PNG 签名不正确。', en: "The PNG signature is wrong." }
  }
  const type = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
  if (type !== 'IHDR') return { zh: 'PNG 缺少 IHDR。', en: 'The PNG is missing IHDR.' }
  if (bytes[24] !== 8) return { zh: '准星 PNG 必须是 8 位位深。', en: 'A crosshair PNG must be 8-bit depth.' }
  if (bytes[25] !== 6) return { zh: '准星 PNG 必须是 RGBA 颜色类型。', en: 'A crosshair PNG must be the RGBA color type.' }
  if (bytes[26] !== 0) return { zh: '准星 PNG 必须使用 deflate 压缩。', en: 'A crosshair PNG must use deflate compression.' }
  const interlace = bytes[28]!
  if (interlace !== 0) return { zh: '准星 PNG 不能是隔行扫描。', en: 'A crosshair PNG cannot be interlaced.' }
  return null
}

export function isCanonicalPng(bytes: Uint8Array): boolean {
  return canonicalPngIssue(bytes) === null
}

/** Encode RGBA pixels as the canonical PNG. Rejects anything that cannot describe one. */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image
  for (const [value, label] of [[width, '宽度'], [height, '高度']] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
      throw new Error(`准星图像${label}必须是 1 到 ${MAX_DIMENSION} 之间的整数。`)
    }
  }
  if (!(data instanceof Uint8Array) || data.length !== width * height * 4) {
    throw new Error('准星图像的 RGBA 数据长度与尺寸不一致。')
  }
  // Each scanline gains one filter byte; filter 0 keeps the stream a plain copy.
  const stride = width * 4
  const filtered = new Uint8Array(height * (stride + 1))
  for (let row = 0; row < height; row++) {
    filtered[row * (stride + 1)] = 0
    filtered.set(data.subarray(row * stride, row * stride + stride), row * (stride + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', zlibStored(filtered)), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  if (total > MAX_PNG_BYTES) throw new Error(`准星 PNG 超过 ${MAX_PNG_BYTES} 字节上限。`)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

/** SHA-256 as lowercase hex, matching the Node side's hashing of the same bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
