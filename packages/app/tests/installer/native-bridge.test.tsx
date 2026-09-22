import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The native bridge talks to Rust through Tauri's invoke. Stand in for Rust here, the way
// it answers when PowerShell 7 is missing: every command rejects with the same Issue.
const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import { createNativeBridge } from '../../src/installer/bridge'
import { InstallerFailure } from '../../src/installer/contracts'
import { SchemePage } from '../../src/scheme/SchemePage'
import type { WorkspaceSection } from '../../src/workspace/WorkspaceShell'
import type { ProfileAssetBridge } from '../../src/profiles/assets'

const PWSH_MISSING = '没有找到 PowerShell 7。请先安装，然后重新打开本程序：在「终端」中运行 winget install --id Microsoft.PowerShell，或访问 https://aka.ms/powershell 下载。'
const assets: ProfileAssetBridge = {
  chooseDirectory: async () => null,
  list: async () => ({ directory: '', files: [], errors: [] }),
  read: async () => new Uint8Array(),
}

describe('native bridge when PowerShell 7 is missing', () => {
  beforeEach(() => { invoke.mockReset().mockRejectedValue({ code: 'WORKER_UNAVAILABLE', message: PWSH_MISSING, path: null }) })

  it("keeps Rust's message instead of replacing it with the generic fallback", async () => {
    const failure = await createNativeBridge().discover().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(InstallerFailure)
    expect((failure as InstallerFailure).issue.code).toBe('WORKER_UNAVAILABLE')
    expect((failure as InstallerFailure).message).toBe(PWSH_MISSING)
  })

  it('shows the install instructions on the section the user opened', async () => {
    render(<SchemePage bridge={createNativeBridge()} assets={assets} section={'scheme' as WorkspaceSection} onSelect={() => {}} />)
    expect(await screen.findByText(PWSH_MISSING)).toBeVisible()
  })
})

describe('native bridge failures that arrive as a bare string', () => {
  it('never copies OS-localized Chinese into the English half', async () => {
    invoke.mockReset().mockRejectedValue('拒绝访问。')
    const failure = await createNativeBridge().discover().catch((error: unknown) => error) as InstallerFailure
    expect(failure.issue.message).toBe('拒绝访问。')
    expect(failure.issue.messageEn).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/)
    expect(failure.issue.messageEn).toContain('PowerShell 7')
  })

  it('keeps a native string that is already English', async () => {
    invoke.mockReset().mockRejectedValue('Access is denied.')
    const failure = await createNativeBridge().discover().catch((error: unknown) => error) as InstallerFailure
    expect(failure.issue).toMatchObject({ message: 'Access is denied.', messageEn: 'Access is denied.' })
  })
})

describe('native bridge file import', () => {
  beforeEach(() => { invoke.mockReset().mockResolvedValue(null) })

  it('plans an import by path through installer_read, never sending bytes', async () => {
    const input = { gameRoot: 'D:/Game', kind: 'theme' as const, sourcePath: 'C:/Users/p/Downloads/Blue.json', sourceSha256: 'a'.repeat(64), file: 'Blue.json', revision: 1 }
    await createNativeBridge().planFileAdd(input)
    expect(invoke).toHaveBeenCalledWith('installer_read', { op: 'planFileAdd', args: input })
  })

  it('opens the native pickers for the kind being added, in the page language', async () => {
    invoke.mockResolvedValue('C:/Users/p/Downloads/hit.wav')
    expect(await createNativeBridge().pickFile('sound', 'en')).toBe('C:/Users/p/Downloads/hit.wav')
    expect(invoke).toHaveBeenCalledWith('installer_pick_file', { kind: 'sound', lang: 'en' })
    await createNativeBridge().pickFolder('game', 'zh')
    expect(invoke).toHaveBeenCalledWith('installer_pick_folder', { kind: 'game', lang: 'zh' })
  })
})


// The eight commands that never touch the engine. What matters here is the command NAME and the exact argument object:
// Rust validates both, and a silent mismatch would only surface on Windows.
describe('the reporting, account and update commands', () => {
  beforeEach(() => { invoke.mockReset().mockResolvedValue(undefined) })

  const input = {
    description: 'it crashed', contact: null, attachLog: true,
    account: { steamId: '76561190000000000', name: 'Player' },
    langChoice: 'system', lang: 'en' as const, gameFound: true,
  }

  it.each([
    ['reportPreview', (b: ReturnType<typeof createNativeBridge>) => b.reportPreview(input), 'installer_report_preview', { input }],
    ['reportSend', (b: ReturnType<typeof createNativeBridge>) => b.reportSend('a'.repeat(64)), 'installer_report_send', { sha256: 'a'.repeat(64) }],
    ['accountResolve', (b: ReturnType<typeof createNativeBridge>) => b.accountResolve('https://steamcommunity.com/id/x'), 'installer_account_resolve', { url: 'https://steamcommunity.com/id/x' }],
    ['openDownload', (b: ReturnType<typeof createNativeBridge>) => b.openDownload('zh', 'stable'), 'installer_open_download', { lang: 'zh', channel: 'stable' }],
    ['updateCheck', (b: ReturnType<typeof createNativeBridge>) => b.updateCheck(true), 'installer_update_check', { beta: true }],
  ])('%s invokes its command with exactly its arguments', async (_name, call, command, args) => {
    await call(createNativeBridge())
    expect(invoke).toHaveBeenCalledWith(command, args)
  })

  it.each([
    ['openLogs', (b: ReturnType<typeof createNativeBridge>) => b.openLogs(), 'installer_open_logs'],
    ['launchGame', (b: ReturnType<typeof createNativeBridge>) => b.launchGame(), 'installer_launch_game'],
    ['appInfo', (b: ReturnType<typeof createNativeBridge>) => b.appInfo(), 'installer_app_info'],
  ])('%s invokes its command with no arguments at all', async (_name, call, command) => {
    await call(createNativeBridge())
    // The shared `call` helper always passes a second argument; for these two it is undefined.
    expect(invoke).toHaveBeenCalledWith(command, undefined)
  })

  it('turns a native refusal into an InstallerFailure like every other command', async () => {
    invoke.mockReset().mockRejectedValue({ code: 'PLAN_STALE', message: '报告已经改变。', messageEn: 'The report changed.', path: null })
    await expect(createNativeBridge().reportSend('b'.repeat(64))).rejects.toBeInstanceOf(InstallerFailure)
  })
})
