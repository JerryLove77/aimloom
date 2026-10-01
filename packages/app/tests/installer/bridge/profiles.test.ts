import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createNativeProfileBridge } from '../../../src/bridge/profiles'
import { createDemoProfileBridge } from '../../../src/bridge/profiles-demo'
import { v2Parsed } from '../profiles/v2'
import { InstallerFailure } from '../../../src/bridge/contracts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const native = vi.mocked(invoke)
beforeEach(() => native.mockReset())
describe('ProfileBridge', () => {
  it('uses dedicated exact routes and returns validated envelopes', async () => {
    const bridge = createNativeProfileBridge()
    const profile = v2Parsed('a', 'A')
    native.mockResolvedValueOnce({ directory: 'C:\\profiles', profiles: [profile], errors: [{ fileName: 'bad.json', message: '损坏', messageEn: 'Damaged' }] })
    const listed = await bridge.list()
    expect(listed.profiles).toEqual([profile])
    // Each unreadable file keeps its English twin, so the page can show it to an English player.
    expect(listed.errors).toEqual([{ fileName: 'bad.json', message: '损坏', messageEn: 'Damaged' }])
    expect(native).toHaveBeenLastCalledWith('installer_profile', { op: 'profileList', args: {} })
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile: null })
    expect(await bridge.read('a')).toEqual({ filePath: 'C:\\profiles\\a.json', profile: null })
    expect(native).toHaveBeenLastCalledWith('installer_profile', { op: 'profileRead', args: { id: 'a' } })
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile })
    expect((await bridge.save(profile)).profile).toEqual(profile)
    expect(native).toHaveBeenLastCalledWith('installer_profile', { op: 'profileSave', args: { profile } })
    native.mockResolvedValueOnce({ deleted: false })
    expect(await bridge.delete('a')).toEqual({ deleted: false })
    expect(native).toHaveBeenLastCalledWith('installer_profile', { op: 'profileDelete', args: { id: 'a' } })
  })
  it('does not invoke native for invalid requests', async () => {
    const bridge = createNativeProfileBridge()
    await expect(bridge.read('../bad')).rejects.toBeInstanceOf(InstallerFailure)
    await expect(bridge.delete('CON')).rejects.toBeInstanceOf(InstallerFailure)
    await expect(bridge.save({ ...v2Parsed('a', 'A'), schemaVersion: 1 } as never)).rejects.toBeInstanceOf(InstallerFailure)
    // A v1 Profile or a draft with no theme never reaches the native side.
    await expect(bridge.save({ ...v2Parsed('a', 'A'), theme: null } as never)).rejects.toBeInstanceOf(InstallerFailure)
    expect(native).not.toHaveBeenCalled()
  })
  it.each([
    { deleted: 'yes' }, { deleted: true, extra: 1 }, null,
  ])('rejects malformed delete envelope %#', async response => {
    native.mockResolvedValueOnce(response)
    await expect(createNativeProfileBridge().delete('a')).rejects.toBeInstanceOf(InstallerFailure)
  })
  it('rejects malformed list entries and read/save id mismatches', async () => {
    const bridge = createNativeProfileBridge()
    native.mockResolvedValueOnce({ directory: 'x', profiles: [], errors: [{ fileName: 'a', message: 1, messageEn: 'x' }] })
    await expect(bridge.list()).rejects.toBeInstanceOf(InstallerFailure)
    native.mockResolvedValueOnce({ directory: 'x', profiles: [], errors: [{ fileName: 'a', message: '坏了' }] })
    await expect(bridge.list()).rejects.toBeInstanceOf(InstallerFailure)
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile: v2Parsed('b', 'B') })
    await expect(bridge.read('a')).rejects.toBeInstanceOf(InstallerFailure)
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile: null })
    await expect(bridge.save(v2Parsed('a', 'A'))).rejects.toBeInstanceOf(InstallerFailure)
  })
  it('rejects a v1 Profile in a list or a read, so an old file never becomes a card', async () => {
    const bridge = createNativeProfileBridge()
    const v1 = { schemaVersion: 1, id: 'a', name: 'A', scheme: null, audio: null }
    native.mockResolvedValueOnce({ directory: 'x', profiles: [v1], errors: [] })
    await expect(bridge.list()).rejects.toBeInstanceOf(InstallerFailure)
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile: v1 })
    await expect(bridge.read('a')).rejects.toBeInstanceOf(InstallerFailure)
  })
  it('surfaces native Issue errors and normalizes plain failures', async () => {
    const bridge = createNativeProfileBridge()
    const issue = { code: 'BUSY', message: '处理中', path: null }
    native.mockRejectedValueOnce(JSON.stringify(issue))
    await expect(bridge.list()).rejects.toMatchObject({ issue })
    native.mockRejectedValueOnce('offline')
    await expect(bridge.list()).rejects.toMatchObject({ issue: { code: 'WORKER_UNAVAILABLE', message: 'offline' } })
  })
  it('gives a Chinese plain native failure the English fallback as its English side', async () => {
    const bridge = createNativeProfileBridge()
    native.mockRejectedValueOnce('无法启动工作进程')
    await expect(bridge.list()).rejects.toMatchObject({ issue: { code: 'WORKER_UNAVAILABLE', message: '无法启动工作进程', messageEn: 'Could not connect to the profile service.' } })
    native.mockRejectedValueOnce('offline')
    await expect(bridge.list()).rejects.toMatchObject({ issue: { message: 'offline', messageEn: 'offline' } })
  })
  it('rejects a returned storage filename for another id, including missing reads', async () => {
    const bridge = createNativeProfileBridge()
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\b.json', profile: null })
    await expect(bridge.read('a')).rejects.toBeInstanceOf(InstallerFailure)
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\b.json', profile: v2Parsed('a', 'A') })
    await expect(bridge.save(v2Parsed('a', 'A'))).rejects.toBeInstanceOf(InstallerFailure)
  })
  it('reads and saves the favourites through the Profile route, checking what comes back', async () => {
    const bridge = createNativeProfileBridge()
    const favorites = { theme: ['Clean Dark.json', '蓝色训练室.json'], audio: ['hit.wav'] }
    native.mockResolvedValueOnce({ favorites })
    expect(await bridge.favoritesRead()).toEqual(favorites)
    expect(native).toHaveBeenLastCalledWith('installer_profile', { op: 'profileFavoritesRead', args: {} })
    native.mockResolvedValueOnce({ favorites })
    expect(await bridge.favoritesSave(favorites)).toEqual(favorites)
    expect(native).toHaveBeenLastCalledWith('installer_profile', { op: 'profileFavoritesSave', args: { favorites } })
    for (const bad of [{ favorites: { theme: ['a.wav'], audio: [] } }, { favorites: { theme: [], audio: [], extra: [] } }, { favorites: { theme: ['A.json', 'a.json'], audio: [] } }, { theme: [], audio: [] }]) {
      native.mockResolvedValueOnce(bad)
      await expect(bridge.favoritesRead()).rejects.toBeInstanceOf(InstallerFailure)
    }
    native.mockReset()
    await expect(bridge.favoritesSave({ theme: ['../x.json'], audio: [] })).rejects.toBeInstanceOf(InstallerFailure)
    expect(native).not.toHaveBeenCalled()
  })
  it('the demo keeps favourites in its own storage key', async () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    const bridge = createDemoProfileBridge(storage)
    expect(await bridge.favoritesRead()).toEqual({ theme: [], audio: [] })
    await bridge.favoritesSave({ theme: ['Blue-room.json'], audio: [] })
    expect(await createDemoProfileBridge(storage).favoritesRead()).toEqual({ theme: ['Blue-room.json'], audio: [] })
  })
})
