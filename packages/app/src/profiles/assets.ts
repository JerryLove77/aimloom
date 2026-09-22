import { invoke } from '@tauri-apps/api/core'
import { InstallerFailure, type Issue } from '../installer/contracts'
import { isEnglishText, t, type Lang } from '../i18n'
import { parseFileReference, referenceFromPath, type ProfileFileReference } from './file-reference'

export type AssetKind = 'scheme' | 'audio' | 'crosshair' | 'enemy'
/** Each unreadable file carries both languages: `message` is Chinese, `messageEn` its English twin. */
export interface AssetList { directory: string; files: ProfileFileReference[]; errors: { fileName: string; message: string; messageEn: string }[] }
export interface ProfileAssetBridge {
  /** The native folder dialog's title follows `lang`. */
  chooseDirectory(kind: AssetKind, lang: Lang): Promise<string | null>
  list(kind: AssetKind, directory: string): Promise<AssetList>
  read(kind: AssetKind, path: string): Promise<Uint8Array>
}
const extensions: Record<AssetKind, string[]> = { scheme: ['.json'], enemy: ['.json'], crosshair: ['.png'], audio: ['.wav', '.ogg'] }
const MAX_BYTES = 8 * 1024 * 1024
function invalid(): never { throw new InstallerFailure({ code: 'ENGINE_ERROR', message: t('zh', 'profile.assets.invalidResponse'), messageEn: t('en', 'profile.assets.invalidResponse'), path: null }) }
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid()
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) invalid()
  return value
}
const normalizedPath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
function kindExtensions(kind: AssetKind): string[] {
  if (!Object.hasOwn(extensions, kind)) invalid()
  return extensions[kind]
}
export function assetMime(kind: AssetKind, path: string): string {
  referenceFromPath(path, kindExtensions(kind))
  return kind === 'audio' ? (/\.ogg$/i.test(path) ? 'audio/ogg' : 'audio/wav') : kind === 'crosshair' ? 'image/png' : 'application/json'
}
async function call(command: string, args: Record<string, unknown>): Promise<unknown> {
  try { return await invoke(command, args) } catch (error) {
    let issue = error
    if (typeof issue === 'string') { try { issue = JSON.parse(issue) } catch { /* non-protocol failure */ } }
    if (issue && typeof issue === 'object' && 'code' in issue && 'message' in issue
      && ['INVALID_PATH', 'ENGINE_ERROR', 'WORKER_UNAVAILABLE', 'BUSY', 'UNSUPPORTED_PLATFORM'].includes(String(issue.code))
      && typeof issue.message === 'string' && issue.message.trim() && issue.message.length <= 4096) {
      // Rust does not send English yet; never let its Chinese stand in for the English text.
      const messageEn = 'messageEn' in issue && typeof issue.messageEn === 'string' && isEnglishText(issue.messageEn) ? issue.messageEn : t('en', 'profile.assets.readFailed')
      throw new InstallerFailure({ code: issue.code as Issue['code'], message: issue.message, messageEn, path: null })
    }
    throw new InstallerFailure({ code: 'ENGINE_ERROR', message: t('zh', 'profile.assets.readFailed'), messageEn: t('en', 'profile.assets.readFailed'), path: null })
  }
}
export function createNativeAssetBridge(): ProfileAssetBridge {
  return {
    async chooseDirectory(kind, lang) {
      kindExtensions(kind)
      const result = await call('installer_pick_folder', { kind: 'profile-assets', lang })
      return result === null ? null : text(result)
    },
    async list(kind, directory) {
      const allowed = kindExtensions(kind)
      text(directory)
      const result = fields(await call('installer_profile', { op: 'profileAssetList', args: { kind, directory } }), ['directory', 'files', 'errors'])
      if (normalizedPath(text(result.directory)) !== normalizedPath(directory) || !Array.isArray(result.files) || !Array.isArray(result.errors) || result.files.length + result.errors.length > 1000) invalid()
      return { directory: text(result.directory), files: result.files.map(value => parseFileReference(value, allowed)), errors: result.errors.map(value => {
        const error = fields(value, ['fileName', 'message', 'messageEn'])
        return { fileName: text(error.fileName), message: text(error.message), messageEn: text(error.messageEn) }
      }) }
    },
    async read(kind, path) {
      const mimeType = assetMime(kind, path)
      const result = fields(await call('installer_profile', { op: 'profileAssetRead', args: { kind, path } }), ['path', 'mimeType', 'base64'])
      if (normalizedPath(text(result.path)) !== normalizedPath(path) || result.mimeType !== mimeType || typeof result.base64 !== 'string' || !result.base64.length || result.base64.length > 4 * Math.ceil(MAX_BYTES / 3) || result.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64)) invalid()
      let binary: string
      try { binary = atob(result.base64) } catch { return invalid() }
      if (!binary.length || binary.length > MAX_BYTES || btoa(binary) !== result.base64) invalid()
      return Uint8Array.from(binary, value => value.charCodeAt(0))
    },
  }
}
