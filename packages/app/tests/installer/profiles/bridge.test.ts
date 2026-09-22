import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createNativeProfileBridge } from '../../../src/profiles/bridge'
import { createTrainingProfile } from '../../../src/profiles/model'
import { InstallerFailure } from '../../../src/installer/contracts'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const native = vi.mocked(invoke)
beforeEach(() => native.mockReset())
describe('ProfileBridge', () => {
  it('uses dedicated exact routes and returns validated envelopes', async () => {
    const bridge = createNativeProfileBridge()
    const profile = createTrainingProfile('a', 'A')
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
    await expect(bridge.save({ ...createTrainingProfile('a', 'A'), schemaVersion: 2 } as never)).rejects.toBeInstanceOf(InstallerFailure)
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
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile: createTrainingProfile('b', 'B') })
    await expect(bridge.read('a')).rejects.toBeInstanceOf(InstallerFailure)
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\a.json', profile: null })
    await expect(bridge.save(createTrainingProfile('a', 'A'))).rejects.toBeInstanceOf(InstallerFailure)
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
    native.mockResolvedValueOnce({ filePath: 'C:\\profiles\\b.json', profile: createTrainingProfile('a', 'A') })
    await expect(bridge.save(createTrainingProfile('a', 'A'))).rejects.toBeInstanceOf(InstallerFailure)
  })
})
