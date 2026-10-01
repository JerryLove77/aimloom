import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFavoritesStore, sortFavoritesFirst } from '../../../src/section/favorites'
import { Tiles, type TileChoice } from '../../../src/ui/Tiles'
import { Workspace } from '../../../src/workspace/Workspace'
import { ResourceSheet } from '../../../src/profiles/ResourceSheet'
import { createDemoBridge } from '../../../src/bridge/demo'
import { createDemoAssetBridge, createDemoProfileBridge } from '../../../src/bridge/profiles-demo'
import { InstallerFailure } from '../../../src/bridge/contracts'
import type { Favorites } from '../../../src/bridge/profiles'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:favorites'), revokeObjectURL: vi.fn() }))
beforeEach(() => { localStorage.clear() })

function memoryBridge(initial: Favorites = { theme: [], audio: [] }) {
  let saved = structuredClone(initial)
  return {
    saves: [] as Favorites[],
    favoritesRead: vi.fn(async () => structuredClone(saved)),
    favoritesSave: vi.fn(async function (this: { saves: Favorites[] }, favorites: Favorites) { saved = structuredClone(favorites); return structuredClone(saved) }),
  }
}

describe('favourites', () => {
  it('sorts favourites first and keeps the engine order inside each group', () => {
    const items = ['a.json', 'B.json', 'c.json', 'd.json']
    expect(sortFavoritesFirst(items, x => x, ['d.json', 'b.json'])).toEqual(['B.json', 'd.json', 'a.json', 'c.json'])
    expect(sortFavoritesFirst(items, x => x, [])).toEqual(items)
  })

  it('stars at once, saves, and drops a favourite whose file is gone', async () => {
    const bridge = memoryBridge({ theme: ['Gone.json'], audio: [] })
    const store = createFavoritesStore(bridge)
    await store.load()
    const saving = store.toggle('theme', 'Blue.json', ['Blue.json', 'Red.json'])
    expect(store.isFavorite('theme', 'blue.JSON')).toBe(true)
    expect(await saving).toBeNull()
    expect(bridge.favoritesSave).toHaveBeenLastCalledWith({ theme: ['Blue.json'], audio: [] })
    await store.toggle('theme', 'Blue.json', ['Blue.json'])
    expect(store.isFavorite('theme', 'Blue.json')).toBe(false)
  })

  it('puts the star back and says so when the save fails', async () => {
    const bridge = memoryBridge()
    bridge.favoritesSave.mockRejectedValueOnce(new InstallerFailure({ code: 'ENGINE_ERROR', message: '收藏文件已损坏', messageEn: 'The favourites file is damaged.', path: null }))
    const store = createFavoritesStore(bridge)
    await store.load()
    const failure = await store.toggle('audio', 'hit.wav', ['hit.wav'])
    expect(failure).not.toBeNull()
    expect(store.isFavorite('audio', 'hit.wav')).toBe(false)
  })

  it('saves quick toggles in order, so the last click wins', async () => {
    const bridge = memoryBridge()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const save = bridge.favoritesSave.getMockImplementation()!
    bridge.favoritesSave.mockImplementationOnce(async favorites => { await held; return save.call(bridge, favorites) })
    const store = createFavoritesStore(bridge)
    await store.load()
    const first = store.toggle('theme', 'Blue.json', ['Blue.json'])
    const second = store.toggle('theme', 'Blue.json', ['Blue.json'])
    release(); await Promise.all([first, second])
    expect(bridge.favoritesSave).toHaveBeenLastCalledWith({ theme: [], audio: [] })
    expect(store.isFavorite('theme', 'Blue.json')).toBe(false)
  })

  it('a tile star is its own button: it never selects the tile, and says whether it is on', () => {
    const choices: TileChoice[] = [{ file: 'Blue.json', label: 'Blue', detail: 'Blue.json', path: '/t/Blue.json', selectable: true }]
    const onChoose = vi.fn(); const onToggle = vi.fn()
    render(<Tiles choices={choices} page={0} pageSize={6} countKey="scheme.pagination.count" ariaLabel={c => `${c.label} 预览`}
      thumb={() => <span />} onPage={vi.fn()} onChoose={onChoose}
      favorites={{ isFavorite: () => true, onToggle, label: c => `收藏「${c.label}」` }} />)
    const star = screen.getByRole('button', { name: '收藏「Blue」' })
    expect(star).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('button', { name: 'Blue 预览' })).queryByRole('button')).toBeNull()
    fireEvent.click(star)
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('Theme and Sounds list starred files first, and the stars survive a new session', async () => {
    const profileBridge = createDemoProfileBridge()
    const tree = () => <Workspace bridge={createDemoBridge()} profileBridge={profileBridge} assetBridge={createDemoAssetBridge()} isDemo />
    const first = render(tree())
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    const tiles = async () => (await screen.findAllByRole('button', { name: / 预览$/ })).map(tile => tile.getAttribute('aria-label'))
    expect((await tiles())[0]).toBe('Clean Dark 预览')
    fireEvent.click(screen.getByRole('button', { name: '收藏「clover-alternate」' }))
    await waitFor(async () => expect((await tiles())[0]).toBe('clover-alternate 预览'))
    expect(screen.getByRole('button', { name: '收藏「clover-alternate」' })).toHaveAttribute('aria-pressed', 'true')
    // Search narrows the list and keeps the favourite first.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'c' } })
    await waitFor(async () => expect((await tiles())[0]).toBe('clover-alternate 预览'))

    fireEvent.click(screen.getByRole('button', { name: 'Sounds' }))
    const star = await screen.findByRole('button', { name: '收藏「spawn05」' })
    fireEvent.click(star)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^试听 / })[0]).toHaveAccessibleName('试听 spawn05'))
    first.unmount()

    render(tree())
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    await waitFor(async () => expect((await tiles())[0]).toBe('clover-alternate 预览'))
  })

  it('the Profile theme sheet lists the starred game themes first, with the same star', async () => {
    const store = createFavoritesStore(memoryBridge({ theme: ['Red.json'], audio: [] }))
    const item = (name: string) => ({ file: `${name}.json`, label: name, detail: `${name}.json`, path: `D:/Game/Themes/${name}.json`, selectable: true })
    render(<ResourceSheet kind="scheme" open profileName="日常" profilePath="C:/profiles/a.json" value={null} assets={createDemoAssetBridge()} isDemo
      installed={[item('Blue'), item('Red')]} favorites={store} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: / 预览$/ })[0]).toHaveAccessibleName('Red 预览'))
    expect(screen.getByRole('button', { name: '收藏「Red」' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '收藏「Blue」' })).toHaveAttribute('aria-pressed', 'false')
  })
})
