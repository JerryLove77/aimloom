import { t } from '../../i18n'
import { parseFileReference, referenceFromPath, type ProfileFileReference } from '../file-reference'
/** Editor event IDs, not a claim about native game bindings or override semantics. */
export const AUDIO_EVENTS = ['kill', 'spawn', 'mbsGood', 'mbsOkay', 'mbsBad', 'mbsChangeNow'] as const
export const MAX_AUDIO_FILES = 64
export type AudioEvent = typeof AUDIO_EVENTS[number]
/** null keeps all; absent events keep current; [] explicitly selects no files. */
export type AudioSelection = Partial<Record<AudioEvent, readonly string[]>> | null
export type SelectedAudio = Exclude<AudioSelection, null>

export function validateAudioFile(file: unknown): asserts file is string {
  if (typeof file !== 'string' || file.length > 4096 || /^[\\/]{2}[?.][\\/]/.test(file) || !/\.(ogg|wav)$/i.test(file) || /[\u0000-\u001f\u007f]/.test(file)
    || (/^[a-z][a-z\d+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file))) {
    throw new Error(t('zh', 'audio.error.invalidFile'))
  }
}

function validateEvent(event: string): asserts event is AudioEvent {
  if (!(AUDIO_EVENTS as readonly string[]).includes(event)) throw new Error(t('zh', 'audio.error.unsupportedEvent'))
}

/** Validate imported JSON and detach its lists from caller-owned mutable data. */
export function parseAudioSelection(value: unknown): AudioSelection {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value) || value === undefined) {
    throw new Error(t('zh', 'audio.error.invalidSelection'))
  }
  const result: SelectedAudio = {}
  for (const [event, files] of Object.entries(value)) {
    validateEvent(event)
    if (!Array.isArray(files) || files.length > MAX_AUDIO_FILES) throw new Error(t('zh', 'audio.error.tooManyFiles'))
    for (const file of files) validateAudioFile(file)
    result[event] = [...files]
  }
  return result
}

export function replaceEventSounds(audio: AudioSelection, event: AudioEvent, files: readonly string[]): SelectedAudio {
  validateEvent(event)
  return parseAudioSelection({ ...parseAudioSelection(audio), [event]: files })!
}

function eventFiles(audio: AudioSelection, event: AudioEvent, index: number): string[] {
  validateEvent(event)
  const files = [...(parseAudioSelection(audio)?.[event] ?? [])]
  if (!Number.isInteger(index) || index < 0 || index >= files.length) throw new Error(t('zh', 'audio.error.invalidIndex'))
  return files
}

export function replaceAudioFile(audio: AudioSelection, event: AudioEvent, index: number, file: string): SelectedAudio {
  const files = eventFiles(audio, event, index)
  validateAudioFile(file)
  files[index] = file
  return replaceEventSounds(audio, event, files)
}

export function removeAudioFile(audio: AudioSelection, event: AudioEvent, index: number): SelectedAudio {
  const files = eventFiles(audio, event, index)
  files.splice(index, 1)
  return replaceEventSounds(audio, event, files)
}

export function moveAudioFile(audio: AudioSelection, event: AudioEvent, from: number, to: number): SelectedAudio {
  const files = eventFiles(audio, event, from)
  eventFiles(audio, event, to)
  const [file] = files.splice(from, 1)
  files.splice(to, 0, file!)
  return replaceEventSounds(audio, event, files)
}

export function keepAudioEvent(audio: AudioSelection, event: AudioEvent): AudioSelection {
  validateEvent(event)
  const result = parseAudioSelection(audio)
  if (result) delete result[event]
  return result
}

export type ProfileAudioSelection = Partial<Record<AudioEvent, ProfileFileReference[]>> | null

/** Persist filenames and paths only; editor/preview still works with ordinary paths. */
export function replaceProfileAudio<T extends { audio: unknown }>(profile: T, audio: AudioSelection): Omit<T, 'audio'> & { audio: ProfileAudioSelection } {
  const selection = parseAudioSelection(audio)
  const references: ProfileAudioSelection = selection === null ? null : {}
  if (selection && references) for (const event of AUDIO_EVENTS) {
    if (Object.hasOwn(selection, event)) references[event] = selection[event]!.map(path => referenceFromPath(path, ['.wav', '.ogg']))
  }
  return { ...profile, audio: references }
}

/** Resolve stored file information back into the editor's path lists without reading files. */
export function profileAudioPaths(audio: ProfileAudioSelection): AudioSelection {
  if (audio === null) return null
  const selection: SelectedAudio = {}
  for (const [event, files] of Object.entries(audio)) {
    validateEvent(event)
    if (!Array.isArray(files) || files.length > MAX_AUDIO_FILES) throw new Error(t('zh', 'audio.error.invalidFileList'))
    selection[event] = files.map(file => parseFileReference(file, ['.wav', '.ogg']).path)
  }
  return parseAudioSelection(selection)
}
