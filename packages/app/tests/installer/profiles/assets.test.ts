import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createNativeAssetBridge } from '../../../src/profiles/assets'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const call = vi.mocked(invoke)
beforeEach(() => call.mockReset())
it('decodes the exact requested file and routes folder picking', async () => {
  const bridge = createNativeAssetBridge()
  call.mockResolvedValueOnce('/assets')
  expect(await bridge.chooseDirectory('enemy', 'en')).toBe('/assets')
  expect(call).toHaveBeenCalledWith('installer_pick_folder', { kind: 'profile-assets', lang: 'en' })
  call.mockResolvedValueOnce({ path: '/assets/a.png', mimeType: 'image/png', base64: 'AQID' })
  expect(await bridge.read('crosshair', '/assets/a.png')).toEqual(new Uint8Array([1, 2, 3]))
})
it.each([
  { path: '/assets/b.png', mimeType: 'image/png', base64: 'AQID' },
  { path: '/assets/a.png', mimeType: 'audio/wav', base64: 'AQID' },
  { path: '/assets/a.png', mimeType: 'image/png', base64: '!!!!' },
  { path: '/assets/a.png', mimeType: 'image/png', base64: '' },
  { path: '/assets/a.png', mimeType: 'image/png', base64: 'AR==' },
  { path: '/assets/a.png', mimeType: 'image/png', base64: 'AQID', extra: true },
])('rejects malformed read envelopes %#', async response => {
  call.mockResolvedValue(response)
  await expect(createNativeAssetBridge().read('crosshair', '/assets/a.png')).rejects.toThrow()
})
it('validates list references and matching directory', async () => {
  call.mockResolvedValue({ directory: '/other', files: [], errors: [] })
  await expect(createNativeAssetBridge().list('audio', '/assets')).rejects.toThrow()
  call.mockResolvedValue({ directory: '/assets', files: [{ name: 'a', path: '/assets/a.exe' }], errors: [] })
  await expect(createNativeAssetBridge().list('audio', '/assets')).rejects.toThrow()
})
it('keeps the English twin of each unreadable file and refuses a row without one', async () => {
  call.mockResolvedValueOnce({ directory: '/assets', files: [], errors: [{ fileName: 'a.wav', message: '无法读取', messageEn: 'Cannot read this file' }] })
  expect((await createNativeAssetBridge().list('audio', '/assets')).errors).toEqual([{ fileName: 'a.wav', message: '无法读取', messageEn: 'Cannot read this file' }])
  call.mockResolvedValueOnce({ directory: '/assets', files: [], errors: [{ fileName: 'a.wav', message: '无法读取' }] })
  await expect(createNativeAssetBridge().list('audio', '/assets')).rejects.toThrow()
})
it('rejects reads larger than the 8 MiB raw boundary', async () => {
  call.mockResolvedValue({ path: '/assets/a.png', mimeType: 'image/png', base64: 'A'.repeat(4 * Math.ceil(8 * 1024 * 1024 / 3) + 4) })
  await expect(createNativeAssetBridge().read('crosshair', '/assets/a.png')).rejects.toThrow()
})
it('handles large valid base64 without regex stack overflow', async () => {
  call.mockResolvedValue({ path: '/assets/a.png', mimeType: 'image/png', base64: 'AQID'.repeat(200000) })
  expect((await createNativeAssetBridge().read('crosshair', '/assets/a.png')).length).toBe(600000)
})
it('accepts equivalent Windows slash spelling returned by the native filesystem', async () => {
  call.mockResolvedValueOnce({ directory: 'C:\\Assets', files: [], errors: [] })
  expect((await createNativeAssetBridge().list('scheme', 'C:/Assets')).directory).toBe('C:\\Assets')
  call.mockResolvedValueOnce({ path: 'C:\\Assets\\a.png', mimeType: 'image/png', base64: 'AQID' })
  expect(await createNativeAssetBridge().read('crosshair', 'C:/Assets/a.png')).toEqual(new Uint8Array([1,2,3]))
})
it('preserves actionable native error guidance without accepting arbitrary shapes', async () => {
  call.mockRejectedValueOnce({ code: 'ENGINE_ERROR', message: '资源目录超过 1000 个候选文件，请选择更小的目录。', path: null })
  await expect(createNativeAssetBridge().list('scheme', 'C:/Assets')).rejects.toThrow('请选择更小的目录')
})
it('gives a Chinese-only native issue the English fallback, never the Chinese text, as its English side', async () => {
  call.mockRejectedValueOnce({ code: 'ENGINE_ERROR', message: '资源目录超过 1000 个候选文件，请选择更小的目录。', path: null })
  await expect(createNativeAssetBridge().list('scheme', 'C:/Assets')).rejects.toMatchObject({
    issue: { message: '资源目录超过 1000 个候选文件，请选择更小的目录。', messageEn: 'Could not read the local asset. Check the file and folder, then try again.' },
  })
  call.mockRejectedValueOnce({ code: 'ENGINE_ERROR', message: '资源目录无效。', messageEn: 'The asset folder is invalid.', path: null })
  await expect(createNativeAssetBridge().list('scheme', 'C:/Assets')).rejects.toMatchObject({ issue: { messageEn: 'The asset folder is invalid.' } })
})
