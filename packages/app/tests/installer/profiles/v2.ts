import { createProfileDraft, parseTrainingProfile, type ProfileAudio, type ProfileFileReference, type TrainingProfile } from '../../../src/profiles/model'

/** Fixture helpers for Profile v2: a complete snapshot (theme + all six sound events). */
export const ref = (path: string): ProfileFileReference => ({ name: path.split(/[\\/]/).pop()!, path })

export const completeAudio = (over: ProfileAudio = {}): ProfileAudio => ({
  kill: [], spawn: [],
  mbsGood: [ref('D:/Game/sounds/none.ogg')], mbsOkay: [ref('D:/Game/sounds/none.ogg')],
  mbsBad: [ref('D:/Game/sounds/none.ogg')], mbsChangeNow: [ref('D:/Game/sounds/none.ogg')],
  ...over,
})

/** A valid v2 Profile as plain JSON-shaped data. */
export const v2 = (id = 'a', name = 'A', over: Partial<Omit<TrainingProfile, 'schemaVersion'>> = {}): TrainingProfile => ({
  schemaVersion: 2, id, name, theme: ref('D:/Game/themes/main.json'), audio: completeAudio(), ...over,
})

export const v2Parsed = (id = 'a', name = 'A', over: Partial<Omit<TrainingProfile, 'schemaVersion'>> = {}) => parseTrainingProfile(v2(id, name, over))
export const v2Draft = createProfileDraft
