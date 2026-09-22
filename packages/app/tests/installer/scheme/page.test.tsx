import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SchemePage } from '../../../src/scheme/SchemePage'
import { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { SchemeTheme } from '../../../src/installer/contracts'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:scheme'), revokeObjectURL: vi.fn() }))

const theme = (name: string, readable = true, duplicateName = false): SchemeTheme => ({
  name: readable ? name : null, file: `${name}.json`,
  path: `D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/${name}.json`, readable, duplicateName,
})
const bytes = (themeName: string) => new TextEncoder().encode(JSON.stringify({
  themeName, wallMaterial: 'DRYWALL', wallRoughness: 1, wallMetallic: 0, wallFullBright: 0.5,
  wallTint: { x: 0.1, y: 0.2, z: 0.3 }, wallTextureScale: 1,
  floorMaterial: 'DRYWALL', floorRoughness: 1, floorMetallic: 0, floorFullBright: 0.5, floorTint: { x: 0.1, y: 0.2, z: 0.3 }, floorTextureScale: 1,
  ceilingMaterial: 'DRYWALL', ceilingRoughness: 1, ceilingMetallic: 0, ceilingFullBright: 0.5, ceilingTint: { x: 0.1, y: 0.2, z: 0.3 }, ceilingTextureScale: 1,
  rampMaterial: 'DRYWALL', rampRoughness: 1, rampMetallic: 0, rampFullBright: 0.5, rampTint: { x: 0.1, y: 0.2, z: 0.3 }, rampTextureScale: 1,
  skyPresetId: 0, cloudCoverId: 0, solidSkyColor: false, sunVisible: true, skyColor: { r: 1, g: 2, b: 3, a: 255 },
}))

function fixtures() {
  const planCalls: string[] = []
  const bridge = {
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    schemeList: async (root: string) => ({ directory: `${root}/Themes`, current: 'Clean Dark', themes: [theme('Clean Dark'), theme('Blue Room'), theme('Broken', false)] }),
    planScheme: async (input: { file: string }) => { planCalls.push(input.file); return { planId: 'plan-1' } },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => ({ state: 'finished', result: { status: 'completed' } }),
    planFileAdd: async () => ({ planId: 'plan-add' }),
    pickFile: async () => null,
    reconcile: async () => ({}),
  }
  const assets: ProfileAssetBridge = {
    chooseDirectory: async () => null,
    list: async () => ({ directory: 'D:/Game/Themes', files: [], errors: [] }),
    read: async (_kind, path) => bytes('Blue Room'),
  }
  return { bridge, assets, planCalls }
}

const tree = (f: ReturnType<typeof fixtures>) => <SchemePage bridge={f.bridge} assets={f.assets} section={'scheme' as WorkspaceSection} onSelect={() => {}} />

describe('Theme page', () => {
  beforeEach(() => { vi.mocked(URL.createObjectURL).mockClear() })

  it('lists the installed themes, marks the current one and refuses an unreadable file', async () => {
    const f = fixtures()
    render(tree(f))
    expect(await screen.findByRole('button', { name: 'Blue Room 预览' })).toBeVisible()
    const current = screen.getByRole('button', { name: 'Clean Dark 预览' })
    expect(within(current).getByText('当前使用')).toBeVisible()
    // An unreadable theme has no internal name, so it is listed and disabled by file name.
    expect(screen.getByRole('button', { name: 'Broken.json 预览' })).toBeDisabled()
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用Clean Dark')
  })

  it('selecting a theme only previews it; 退出 returns to no pending change', async () => {
    const f = fixtures()
    render(tree(f))
    const apply = await screen.findByRole('button', { name: '应用背景' })
    expect(apply).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: 'Blue Room 预览' }))
    expect(screen.getByRole('button', { name: 'Blue Room 预览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用Blue Room')
    expect(apply).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '退出' }))
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('待应用无')
    expect(apply).toBeDisabled()
    expect(f.planCalls).toEqual([])
  })

  it('selecting the theme that is already current is not a change', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: 'Clean Dark 预览' }))
    expect(screen.getByRole('button', { name: '应用背景' })).toBeDisabled()
    expect(f.planCalls).toEqual([])
  })

  it('applies once, moves 当前使用 and reports the next launch', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: 'Blue Room 预览' }))
    fireEvent.click(screen.getByRole('button', { name: '应用背景' }))
    expect(await screen.findByRole('status', { name: '操作结果' })).toHaveTextContent('下次启动 KovaaK 生效')
    expect(f.planCalls).toEqual(['Blue Room.json'])
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用Blue Room')
  })

  it('keeps the selection and shows the error when applying fails', async () => {
    const f = fixtures()
    f.bridge.job = (async () => ({ state: 'failed', error: { code: 'ENGINE_ERROR', message: '文件被占用' } })) as never
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: 'Blue Room 预览' }))
    fireEvent.click(screen.getByRole('button', { name: '应用背景' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('文件被占用')
    expect(screen.getByRole('button', { name: 'Blue Room 预览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '应用背景' })).toBeEnabled()
  })

  it('locks the grid and offers 核对结果 when the outcome is unknown', async () => {
    const f = fixtures()
    f.bridge.job = (async () => ({ state: 'unknown' })) as never
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: 'Blue Room 预览' }))
    fireEvent.click(screen.getByRole('button', { name: '应用背景' }))
    expect(await screen.findByRole('button', { name: '核对结果' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Clean Dark 预览' })).toBeDisabled()
  })

  it('filters themes by name or file name as the player types, without touching the pending selection', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: 'Blue Room 预览' }))
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用Blue Room')
    const search = screen.getByRole('searchbox', { name: '搜索主题' })
    fireEvent.change(search, { target: { value: 'clean' } })
    expect(screen.getByRole('button', { name: 'Clean Dark 预览' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Blue Room 预览' })).toBeNull()
    // Filtering never touches the pending selection or the current mark, which the controller owns.
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用Blue Room')
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(/没有匹配「zzz」的主题/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(screen.getByRole('button', { name: 'Blue Room 预览' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Clean Dark 预览' })).toBeVisible()
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用Blue Room')
  })

  it('matches themes by file name too, case-insensitively', async () => {
    const f = fixtures()
    render(tree(f))
    const search = await screen.findByRole('searchbox', { name: '搜索主题' })
    fireEvent.change(search, { target: { value: 'BROKEN' } })
    expect(screen.getByRole('button', { name: 'Broken.json 预览' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Clean Dark 预览' })).toBeNull()
  })

  it('renders nothing while another section is active so a Profile draft survives', () => {
    const f = fixtures()
    render(<SchemePage bridge={f.bridge} assets={f.assets} isActive={false} section={'profile' as WorkspaceSection} onSelect={() => {}} />)
    expect(screen.queryByText('选择当前背景')).toBeNull()
  })
})
