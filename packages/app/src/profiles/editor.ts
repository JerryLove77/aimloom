import type { ProfileBridge } from './bridge'
import { t, type Msg } from '../i18n'
import { errorMsg } from '../workspace/issue-text'
import { createTrainingProfile, parseTrainingProfile, type TrainingProfile } from './model'

export type ProfileComponent = 'scheme' | 'audio'
export interface ProfileEditorState {
  library: TrainingProfile[]
  directory: string | null
  listErrors: { fileName: string; message: Msg }[]
  draft: TrainingProfile | null
  filePath: string | null
  /** The saved JSON the draft started from, or null when it was never saved. */
  baseline: string | null
  /** Whether the draft differs from that baseline. A never-saved draft is always dirty. */
  dirty: boolean
  loading: boolean
  reading: boolean
  saving: boolean
  busyId: string | null
  error: Msg | null
  nameError: Msg | null
}

const GENERIC: Msg = { key: 'profile.editor.error.generic' }
function message(error: unknown): Msg {
  return errorMsg(error, GENERIC)
}
function nameError(name: string): Msg | null {
  return !name.trim() || name.length > 128 || /[\0\r\n]/.test(name) ? { key: 'profile.editor.nameError' } : null
}
function localizedError(key: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]): Error & { messageEn: string } {
  const err = new Error(t('zh', key, params)) as Error & { messageEn: string }
  err.messageEn = t('en', key, params)
  return err
}

/** Owns only the Profile library and draft. Component/candidate staging belongs to the UI. */
export function createProfileEditor(bridge: ProfileBridge) {
  let state: ProfileEditorState = {
    library: [], directory: null, listErrors: [], draft: null, filePath: null, baseline: null, dirty: false,
    loading: false, reading: false, saving: false, busyId: null, error: null, nameError: null,
  }
  const listeners = new Set<() => void>()
  let session = 0
  let listVersion = 0
  const publish = (patch: Partial<ProfileEditorState>) => {
    const next = { ...state, ...patch }
    // Derived, never passed in: every state change re-answers "does this differ from the file?".
    // Key order is stable — parseTrainingProfile always builds keys in one order, and the
    // setters spread the existing draft rather than rebuilding it.
    next.dirty = next.draft !== null && (next.baseline === null || JSON.stringify(next.draft) !== next.baseline)
    state = next
    listeners.forEach(listener => listener())
  }
  const newId = () => {
    let id: string
    do { id = crypto.randomUUID() } while (state.library.some(profile => profile.id === id) || state.draft?.id === id)
    return id
  }
  const invalidateList = () => { listVersion++; return { loading: false } }
  const upsert = (profile: TrainingProfile) => [...state.library.filter(item => item.id !== profile.id), profile]
  async function open(id: string, copyName: ((name: string) => string) | null): Promise<boolean> {
    const duplicate = copyName !== null
    const version = ++session
    publish({ reading: true, draft: null, filePath: null, baseline: null, nameError: null, error: null })
    try {
      const result = await bridge.read(id)
      if (version !== session) return false
      if (!result.profile) throw localizedError('profile.editor.error.notFound')
      const profile = parseTrainingProfile(result.profile)
      if (profile.id !== id) throw localizedError('profile.editor.error.idMismatch')
      const draft = duplicate ? { ...profile, id: newId(), name: copyName(profile.name.slice(0, 123)) } : profile
      publish({ draft, filePath: result.filePath, baseline: duplicate ? null : JSON.stringify(profile), reading: false })
      return true
    } catch (error) {
      if (version === session) publish({ reading: false, error: message(error) })
      return false
    }
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async load(): Promise<void> {
      const version = ++listVersion
      publish({ loading: true, error: null })
      try {
        const result = await bridge.list()
        if (version !== listVersion) return
        const seen = new Set<string>()
        const errors: ProfileEditorState['listErrors'] = result.errors.map(item => ({
          fileName: item.fileName, message: errorMsg({ message: item.message, messageEn: item.messageEn }, { key: 'profile.editor.listErrorFallback' }),
        }))
        const library = result.profiles.map(parseTrainingProfile).filter(profile => {
          if (seen.has(profile.id)) { errors.push({ fileName: `${profile.id}.json`, message: { key: 'profile.editor.duplicateId' } }); return false }
          seen.add(profile.id)
          return true
        })
        publish({ library, directory: result.directory, listErrors: errors, loading: false })
      } catch (error) {
        if (version === listVersion) publish({ loading: false, error: message(error) })
      }
    },
    create(name = t('zh', 'profile.editor.defaultName')) {
      session++
      const fallback = t('zh', 'profile.editor.defaultName')
      const draft = createTrainingProfile(newId(), nameError(name) ? fallback : name)
      publish({ draft: { ...draft, name }, filePath: null, baseline: null, reading: false, nameError: nameError(name), error: null })
    },
    edit: (id: string) => open(id, null),
    duplicate: (id: string, copyName = (name: string) => t('zh', 'profile.editor.copyName', { name })) => open(id, copyName),
    setName(name: string) {
      if (!state.draft || state.saving) return
      publish({ draft: { ...state.draft, name }, nameError: nameError(name), error: null })
    },
    setComponent<K extends ProfileComponent>(key: K, value: TrainingProfile[K]): boolean {
      if (!state.draft || state.saving) return false
      try {
        // Validate component data independently of a temporarily blank name field.
        const parsed = parseTrainingProfile({ ...state.draft, name: 'x', [key]: value })
        publish({ draft: { ...state.draft, [key]: parsed[key] }, error: null })
        return true
      } catch (error) { publish({ error: message(error) }); return false }
    },
    cancel() {
      session++
      publish({ draft: null, filePath: null, baseline: null, reading: false, error: null, nameError: null })
    },
    async save(): Promise<boolean> {
      if (!state.draft || state.saving || state.busyId) return false
      const invalidName = nameError(state.draft.name)
      if (invalidName) { publish({ nameError: invalidName }); return false }
      const version = session
      let profile: TrainingProfile
      try { profile = parseTrainingProfile(state.draft) }
      catch (error) { publish({ error: message(error) }); return false }
      publish({ saving: true, error: null, nameError: null })
      try {
        const result = await bridge.save(profile)
        const saved = parseTrainingProfile(result.profile)
        if (saved.id !== profile.id) throw localizedError('profile.editor.savedIdMismatch')
        publish({ ...invalidateList(), library: upsert(saved), saving: false,
          ...(version === session ? { draft: null, filePath: null, baseline: null } : {}) })
        return true
      } catch (error) {
        publish({ saving: false, ...(version === session ? { error: message(error) } : {}) })
        return false
      }
    },
    async deleteProfile(id: string): Promise<boolean> {
      if (state.busyId || state.saving) return false
      publish({ busyId: id, error: null })
      try {
        const result = await bridge.delete(id)
        if (!result.deleted) throw localizedError('profile.editor.deleteFailed')
        publish({ ...invalidateList(), library: state.library.filter(profile => profile.id !== id), busyId: null })
        return true
      } catch (error) { publish({ busyId: null, error: message(error) }); return false }
    },
  }
}

export type ProfileEditor = ReturnType<typeof createProfileEditor>
