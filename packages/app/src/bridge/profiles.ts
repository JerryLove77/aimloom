import { invoke } from '@tauri-apps/api/core'
import { InstallerFailure, type Issue } from './contracts'
import { isEnglishText, t } from '../i18n'
import { parseTrainingProfile, validateProfileId, type TrainingProfile } from '../profiles/model'

/** Each unreadable file carries both languages: `message` is Chinese, `messageEn` its English twin. */
export interface ProfileList { directory: string; profiles: TrainingProfile[]; errors: { fileName: string; message: string; messageEn: string }[] }
export interface ProfileRead { filePath: string; profile: TrainingProfile | null }
export interface ProfileSave { filePath: string; profile: TrainingProfile }
/**
 * The starred Theme and Sounds files, by file name, kept in the data folder (not WebView
 * storage, which an uninstall may clear). At most `MAX_FAVORITES` of each, no repeats.
 */
export interface Favorites { theme: string[]; audio: string[] }
export const MAX_FAVORITES = 500
export interface ProfileBridge {
  list(): Promise<ProfileList>
  read(id: string): Promise<ProfileRead>
  save(profile: TrainingProfile): Promise<ProfileSave>
  delete(id: string): Promise<{ deleted: boolean }>
  favoritesRead(): Promise<Favorites>
  /** Replaces both lists and answers what was kept. */
  favoritesSave(favorites: Favorites): Promise<Favorites>
}

function malformed(): never {
  throw new InstallerFailure({ code: 'ENGINE_ERROR', message: t('zh', 'profile.bridge.malformed'), messageEn: t('en', 'profile.bridge.malformed'), path: null })
}

function envelope(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) malformed()
  const keys = Reflect.ownKeys(value)
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) malformed()
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) malformed()
  return value
}

function normalize(error: unknown): InstallerFailure {
  if (error instanceof InstallerFailure) return error
  let candidate = error
  if (typeof error === 'string') { try { candidate = JSON.parse(error) } catch { /* Plain native error. */ } }
  if (candidate && typeof candidate === 'object' && 'code' in candidate && 'message' in candidate && typeof candidate.code === 'string' && typeof candidate.message === 'string') return new InstallerFailure(candidate as Issue)
  // A plain native string is often Chinese; the English side then gets the fallback, never a copy of it.
  const messageEn = typeof error === 'string' && isEnglishText(error) ? error : t('en', 'profile.bridge.unavailable')
  return new InstallerFailure({ code: 'WORKER_UNAVAILABLE', message: typeof error === 'string' ? error : t('zh', 'profile.bridge.unavailable'), messageEn, path: null })
}

async function call(op: string, args: Record<string, unknown>): Promise<unknown> {
  try { return await invoke('installer_profile', { op, args }) } catch (error) { throw normalize(error) }
}

function stored(value: unknown, id: string, nullable: boolean): ProfileRead {
  const response = envelope(value, ['filePath', 'profile'])
  const filePath = string(response.filePath)
  if (filePath.split(/[\\/]/).pop() !== `${id}.json`) malformed()
  if (response.profile === null && nullable) return { filePath, profile: null }
  const profile = parseTrainingProfile(response.profile)
  if (profile.id !== id) malformed()
  return { filePath, profile }
}

/** A favourites value as the engine answers it, or a malformed-response failure. */
export function parseFavorites(value: unknown): Favorites {
  const body = envelope(value, ['theme', 'audio'])
  const names = (list: unknown, pattern: RegExp): string[] => {
    if (!Array.isArray(list) || list.length > MAX_FAVORITES) malformed()
    const seen = new Set<string>()
    return list.map(name => {
      const file = string(name)
      if (!pattern.test(file) || /[\\/]/.test(file) || seen.has(file.toLowerCase())) malformed()
      seen.add(file.toLowerCase())
      return file
    })
  }
  return { theme: names(body.theme, /\.json$/i), audio: names(body.audio, /\.(wav|ogg)$/i) }
}

export function createNativeProfileBridge(): ProfileBridge {
  return {
    async list() {
      const response = envelope(await call('profileList', {}), ['directory', 'profiles', 'errors'])
      const directory = string(response.directory)
      if (!Array.isArray(response.profiles) || !Array.isArray(response.errors)) malformed()
      return {
        directory,
        profiles: response.profiles.map(parseTrainingProfile),
        errors: response.errors.map(value => {
          const error = envelope(value, ['fileName', 'message', 'messageEn'])
          return { fileName: string(error.fileName), message: string(error.message), messageEn: string(error.messageEn) }
        }),
      }
    },
    async read(id) {
      validateProfileId(id)
      return stored(await call('profileRead', { id }), id, true)
    },
    async save(input) {
      const profile = parseTrainingProfile(input)
      const response = stored(await call('profileSave', { profile }), profile.id, false)
      return { filePath: response.filePath, profile: response.profile! }
    },
    async delete(id) {
      validateProfileId(id)
      const response = envelope(await call('profileDelete', { id }), ['deleted'])
      if (typeof response.deleted !== 'boolean') malformed()
      return { deleted: response.deleted }
    },
    async favoritesRead() {
      return parseFavorites(envelope(await call('profileFavoritesRead', {}), ['favorites']).favorites)
    },
    async favoritesSave(input) {
      const favorites = parseFavorites(input)
      return parseFavorites(envelope(await call('profileFavoritesSave', { favorites }), ['favorites']).favorites)
    },
  }
}
