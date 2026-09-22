import { canonicalPngIssue, encodePng, isCanonicalPng, MAX_DIMENSION, MAX_PNG_BYTES } from '../../../crosshair/src/png'
import { t, type MessageKey, type Params } from '../i18n'
import { LocalizedError } from '../../../core/src/types'

/** The same refusal in both languages, so an English player reads the real reason. */
const pngError = (key: MessageKey, params?: Params) => new LocalizedError(t('zh', key, params), t('en', key, params))

export interface DecodedRgba { width: number; height: number; data: Uint8Array }
/** Injected so tests need no canvas; the default uses the browser's own image decoder. */
export type RgbaDecoder = (bytes: Uint8Array) => Promise<DecodedRgba>

/**
 * Decode through the browser rather than shipping a PNG parser: `createImageBitmap` accepts
 * every PNG the app can be handed, and the caller only needs the pixels back.
 */
export const browserRgbaDecoder: RgbaDecoder = async bytes => {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    context.clearRect(0, 0, bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(image.data.buffer.slice(0)) }
  } finally { bitmap.close() }
}

/**
 * Return bytes the Windows replacement adapter accepts.
 *
 * A file that already has the required shape is passed through untouched — the game's own
 * crosshairs already are, so the common case costs nothing and the user's bytes survive.
 * Anything else is decoded and re-encoded as canonical RGBA.
 */
export async function toCanonicalPng(bytes: Uint8Array, decode: RgbaDecoder = browserRgbaDecoder): Promise<Uint8Array> {
  if (!bytes.length || bytes.length > MAX_PNG_BYTES) throw pngError('crosshair.png.tooLarge', { mib: MAX_PNG_BYTES / 1024 / 1024 })
  if (isCanonicalPng(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw pngError('crosshair.png.badDimensions', { max: MAX_DIMENSION })
    }
    return bytes
  }
  let decoded: DecodedRgba
  try { decoded = await decode(bytes) } catch { throw pngError('crosshair.png.cantRead') }
  if (decoded.width < 1 || decoded.height < 1 || decoded.width > MAX_DIMENSION || decoded.height > MAX_DIMENSION) {
    throw pngError('crosshair.png.badDimensions', { max: MAX_DIMENSION })
  }
  if (decoded.data.length !== decoded.width * decoded.height * 4) throw pngError('crosshair.png.incompleteData')
  const encoded = encodePng({ width: decoded.width, height: decoded.height, data: decoded.data, warnings: [] })
  const issue = canonicalPngIssue(encoded)
  if (issue) throw new LocalizedError(issue.zh, issue.en)
  return encoded
}

/** Base64 for the wire, matching what the worker decodes. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
