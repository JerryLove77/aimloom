import type { useT } from '../i18n'
import { AUDIO_EVENTS, type AudioEvent } from '../bridge/contracts'
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

/** The game has no sound for an event when it holds nothing, or the literal "None" (the
 * silent `none.ogg`) for an MBS event. A recorded `none.ogg` therefore reads as "no sound" too. */
const silent = (file: ProfileFileReference) => /^none\.(ogg|wav)$/i.test(file.name)

/** The recorded theme, or 「未选择」 while a draft still lacks one. */
export function describeTheme(value: ProfileFileReference | null, t: T): string {
  return value ? value.name : t('profile.unchosen')
}

/** One event: its recorded files, 「无音效」, or 「未选择」 while a draft still lacks it. */
export function describeEvent(event: AudioEvent, audio: ProfileAudio, t: T): string {
  const recorded = audio[event]
  if (recorded === undefined) return t('profile.unchosen')
  const real = recorded.filter(file => !silent(file))
  return real.length ? real.map(file => file.name).join(t('profile.nameJoin')) : t('profile.current.noSound')
}

/** All six events on one line: the ones with sounds by name, then how many are silent or unchosen. */
export function describeAudio(audio: ProfileAudio, t: T): string {
  const sounding = AUDIO_EVENTS.filter(event => (audio[event] ?? []).some(file => !silent(file)))
  const unchosen = AUDIO_EVENTS.filter(event => audio[event] === undefined).length
  const quiet = AUDIO_EVENTS.length - sounding.length - unchosen
  const parts = sounding.map(event => t('profile.eventSounds', { event: eventLabel(event, t), names: describeEvent(event, audio, t) }))
  if (quiet > 0) parts.push(parts.length ? t('profile.audio.restSilent', { count: quiet }) : t('profile.audio.allSilent'))
  if (unchosen > 0) parts.push(t('profile.audio.unchosen', { count: unchosen }))
  return parts.join(t('profile.eventJoin'))
}
