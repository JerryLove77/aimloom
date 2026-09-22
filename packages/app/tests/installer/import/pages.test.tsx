import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { encodePng } from '../../../../crosshair/src/png'
import { SchemePage } from '../../../src/scheme/SchemePage'
import { AudioPage } from '../../../src/audio/AudioPage'
import { CrosshairPage } from '../../../src/crosshair/CrosshairPage'
import { createManualFileDropSource } from '../../../src/workspace/file-drop'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { PlanFileAddRequest } from '../../../src/installer/contracts'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:import'), revokeObjectURL: vi.fn() }))

const THEME = 'C:\\Users\\me\\Downloads\\Night.json'
const SOUND = 'C:\\Users\\me\\Downloads\\Soft.wav'
const PNG = 'C:\\Users\\me\\Downloads\\My dot.png'
const themeBytes = new TextEncoder().encode(JSON.stringify({
  themeName: 'Night', wallMaterial: 'DRYWALL', wallRoughness: 1, wallMetallic: 0, wallFullBright: 0.5, wallTint: { x: 0.1, y: 0.2, z: 0.3 }, wallTextureScale: 1,
  floorMaterial: 'DRYWALL', floorRoughness: 1, floorMetallic: 0, floorFullBright: 0.5, floorTint: { x: 0.1, y: 0.2, z: 0.3 }, floorTextureScale: 1,
  ceilingMaterial: 'DRYWALL', ceilingRoughness: 1, ceilingMetallic: 0, ceilingFullBright: 0.5, ceilingTint: { x: 0.1, y: 0.2, z: 0.3 }, ceilingTextureScale: 1,
  rampMaterial: 'DRYWALL', rampRoughness: 1, rampMetallic: 0, rampFullBright: 0.5, rampTint: { x: 0.1, y: 0.2, z: 0.3 }, rampTextureScale: 1,
  skyPresetId: 0, cloudCoverId: 0, solidSkyColor: false, sunVisible: true, skyColor: { r: 1, g: 2, b: 3, a: 255 },
  bodyColor: { x: 1, y: 0, z: 0 }, headColor: { x: 1, y: 1, z: 0 },
}))

function shared(picked: string | null) {
  const adds: PlanFileAddRequest[] = []
  const applied: string[] = []
  const reads: string[] = []
  const assets: ProfileAssetBridge = {
    chooseDirectory: async () => null,
    list: async () => ({ directory: '', files: [], errors: [] }),
    read: async (kind, path) => { reads.push(`${kind}:${path}`); return kind === 'audio' ? new Uint8Array([82, 73, 70, 70]) : themeBytes },
  }
  return {
    adds, applied, reads, assets,
    base: {
      discover: async () => ({ candidates: ['D:/Game'] }),
      locate: async (root: string) => ({ gameRoot: root }),
      pickFolder: async () => null,
      pickFile: async () => picked,
      planFileAdd: async (input: PlanFileAddRequest) => { adds.push(input); return { planId: 'plan-add' } },
      execute: async () => ({ operationId: 'op-1' }),
      job: async () => ({ state: 'finished', result: { status: 'completed' } }),
      reconcile: async () => ({}),
    },
  }
}
const addedThemes = (adds: PlanFileAddRequest[]) => adds.map(add => add.file)

