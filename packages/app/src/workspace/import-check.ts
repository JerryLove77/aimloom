import type { FileAddKind } from '../installer/contracts'
import { t, type Msg } from '../i18n'

/** An installed theme (name = its internal themeName) or sound (name = its stem). */
export interface InstalledEntry { name: string | null; file: string }
export interface ImportIssue { field: 'name' | 'content'; message: Msg }

const EXTENSIONS: Record<FileAddKind, string[]> = { theme: ['.json'], sound: ['.wav', '.ogg'] }
const FOLDER: Record<FileAddKind, string> = { theme: 'Themes', sound: 'sounds' }
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN = /[\\/:*?"<>|\x00-\x1f]/
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export const importFileName = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path
export const extensionOf = (file: string) => { const dot = file.lastIndexOf('.'); return dot > 0 ? file.slice(dot) : '' }
export const stemOf = (file: string) => { const dot = file.lastIndexOf('.'); return dot > 0 ? file.slice(0, dot) : file }

/** Decodes the way the engine does: a BOM picks UTF-8 or either UTF-16 order, otherwise UTF-8. */
function decode(bytes: Uint8Array): string {
  const bom = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (bom(0xef, 0xbb, 0xbf)) return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))
  if (bom(0xff, 0xfe)) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
  if (bom(0xfe, 0xff)) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

type ThemeContentKey = 'import.check.notValidJson' | 'import.check.notJsonObject' | 'import.check.noThemeName'

/**
 * Thrown by `themeNameOf`. `Error.message` stays the Chinese text (so any caller that only reads
 * that, as `Error` normally requires, still sees it), and `msg` carries the key for the UI.
 */
export class ThemeContentError extends Error {
  readonly msg: Msg
  constructor(key: ThemeContentKey) { super(t('zh', key)); this.name = 'ThemeContentError'; this.msg = { key } }
}

/** The theme's internal name, which is what the game identifies a theme by. Throws in Chinese. */
export function themeNameOf(bytes: Uint8Array): string {
  let value: unknown
  try { value = JSON.parse(decode(bytes)) }
  catch { throw new ThemeContentError('import.check.notValidJson') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ThemeContentError('import.check.notJsonObject')
  const name = (value as { themeName?: unknown }).themeName
  if (typeof name !== 'string' || !name.trim()) throw new ThemeContentError('import.check.noThemeName')
  return name
}

/**
 * Why this import would be refused, or null. These mirror the engine's rules so the player sees
 * the reason before anything is sent; the engine remains the authority and checks them again.
 */
export function importIssue(kind: FileAddKind, file: string, installed: InstalledEntry[], themeName?: string): ImportIssue | null {
  const name = (message: Msg): ImportIssue => ({ field: 'name', message })
  const value = file.trim()
  const stem = stemOf(value)
  if (!value || !stem.trim() || value.startsWith('.')) return name({ key: 'import.check.enterName' })
  if (FORBIDDEN.test(value)) return name({ key: 'import.check.forbidden' })
  if (!EXTENSIONS[kind].includes(extensionOf(value).toLowerCase()))
    return name({ key: kind === 'theme' ? 'import.check.extensionTheme' : 'import.check.extensionSound' })
  if (value.length > 128) return name({ key: 'import.check.tooLong' })
  if (kind === 'sound' && stem.includes(';')) return name({ key: 'import.check.semicolon' })
  if (/^ /.test(file) || /[. ]$/.test(stem)) return name({ key: 'import.check.spacesOrDots' })
  if (value.includes('..')) return name({ key: 'import.check.doubleDot' })
  if (RESERVED.test(value.split('.')[0] ?? value)) return name({ key: 'import.check.reserved' })
  const taken = installed.find(entry => same(entry.file, value))
  if (taken) return name({ key: 'import.check.taken', params: { folder: FOLDER[kind], file: taken.file } })
  if (kind === 'sound') {
    const twin = installed.find(entry => same(stemOf(entry.file), stem))
    if (twin) return name({ key: 'import.check.soundTwin', params: { file: twin.file } })
  }
  if (kind === 'theme' && themeName) {
    const clash = installed.find(entry => entry.name !== null && same(entry.name, themeName))
    if (clash) return { field: 'content', message: { key: 'import.check.themeClash', params: { themeName, file: clash.file } } }
  }
  return null
}
