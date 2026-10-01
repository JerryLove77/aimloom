import { describe, it, expect } from 'vitest'
import { createInstallerController } from '../../src/installer/controller'
import { createInitialState } from '../../src/installer/state'
import { createDemoBridge } from '../../src/bridge/demo'
import type { InstallerBridge, Location, Preview } from '../../src/bridge/contracts'
import { GAME_ROOT_STORAGE_KEY } from '../../src/section/game-root'

/** A minimal store that behaves like localStorage, for proving what the restore page remembers. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

/** One Quick import through the bridge, so the demo game has a batch to restore. */
async function importOnce(bridge: InstallerBridge, gameRoot: string, pack: string) {
  const plan = await bridge.planImport({ gameRoot, paths: [pack], includeSettings: true, revision: 0 })
  await bridge.execute({ operationId: crypto.randomUUID(), planId: plan.planId, confirmation: 'install', allowConflicts: false })
}

async function ready() {
  const bridge = createDemoBridge({durationMs:0})
  const ctl = createInstallerController(bridge)
  await ctl.discover(); await ctl.locate()
  await importOnce(bridge, ctl.getState().gameRoot, (await bridge.discover()).defaultPack!)
  await ctl.refreshBackups()
  return {bridge,ctl}
}

describe('the restore page', () => {
  it('starts on the restore route with no plan, job or hidden write request', () => {
    const state=createInitialState()
    expect(state.route).toBe('restore')
    expect(state.preview).toBeNull(); expect(state.job).toBeNull(); expect(state.step).toBe(1)
  })
  it('never writes while previewing, and a double confirm restores once', async () => {
    const {bridge,ctl}=await ready()
    const game=ctl.getState().gameRoot
    const before=(await bridge.backups(game)).records.length
    await ctl.previewRestore('pristine')
    expect(ctl.getState().preview?.kind).toBe('restore')
    expect((await bridge.backups(game)).records.length).toBe(before)
    const [a,b]=await Promise.all([ctl.execute(false),ctl.execute(false)])
    expect(a?.operationId).toBe(b?.operationId)
    expect(ctl.getState().job?.result?.status).toBe('restored')
  })
  it('a late location result cannot overwrite a new path', async () => {
    const bridge=createDemoBridge({durationMs:0})
    const original=bridge.locate.bind(bridge)
    let resolve!: (value:Location)=>void
    bridge.locate=()=>new Promise<Location>(r=>{resolve=r})
    const ctl=createInstallerController(bridge)
    ctl.setGameRoot('first game')
    const pending=ctl.locate()
    ctl.setGameRoot('second game')
    resolve(await original('first game'))
    await pending
    expect(ctl.getState().gameRoot).toBe('second game')
    expect(ctl.getState().location).toBeNull()
    expect(ctl.getState().busy).toBe(false)
  })
  it('cannot confirm a plan made for another game folder', async () => {
    const {bridge,ctl}=await ready()
    await ctl.previewRestore('pristine')
    const before=(await bridge.backups(ctl.getState().gameRoot)).records.length
    ctl.setGameRoot('another game')
    expect(await ctl.execute(false)).toBeNull()
    expect((await bridge.backups((await bridge.discover()).candidates[0]!)).records.length).toBe(before)
  })
  it('failed native calls stay errors instead of turning into demo success', async () => {
    const bridge=createDemoBridge({durationMs:0})
    bridge.discover=async()=>{throw new Error('worker missing')}
    const ctl=createInstallerController(bridge)
    await ctl.discover()
    expect(ctl.getState().issue?.message).toBe('worker missing')
    expect(ctl.getState().discovery).toBeNull()
  })
})

it('does not execute a previous preview while a new preview is loading', async () => {
  const {bridge,ctl}=await ready()
  await ctl.previewRestore('pristine')
  const replacement={...ctl.getState().preview!}
  let resolve!: (value:Preview)=>void
  bridge.planRestore=()=>new Promise(r=>{resolve=r})
  const pending=ctl.previewRestore('pristine')
  const before=(await bridge.backups(ctl.getState().gameRoot)).records.length
  expect(await ctl.execute(false)).toBeNull()
  expect((await bridge.backups(ctl.getState().gameRoot)).records.length).toBe(before)
  resolve(replacement)
  await pending
})

