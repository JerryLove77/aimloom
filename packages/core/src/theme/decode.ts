import type { Encoding } from "../types.js"

export function detectEncoding(bytes: Uint8Array): Encoding {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8-bom"
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le"
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"

  // 无 BOM：JSON 首字符必为 ASCII（'{' 或空白），UTF-16 会在其相邻位置产生 0x00
  if (bytes.length >= 2 && bytes[0] !== 0x00 && bytes[1] === 0x00) return "utf-16le"
  if (bytes.length >= 2 && bytes[0] === 0x00 && bytes[1] !== 0x00) return "utf-16be"

  return "utf-8"
}

/** Node 未必带 utf-16be 解码器，手工字节交换后按 utf-16le 解码 */
function decodeUtf16be(bytes: Uint8Array): string {
  const swapped = new Uint8Array(bytes.length)
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1]!
    swapped[i + 1] = bytes[i]!
  }
  return new TextDecoder("utf-16le").decode(swapped)
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: Encoding } {
  const encoding = detectEncoding(bytes)
  let text: string
  if (encoding === "utf-16be") {
    text = decodeUtf16be(bytes)
  } else if (encoding === "utf-16le") {
    text = new TextDecoder("utf-16le").decode(bytes)
  } else {
    text = new TextDecoder("utf-8").decode(bytes)
  }
  // TextDecoder 通常已剥离 BOM，但字节交换路径与部分运行时不保证，兜底再剥一次
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return { text, encoding }
}
