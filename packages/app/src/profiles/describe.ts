import type { useT } from '../i18n'
import { AUDIO_EVENTS, type AudioEvent } from './audio/model'
import type { CurrentGame } from './current-game'
import type { ProfileAudio, ProfileFileReference } from './model'

type T = ReturnType<typeof useT>

export function eventLabel(event: AudioEvent, t: T): string {
  switch (event) {
    case 'kill': return t('profile.audioSheet.event.kill')
    case 'spawn': return t('profile.audioSheet.event.spawn')
    case 'mbsGood': return t('audio.tab.mbsGood')
    case 'mbsOkay': return t('audio.tab.mbsOkay')
    case 'mbsBad': return t('audio.tab.mbsBad')
    case 'mbsChangeNow': return t('audio.tab.mbsChangeNow')
  }
}

/** The game stores an unbound single-value event as the literal "None". */
function soundNames(names: readonly string[], t: T): string {
  const real = names.filter(name => name !== '' && name !== 'None')
  return real.length ? real.join(t('profile.nameJoin')) : t('profile.current.noSound')
}

/** "保持当前 · <what the game has now>", or the bare 「保持当前」 when that is not known. */
function kept(name: string | null, t: T): string {
  return name === null ? t('common.tag.keep') : t('profile.keep.named', { name })
}

export function keptTheme(current: CurrentGame | null, t: T): string {
  return kept(current?.theme ?? null, t)
}

export function keptSounds(event: AudioEvent, current: CurrentGame | null, t: T): string {
  const bound = current?.sounds?.[event]
  return kept(bound ? soundNames(bound, t) : null, t)
}

/** Every event the game has a sound for, e.g. "击杀 a、b；MBS · Good c". */
export function keptAllSounds(current: CurrentGame | null, t: T): string {
  const sounds = current?.sounds
  if (!sounds) return t('common.tag.keep')
  const parts = AUDIO_EVENTS
    .map(event => ({ event, names: sounds[event].filter(name => name !== '' && name !== 'None') }))
    .filter(part => part.names.length > 0)
    .map(part => t('profile.eventSounds', { event: eventLabel(part.event, t), names: part.names.join(t('profile.nameJoin')) }))
  return kept(parts.length ? parts.join(t('profile.eventJoin')) : t('profile.current.noSound'), t)
}

/** A recorded file, or what keeping current keeps. */
export function describeFile(kind: 'scheme', value: ProfileFileReference | null, current: CurrentGame | null, t: T): string {
  if (value !== null) return value.name
  return keptTheme(current, t)
}

/** One event of a saved Profile: its recorded files, or the sounds the game keeps. */
export function describeEvent(event: AudioEvent, audio: ProfileAudio | null, current: CurrentGame | null, t: T): string {
  const recorded = audio?.[event] ?? []
  return recorded.length ? recorded.map(file => file.name).join(t('profile.nameJoin')) : keptSounds(event, current, t)
}

/** The whole audio component on one line, for the library row and the editor card. */
export function describeAudio(audio: ProfileAudio | null, current: CurrentGame | null, t: T): string {
  const recorded = AUDIO_EVENTS.filter(event => (audio?.[event]?.length ?? 0) > 0)
  if (recorded.length === 0) return keptAllSounds(current, t)
  const parts = recorded.map(event => t('profile.eventSounds', { event: eventLabel(event, t), names: audio![event]!.map(file => file.name).join(t('profile.nameJoin')) }))
  const rest = AUDIO_EVENTS.length - recorded.length
  return parts.join(t('profile.eventJoin')) + (rest > 0 ? t('profile.audio.restKept', { count: rest }) : '')
}
