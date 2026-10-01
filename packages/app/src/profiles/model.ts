import { AUDIO_EVENTS, InstallerFailure, type AudioEvent } from '../bridge/contracts'
import { t, type MessageKey, type Params } from '../i18n'
import { parseFileReference, type ProfileFileReference } from './file-reference'
export type { ProfileFileReference } from './file-reference'

export const MAX_AUDIO_FILES = 64

export type ProfileAudio = Partial<Record<AudioEvent, ProfileFileReference[]>>
/**
 * Profile v2 (2026-09-30): a complete snapshot of the theme and all six sound events. A saved
 * Profile always has a theme and every event (kill and spawn may be empty: no sound; each MBS
 * event holds one). The same type carries an unfinished draft, where `theme` may still be null
 * and an event not yet chosen is absent; `parseTrainingProfile` refuses such a draft, so it can
 * never be saved or applied.
 */
export interface TrainingProfile {
  schemaVersion: 2
  id: string
  name: string
  theme: ProfileFileReference | null
  audio: ProfileAudio
}
/** The events that hold exactly one sound. */
export const SINGLE_SOUND_EVENTS: readonly AudioEvent[] = ['mbsGood', 'mbsOkay', 'mbsBad', 'mbsChangeNow']

const MAX_BYTES = 256 * 1024
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

/** Both language halves of a fixed noun used inside a validation message, e.g. "Name" / "名称". */
type Label = MessageKey

function invalid(key: MessageKey, params: Params = {}, label?: Label, path: string | null = null, unsafe = false): never {
  const withLabel = (lang: 'zh' | 'en') => (label ? { ...params, label: t(lang, label) } : params)
  throw new InstallerFailure({
    code: unsafe ? 'INVALID_PATH' : 'ENGINE_ERROR',
    message: t('zh', 'profile.model.invalid', { detail: t('zh', key, withLabel('zh')) }),
    messageEn: t('en', 'profile.model.invalid', { detail: t('en', key, withLabel('en')) }),
    path,
  })
}

function object(value: unknown, allowed: string[], required: string[], label: Label): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('profile.model.mustBeObject', {}, label)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) invalid('profile.model.unknownField', {}, label)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!descriptor.enumerable || !('value' in descriptor)) invalid('profile.model.plainFieldsOnly', {}, label)
  }
  if (required.some(key => !own(value, key))) invalid('profile.model.missingRequired', {}, label)
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, label: Label): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) invalid('profile.model.textTooLong', { max }, label)
  return value
}

export function validateProfileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) invalid('profile.model.invalidId', {}, undefined, typeof value === 'string' ? value : null, true)
  return value
}

function fileReference(value: unknown): string {
  const file = text(value, 4096, 'profile.model.label.filePath')
  const normalized = file.replace(/\\/g, '/')
  if (/^\/\/[?.]\//.test(normalized) || (/^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file))) invalid('profile.model.pathUnsupported', {}, undefined, file, true)
  return file
}

function checkBytes(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_BYTES) invalid('profile.model.jsonTooLarge')
}

function parseAudio(value: unknown, complete: boolean): ProfileAudio {
  const audio = object(value, [...AUDIO_EVENTS], complete ? [...AUDIO_EVENTS] : [], 'profile.model.label.audio')
  const result: ProfileAudio = {}
  for (const key of AUDIO_EVENTS) {
    if (!own(audio, key)) continue
    const files = audio[key]
    if (!Array.isArray(files) || Object.getPrototypeOf(files) !== Array.prototype || files.length > MAX_AUDIO_FILES || Reflect.ownKeys(files).length !== files.length + 1) invalid('profile.model.audioArray', { max: MAX_AUDIO_FILES })
    for (let index = 0; index < files.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(files, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) invalid('profile.model.audioPlainOnly')
    }
    if (SINGLE_SOUND_EVENTS.includes(key) && files.length !== 1) invalid('profile.model.singleSound')
    result[key] = Array.from(files, item => parseFileReference(item, ['.wav', '.ogg']))
  }
  return result
}

