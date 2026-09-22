import { InstallerFailure } from '../installer/contracts'
import { t, type MessageKey, type Params } from '../i18n'
import { AUDIO_EVENTS, MAX_AUDIO_FILES, type AudioEvent } from './audio/model'
import { parseFileReference, type ProfileFileReference } from './file-reference'
export type { ProfileFileReference } from './file-reference'

export type ProfileAudio = Partial<Record<AudioEvent, ProfileFileReference[]>>
export interface TrainingProfile {
  schemaVersion: 1
  id: string
  name: string
  scheme: ProfileFileReference | null
  audio: ProfileAudio | null
}

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

/** Validate and return an independent JSON model; absent choices are never inferred. */
export function parseTrainingProfile(value: unknown): TrainingProfile {
  // `crosshair` and `enemy` are still ACCEPTED so a Profile written before each was removed
  // still opens, but both are read and thrown away, and never written again: a crosshair cannot
  // be switched from outside the game, and a Profile no longer manages the enemy (2026-09-21), so
  // recording either promised something the App could not keep. Whatever either old field holds
  // is discarded without being validated -- it can no longer reach anything -- so a file that is
  // otherwise fine never fails to load over a record that no longer means anything.
  const accepted = ['schemaVersion', 'id', 'name', 'scheme', 'audio', 'crosshair', 'enemy']
  const required = ['schemaVersion', 'id', 'name', 'scheme', 'audio']
  const input = object(value, accepted, required, 'profile.model.label.profile')
  if (input.schemaVersion !== 1) invalid('profile.model.unsupportedVersion')
  const result: TrainingProfile = { schemaVersion: 1, id: validateProfileId(input.id), name: text(input.name, 128, 'profile.model.label.name'), scheme: null, audio: null }
  if (input.scheme !== null) result.scheme = parseFileReference(input.scheme, ['.json'])
  if (input.audio !== null) {
    const audio = object(input.audio, [...AUDIO_EVENTS], [], 'profile.model.label.audio')
    result.audio = {}
    for (const key of AUDIO_EVENTS) {
      if (!own(audio, key)) continue
      const files = audio[key]
      if (!Array.isArray(files) || Object.getPrototypeOf(files) !== Array.prototype || files.length > MAX_AUDIO_FILES || Reflect.ownKeys(files).length !== files.length + 1) invalid('profile.model.audioArray', { max: MAX_AUDIO_FILES })
      for (let index = 0; index < files.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(files, String(index))
        if (!descriptor?.enumerable || !('value' in descriptor)) invalid('profile.model.audioPlainOnly')
      }
      result.audio[key] = Array.from(files, item => parseFileReference(item, ['.wav', '.ogg']))
    }
  }
  checkBytes(JSON.stringify(result))
  return result
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

export function createTrainingProfile(id: string, name: string): TrainingProfile {
  return parseTrainingProfile({ schemaVersion: 1, id, name, scheme: null, audio: null })
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