describe('the restore page and the shared remembered folder', () => {
  it('tries the remembered folder instead of asking the player to browse again, when discovery finds nothing', async () => {
    const bridge = createDemoBridge({ durationMs: 0 })
    const remembered = 'D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer'
    bridge.discover = async () => ({ candidates: [], defaultPack: '' })
    const storage = fakeStorage({ [GAME_ROOT_STORAGE_KEY]: remembered })
    const ctl = createInstallerController(bridge, createInitialState(), storage)
    await ctl.discover()
    expect(ctl.getState().gameRoot).toBe(remembered)
    expect(ctl.getState().location).not.toBeNull()
    expect(ctl.getState().issue).toBeNull()
  })

  // The user's rule (2026-09-21): every page finds the game by the SAME method as the four
  // sections, so a "cannot find the game" report means one thing. Each case below is what
  // `resolveGameRoot` does, observed through the restore page.
  it('prefers the remembered folder over what discovery offers, as the sections do', async () => {
    const bridge = createDemoBridge({ durationMs: 0 })
    const remembered = 'E:\\Games\\FPSAimTrainer'
    bridge.discover = async () => ({ candidates: ['C:\\Other\\FPSAimTrainer'], defaultPack: '' })
    const ctl = createInstallerController(bridge, createInitialState(), fakeStorage({ [GAME_ROOT_STORAGE_KEY]: remembered }))
    await ctl.discover()
    expect(ctl.getState().gameRoot).toBe(remembered)
  })

  it('locates a single discovered game itself and remembers it for the sections', async () => {
    const bridge = createDemoBridge({ durationMs: 0 })
    const only = 'D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer'
    bridge.discover = async () => ({ candidates: [only], defaultPack: '' })
    const storage = fakeStorage()
    const ctl = createInstallerController(bridge, createInitialState(), storage)
    await ctl.discover()
    expect(ctl.getState().gameRoot).toBe(only)
    expect(ctl.getState().location).not.toBeNull()
    expect(storage.map.get(GAME_ROOT_STORAGE_KEY)).toBe(only)
  })

  it('chooses nothing when discovery offers several, and forgets a remembered folder that no longer resolves', async () => {
    const bridge = createDemoBridge({ durationMs: 0 })
    bridge.discover = async () => ({ candidates: ['C:\\A\\FPSAimTrainer', 'D:\\B\\FPSAimTrainer'], defaultPack: '' })
    const locate = bridge.locate.bind(bridge)
    bridge.locate = async root => { if (root.startsWith('Z:')) throw new Error('gone'); return locate(root) }
    const storage = fakeStorage({ [GAME_ROOT_STORAGE_KEY]: 'Z:\\Uninstalled\\FPSAimTrainer' })
    const ctl = createInstallerController(bridge, createInitialState(), storage)
    await ctl.discover()
    expect(ctl.getState().gameRoot).toBe('')
    expect(ctl.getState().issue).toBeNull()
    expect(storage.map.has(GAME_ROOT_STORAGE_KEY)).toBe(false)
  })

  it('writes a folder the player located on the restore page to the shared storage', async () => {
    const bridge = createDemoBridge({ durationMs: 0 })
    const storage = fakeStorage()
    const ctl = createInstallerController(bridge, createInitialState(), storage)
    ctl.setGameRoot('D:\\Games\\FPSAimTrainer')
    await ctl.locate()
    expect(ctl.getState().location).not.toBeNull()
    expect(storage.map.get(GAME_ROOT_STORAGE_KEY)).toBe('D:\\Games\\FPSAimTrainer')
  })
})

it('does not attach old backup results to a newly selected game', async () => {
  const {bridge,ctl}=await ready()
  await ctl.previewRestore('pristine')
  const original=bridge.backups.bind(bridge)
  let entered!:()=>void
  const reached=new Promise<void>(resolve=>{entered=resolve})
  let finish!:()=>void
  const release=new Promise<void>(resolve=>{finish=resolve})
  bridge.backups=async root=>{entered();await release;return original(root)}
  const run=ctl.execute(false)
  await reached
  ctl.setGameRoot('new game root')
  finish();await run
  expect(ctl.getState().gameRoot).toBe('new game root')
  expect(ctl.getState().backupIndex).toBeNull()
})