function parse(value: unknown, complete: boolean): TrainingProfile {
  // Version 1 (with "keep current" gaps and the old crosshair/enemy records) is refused: the
  // user chose no data migration (2026-09-30). The same rule is in `installer/profiles.rs`
  // and the engine (`engine/profiles.rs`).
  const keys = ['schemaVersion', 'id', 'name', 'theme', 'audio']
  const input = object(value, keys, keys, 'profile.model.label.profile')
  if (input.schemaVersion !== 2) invalid('profile.model.unsupportedVersion')
  const id = validateProfileId(input.id)
  const name = text(input.name, 128, 'profile.model.label.name')
  if (complete && input.theme === null) invalid('profile.model.incomplete')
  const theme = input.theme === null ? null : parseFileReference(input.theme, ['.json'])
  const audio = parseAudio(input.audio, complete)
  const result: TrainingProfile = { schemaVersion: 2, id, name, theme, audio }
  checkBytes(JSON.stringify(result))
  return result
}

/** A saved Profile: complete, or refused. Returns an independent model in the one key order. */
export function parseTrainingProfile(value: unknown): TrainingProfile {
  return parse(value, true)
}

/** A draft in the editor: every rule of a saved Profile except completeness. */
export function parseProfileDraft(value: unknown): TrainingProfile {
  return parse(value, false)
}

/** Whether a draft has everything a saved Profile needs. */
export function isComplete(profile: TrainingProfile): boolean {
  return profile.theme !== null && AUDIO_EVENTS.every(event => profile.audio[event] !== undefined)
}

export function deserializeTrainingProfile(value: string): TrainingProfile {
  if (typeof value !== 'string') invalid('profile.model.jsonMustBeText')
  checkBytes(value)
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { invalid('profile.model.jsonCorrupted') }
  return parseTrainingProfile(parsed)
}

export function serializeTrainingProfile(profile: TrainingProfile): string {
  return JSON.stringify(parseTrainingProfile(profile))
}

/** A new draft, filled from what the game has now where that is known (`snapshotFromGame`). */
export function createProfileDraft(id: string, name: string, start: { theme: ProfileFileReference | null; audio: ProfileAudio } = { theme: null, audio: {} }): TrainingProfile {
  return parseProfileDraft({ schemaVersion: 2, id, name, theme: start.theme, audio: start.audio })
}

export function renameTrainingProfile(profile: TrainingProfile, name: string): TrainingProfile {
  return parseTrainingProfile({ ...parseTrainingProfile(profile), name })
}

export function duplicateTrainingProfile(profile: TrainingProfile, newId: string, newName: string): TrainingProfile {
  return parseTrainingProfile({ ...parseTrainingProfile(profile), id: newId, name: newName })
}

/** Resolve lexically against the JSON's directory, without accessing referenced files. */
export function resolveProfileAssetPath(profileJsonPath: string, assetPath: string): string {
  const base = fileReference(profileJsonPath).replace(/\\/g, '/')
  const asset = fileReference(assetPath).replace(/\\/g, '/')
  const windows = /^[a-z]:\//i.test(asset) || asset.startsWith('//') || /^[a-z]:\//i.test(base) || base.startsWith('//') || profileJsonPath.includes('\\')
  let combined: string
  if (/^[a-z]:\//i.test(asset) || asset.startsWith('//')) combined = asset
  else if (asset.startsWith('/')) combined = (/^[a-z]:\//i.test(base) ? base.slice(0, 2) : '') + asset
  else combined = base.slice(0, base.lastIndexOf('/') + 1) + asset
  let root = ''
  if (combined.startsWith('//')) {
    const match = /^\/\/[^/]+\/[^/]+(?:\/|$)/.exec(combined)
    if (!match) invalid('profile.model.uncSharePath', {}, undefined, combined, true)
    root = match[0].replace(/\/$/, '') + '/'
    combined = combined.slice(match[0].length)
  } else {
    const match = /^(?:[a-z]:\/|\/)/i.exec(combined)
    if (match) { root = match[0]; combined = combined.slice(root.length) }
  }
  const parts: string[] = []
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!root) parts.push(part)
    } else parts.push(part)
  }
  const resolved = root + parts.join('/') || '.'
  return windows ? resolved.replace(/\//g, '\\') : resolved
}