describe('Theme page: adding a theme', () => {
  function setup(picked: string | null = THEME, empty = false) {
    const f = shared(picked)
    const drops = createManualFileDropSource()
    const theme = (file: string) => ({ name: file.replace(/\.json$/, ''), file, path: `D:/Game/Themes/${file}`, readable: true, duplicateName: false })
    const bridge = {
      ...f.base,
      schemeList: async (root: string) => ({ directory: `${root}/Themes`, current: 'Clean Dark', themes: empty ? [] : [theme('Clean Dark.json'), ...addedThemes(f.adds).map(theme)] }),
      planScheme: async (input: { file: string }) => { f.applied.push(input.file); return { planId: 'plan-1' } },
    }
    render(<SchemePage bridge={bridge} assets={f.assets} section="scheme" onSelect={() => {}} fileDrops={drops} />)
    return { ...f, drops }
  }

  it('picks a file, confirms it in the sheet, then selects the new tile without applying it', async () => {
    const f = setup()
    fireEvent.click(await screen.findByRole('button', { name: '添加主题…' }))
    const sheet = await screen.findByRole('dialog', { name: '添加主题到游戏' })
    expect(within(sheet).getByText(THEME)).toBeVisible()
    expect(within(sheet).getByText('D:/Game/Themes')).toBeVisible()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '添加到游戏' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.adds).toHaveLength(1)
    expect(f.adds[0]).toMatchObject({ kind: 'theme', sourcePath: THEME, file: 'Night.json', gameRoot: 'D:/Game' })
    expect(await screen.findByRole('status', { name: '操作结果' })).toHaveTextContent(/已添加「Night\.json」并选中/)
    expect(screen.getByRole('button', { name: 'Night 预览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '应用背景' })).toBeEnabled()
    expect(f.applied).toEqual([])
  })

  it('does nothing when the file picker is cancelled', async () => {
    setup(null)
    fireEvent.click(await screen.findByRole('button', { name: '添加主题…' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('answers a hovering file, opens the sheet for a dropped theme and writes only on confirm', async () => {
    const f = setup()
    await screen.findByRole('button', { name: '添加主题…' })
    act(() => f.drops.emit({ type: 'enter', paths: [THEME] }))
    expect(document.querySelector('.ws-drop-overlay')).toHaveTextContent('松开以添加主题')
    act(() => f.drops.emit({ type: 'drop', paths: [THEME] }))
    expect(document.querySelector('.ws-drop-overlay')).toBeNull()
    expect(await screen.findByRole('dialog', { name: '添加主题到游戏' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.adds).toEqual([])
  })

  it('refuses a dropped sound and says which section takes it', async () => {
    const f = setup()
    await screen.findByRole('button', { name: '添加主题…' })
    act(() => f.drops.emit({ type: 'drop', paths: [SOUND] }))
    const toast = await screen.findByRole('status', { name: '操作结果' })
    expect(toast).toHaveTextContent(/Sounds/)
    expect(toast).not.toHaveTextContent('✓')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tells a player with no themes that a file can be dragged in', async () => {
    setup(THEME, true)
    expect(await screen.findByText(/把主题 \.json 拖到这里/)).toBeVisible()
    expect(screen.getByRole('button', { name: '添加主题…' })).toBeEnabled()
  })
})

describe('Audio page: adding a sound', () => {
  it('adds a picked sound, marks its row as new and keeps the pending draft', async () => {
    const f = shared(SOUND)
    const sound = (file: string) => ({ name: file.replace(/\.(wav|ogg)$/, ''), file, path: `D:/Game/sounds/${file}`, ambiguous: false })
    const bridge = {
      ...f.base,
      audioList: async (root: string) => ({
        directory: `${root}/sounds`, sounds: [sound('Bell5.ogg'), sound('hit.wav'), ...f.adds.map(add => sound(add.file))],
        bindings: { kill: ['Bell5'], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] },
      }),
      planAudio: async (input: { event: string }) => { f.applied.push(input.event); return { planId: 'plan-1' } },
    }
    render(<AudioPage bridge={bridge} assets={f.assets} section="audio" onSelect={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '用 hit' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索音效' }), { target: { value: 'hit' } })
    fireEvent.click(screen.getByRole('button', { name: '添加音效…' }))
    const sheet = await screen.findByRole('dialog', { name: '添加音效到游戏' })
    expect(within(sheet).getByText('D:/Game/sounds')).toBeVisible()
    expect(within(sheet).getByRole('button', { name: /试听/ })).toBeEnabled()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '添加到游戏' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.adds[0]).toMatchObject({ kind: 'sound', sourcePath: SOUND, file: 'Soft.wav' })
    const row = (await screen.findByText('Soft.wav')).closest('.au-sound')!
    expect(row).toHaveTextContent('新添加')
    // The pending pick survives the add, and the search is cleared so the new row shows.
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用击杀音效：hit')
    expect(screen.getByRole('searchbox', { name: '搜索音效' })).toHaveValue('')
    expect(f.applied).toEqual([])
  })
})

describe('Crosshair page: a dropped PNG', () => {
  it('opens the add sheet with the name taken from the file and reads that file', async () => {
    const f = shared(null)
    const drops = createManualFileDropSource()
    const canonical = encodePng({ width: 3, height: 2, data: new Uint8Array(3 * 2 * 4).fill(200), warnings: [] })
    const assets: ProfileAssetBridge = { ...f.assets, read: async (kind, path) => { f.reads.push(`${kind}:${path}`); return canonical } }
    const bridge = {
      ...f.base,
      crosshairList: async (root: string) => ({ directory: `${root}/crosshairs`, crosshairs: [] }),
      planCrosshair: async () => ({ planId: 'plan-1' }),
      planCrosshairAdd: async () => ({ planId: 'plan-1' }),
      exportFile: async () => ({ path: '', bytes: 0, sha256: '' }),
    }
    render(<CrosshairPage bridge={bridge} assets={assets} section="crosshair" onSelect={() => {}} fileDrops={drops} />)
    await screen.findByRole('button', { name: '拖入或选择 PNG' })
    act(() => drops.emit({ type: 'drop', paths: [PNG] }))
    const sheet = await screen.findByRole('dialog', { name: '添加准星图片' })
    expect(within(sheet).getByLabelText('文件名')).toHaveValue('My dot')
    await waitFor(() => expect(f.reads).toContain(`crosshair:${PNG}`))
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeEnabled())
  })
})
