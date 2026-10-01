import { describe, expect, it } from 'vitest'
import type { ProfileBridge, ProfileList, ProfileRead, ProfileSave } from '../../../src/bridge/profiles'
import { ref, completeAudio, v2Parsed } from './v2'
import { createProfileEditor } from '../../../src/profiles/editor'
import { renderMsg, t } from '../../../src/i18n'

const START = { theme: ref('D:/Game/themes/main.json'), audio: completeAudio() }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function memory() {
  const source = v2Parsed('one', '原版')
  const files = new Map([[source.id, source]])
  const bridge: ProfileBridge = {
    async list() { return { directory: '/profiles', profiles: [...files.values()], errors: [] } },
    async read(id) { return { filePath: `/profiles/${id}.json`, profile: files.get(id) ?? null } },
    async save(profile) { files.set(profile.id, profile); return { filePath: `/profiles/${profile.id}.json`, profile } },
    async delete(id) { return { deleted: files.delete(id) } },
    async favoritesRead() { return { theme: [], audio: [] } },
    async favoritesSave(favorites) { return favorites },
  }
  return { bridge, files, source }
}

describe('Profile editor', () => {
  it('keeps stable snapshots and notifies subscribers, with isolated cancellable drafts', async () => {
    const { bridge, source } = memory()
    const editor = createProfileEditor(bridge)
    let updates = 0
    const unsubscribe = editor.subscribe(() => updates++)
    expect(editor.getState()).toBe(editor.getState())
    await editor.load()
    await editor.edit('one')
    const audio = completeAudio({ kill: [{ name: '一', path: '/audio/one.wav' }] })
    editor.setName('修改')
    expect(editor.setComponent('audio', audio)).toBe(true)
    audio.kill![0]!.name = '外部修改'
    expect(editor.getState().draft?.audio).toEqual(completeAudio({ kill: [{ name: '一', path: '/audio/one.wav' }] }))
    editor.cancel()
    expect(editor.getState().draft).toBeNull()
    expect(source.name).toBe('原版')
    expect(source.audio.kill).toEqual([])
    expect(editor.getState().library[0]!.name).toBe('原版')
    expect(updates).toBeGreaterThan(0)
    unsubscribe()
    const count = updates
    editor.create()
    expect(updates).toBe(count)
  })
  it('validates names, keeps failed drafts and exits only after confirmed persistence', async () => {
    const { bridge, files } = memory()
    const editor = createProfileEditor(bridge)
    editor.create(undefined, START)
    editor.setName(' ')
    expect(await editor.save()).toBe(false)
    expect(editor.getState().nameError).toBeTruthy()
    expect(files.size).toBe(1)
    editor.setName('新配置')
    const write = deferred<ProfileSave>()
    bridge.save = () => write.promise
    const saving = editor.save()
    expect(editor.getState().saving).toBe(true)
    expect(await editor.save()).toBe(false)
    write.reject(new Error('磁盘已满'))
    expect(await saving).toBe(false)
    expect(editor.getState().draft?.name).toBe('新配置')
    expect(renderMsg('zh', editor.getState().error!)).toContain('磁盘已满')
    bridge.save = async profile => ({ filePath: `/profiles/${profile.id}.json`, profile })
    expect(await editor.save()).toBe(true)
    expect(editor.getState().draft).toBeNull()
    expect(editor.getState().library.map(p => p.name)).toContain('新配置')
  })
  it('ignores stale reads and lists without discarding the newer draft', async () => {
    const { bridge } = memory()
    const read = deferred<ProfileRead>()
    const list = deferred<ProfileList>()
    bridge.read = () => read.promise
    bridge.list = () => list.promise
    const editor = createProfileEditor(bridge)
    const reading = editor.edit('one')
    editor.create('新的草稿', START)
    read.resolve({ filePath: '/profiles/one.json', profile: v2Parsed('one', '旧读取') })
    await reading
    expect(editor.getState().draft?.name).toBe('新的草稿')
    const loading = editor.load()
    await editor.save()
    list.resolve({ directory: '/profiles', profiles: [], errors: [] })
    await loading
    expect(editor.getState().library[0]!.name).toBe('新的草稿')
  })
  it('a completed old save never closes a newer draft', async () => {
    const { bridge } = memory()
    const write = deferred<ProfileSave>()
    bridge.save = () => write.promise
    const editor = createProfileEditor(bridge)
    editor.create('旧草稿', START)
    const old = editor.getState().draft!
    const saving = editor.save()
    editor.cancel()
    editor.create('新草稿', START)
    write.resolve({ filePath: `/profiles/${old.id}.json`, profile: old })
    await saving
    expect(editor.getState().draft?.name).toBe('新草稿')
    expect(editor.getState().saving).toBe(false)
  })
  it('names a duplicate with the copy-name function the page passes in its language', async () => {
    const { bridge } = memory()
    const editor = createProfileEditor(bridge)
    await editor.load()
    await editor.duplicate('one', name => t('en', 'profile.editor.copyName', { name }))
    expect(editor.getState().draft?.name).toBe('原版 copy')
    expect(editor.getState().draft?.name).not.toContain('副本')
  })
  it('duplicates into a distinct unsaved draft and deletes only after confirmation', async () => {
    const { bridge, files } = memory()
    const editor = createProfileEditor(bridge)
    await editor.load()
    await editor.duplicate('one')
    const duplicate = editor.getState().draft!
    expect(duplicate.id).not.toBe('one')
    expect(duplicate.name).toContain('副本')
    expect(files.size).toBe(1)
    expect(editor.getState().filePath).toBe('/profiles/one.json')
    expect(await editor.save()).toBe(true)
    expect(files.size).toBe(2)
    const removal = deferred<{ deleted: boolean }>()
    bridge.delete = () => removal.promise
    const deleting = editor.deleteProfile('one')
    expect(editor.getState().library.some(p => p.id === 'one')).toBe(true)
    expect(await editor.deleteProfile('one')).toBe(false)
    removal.resolve({ deleted: true })
    expect(await deleting).toBe(true)
    expect(editor.getState().library.some(p => p.id === 'one')).toBe(false)
  })
  it('retains valid component choices when a new component is invalid or the name is blank', () => {
    const editor = createProfileEditor(memory().bridge)
    editor.create()
    editor.setName('')
    expect(editor.setComponent('audio', { kill: [] })).toBe(true)
    expect(editor.getState().draft?.audio).toEqual({ kill: [] })
    expect(editor.setComponent('theme', { name: '不支持', path: '/wrong.png' })).toBe(false)
    expect(editor.getState().draft?.theme).toBeNull()
    expect(editor.getState().error).toBeTruthy()
    // An MBS event holds exactly one sound, so two are refused and the earlier choice stays.
    expect(editor.setComponent('audio', { kill: [], mbsGood: [ref('a.wav'), ref('b.wav')] })).toBe(false)
    expect(editor.getState().draft?.audio).toEqual({ kill: [] })
  })
  it('uses the newest list request and preserves the library after refresh failure', async () => {
    const { bridge } = memory()
    const first = deferred<ProfileList>()
    bridge.list = () => first.promise
    const editor = createProfileEditor(bridge)
    const pending = editor.load()
    const newest = v2Parsed('new', '最新')
    bridge.list = async () => ({ directory: '/new', profiles: [newest], errors: [] })
    await editor.load()
    first.resolve({ directory: '/old', profiles: [], errors: [] })
    await pending
    expect(editor.getState().library).toEqual([newest])
    expect(editor.getState().directory).toBe('/new')
    bridge.list = async () => { throw new Error('无法读取') }
    await editor.load()
    expect(editor.getState().library).toEqual([newest])
    expect(renderMsg('zh', editor.getState().error!)).toContain('无法读取')
  })
  it('reports duplicate ids in library and missing reads instead of selecting an ambiguous item', async () => {
    const { bridge, source } = memory()
    bridge.list = async () => ({ directory: '/profiles', profiles: [source, source], errors: [] })
    const editor = createProfileEditor(bridge)
    await editor.load()
    expect(editor.getState().library).toHaveLength(1)
    expect(editor.getState().listErrors).toHaveLength(1)
    await editor.edit('missing')
    expect(editor.getState().draft).toBeNull()
    expect(editor.getState().error).toBeTruthy()
  })

  it('is not dirty right after opening a saved profile and becomes dirty on change', async () => {
    const { bridge } = memory()
    const editor = createProfileEditor(bridge)
    await editor.load()
    const id = editor.getState().library[0]!.id
    await editor.edit(id)
    expect(editor.getState().dirty).toBe(false)
    const original = editor.getState().draft!.name
    editor.setName(`${original} \u6539`)
    expect(editor.getState().dirty).toBe(true)
    // Returning to the saved value is not a change, so 保存组合 goes back to disabled.
    editor.setName(original)
    expect(editor.getState().dirty).toBe(false)
  })

  it('treats a new or duplicated profile as dirty', async () => {
    const { bridge } = memory()
    const editor = createProfileEditor(bridge)
    await editor.load()
    editor.create('\u65b0\u7ec4\u5408', START)
    expect(editor.getState().dirty).toBe(true)
    await editor.duplicate(editor.getState().library[0]!.id)
    expect(editor.getState().dirty).toBe(true)
  })

  it('clears dirty after cancel and after a save that keeps the session', async () => {
    const { bridge } = memory()
    const editor = createProfileEditor(bridge)
    await editor.load()
    editor.create('\u65b0\u7ec4\u5408', START)
    editor.cancel()
    expect(editor.getState().dirty).toBe(false)
    editor.create('\u53e6\u4e00\u4e2a', START)
    expect(await editor.save()).toBe(true)
    expect(editor.getState().dirty).toBe(false)
  })

  it('a new Profile starts from what it is given, and leaves unknown parts unchosen', () => {
    const editor = createProfileEditor(memory().bridge)
    editor.create('从游戏', START)
    expect(editor.getState().draft).toMatchObject({ schemaVersion: 2, theme: START.theme, audio: START.audio })
    editor.create('空白')
    expect(editor.getState().draft).toMatchObject({ theme: null, audio: {} })
  })

  it('refuses to save an incomplete draft and says why, writing nothing', async () => {
    const { bridge, files } = memory()
    const editor = createProfileEditor(bridge)
    editor.create('没选完')
    expect(await editor.save()).toBe(false)
    expect(renderMsg('zh', editor.getState().error!)).toContain(t('zh', 'profile.model.incomplete'))
    expect(editor.getState().draft?.name).toBe('没选完')
    expect(files.size).toBe(1)
    // Choosing the theme alone is still incomplete; the six events are needed too.
    editor.setComponent('theme', ref('D:/Game/themes/main.json'))
    expect(await editor.save()).toBe(false)
    editor.setComponent('audio', completeAudio())
    expect(await editor.save()).toBe(true)
    expect(files.size).toBe(2)
  })

  it('refuses to open a saved v1 Profile instead of migrating it', async () => {
    const { bridge } = memory()
    bridge.read = async () => ({ filePath: '/profiles/old.json', profile: { schemaVersion: 1, id: 'old', name: '旧', scheme: null, audio: null } as never })
    const editor = createProfileEditor(bridge)
    await editor.edit('old')
    expect(editor.getState().draft).toBeNull()
    expect(editor.getState().error).toBeTruthy()
  })
})
