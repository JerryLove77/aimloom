import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { InstallerApp } from '../../../src/installer/InstallerApp'
import { Workspace } from '../../../src/workspace/Workspace'
import { createDemoProfileBridge, createDemoAssetBridge } from '../../../src/bridge/profiles-demo'
import { createDemoBridge } from '../../../src/bridge/demo'
import { installerIssueMsg } from '../../../src/installer/issue'
import { renderMsg } from '../../../src/i18n'
import { ExecutionPage } from '../../../src/installer/pages/ExecutionPage'

const CJK = /[　-〿㐀-鿿＀-￯]/
// The demo pack lists two game files with Chinese names (sounds and crosshairs); they are game
// content, not UI text, and may appear in the summary's file lists.
const DEMO_GAME_CONTENT = ['命中提示.wav', '十字.png']
const uiText = (el: Element) => DEMO_GAME_CONTENT.reduce((text, name) => text.replaceAll(name, ''), el.textContent ?? '')

describe('Quick import and Backup and restore in English', () => {
  it('walks Explore, the import summary, Advanced and the result with no Chinese UI text', async () => {
    const user = userEvent.setup()
    const bridge = createDemoBridge({ durationMs: 0 })
    const { container } = render(
      <LangProvider storage={null} languages={['en-US']}>
        <Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />
      </LangProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Explore' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Quick import' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Backup and restore' })).toBeInTheDocument()
    expect(uiText(container)).not.toMatch(CJK)

    // A pack folder (the demo reads a path with no extension as one) and a loose sound.
    bridge.pickFiles = async () => ['C:\\Users\\Player1\\Downloads\\Pack', 'C:\\Users\\Player1\\Downloads\\Soft.wav']
    await user.click(screen.getByRole('button', { name: 'Choose files' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Quick import' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /^Adds / })).toBeInTheDocument()
    await user.click(screen.getByText('Already in the game or repeated — skipped'))
    expect(screen.getAllByText('Already in the game, same content').length).toBeGreaterThan(0)
    expect(uiText(container)).not.toMatch(CJK)

    await user.click(screen.getByRole('button', { name: /Advanced: also import personal settings/ }))
    await user.click(screen.getByRole('checkbox', { name: /Also import/ }))
    expect(await screen.findByText('This replaces your sensitivity, DPI, FOV and other settings')).toBeInTheDocument()
    expect(uiText(container)).not.toMatch(CJK)

    await user.click(await screen.findByRole('button', { name: 'Add to game' }))
    expect(await screen.findByText(/^Added \d+ files$/)).toBeInTheDocument()
    expect(uiText(container)).not.toMatch(CJK)
  })

  it('walks restore and help with no Chinese UI text', async () => {
    const user = userEvent.setup()
    const bridge = createDemoBridge({ durationMs: 0 })
    const found = await bridge.discover()
    const plan = await bridge.planImport({ gameRoot: found.candidates[0]!, paths: [found.defaultPack!], includeSettings: true, revision: 0 })
    await bridge.execute({ operationId: 'seed', planId: plan.planId, confirmation: 'install', allowConflicts: false })
    const { container } = render(
      <LangProvider storage={null} languages={['en-US']}>
        <InstallerApp bridge={bridge} isDemo />
      </LangProvider>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Restore from a backup' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'First-protection state' })).toBeInTheDocument()
    expect(uiText(container)).not.toMatch(CJK)

    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument()
    expect(screen.getByText('How do I find the game folder?')).toBeInTheDocument()
    expect(uiText(container)).not.toMatch(CJK)
  })
})

describe('installer issues in English', () => {
  it('uses messageEn when it is English', () => {
    expect(renderMsg('en', installerIssueMsg({ code: 'BUSY', message: '忙', messageEn: 'Busy now', path: null }))).toBe('Busy now')
  })
  it('falls back by code when messageEn is missing or Chinese', () => {
    const missing = { code: 'GAME_RUNNING', message: '请退出游戏。', path: null } as unknown as Parameters<typeof installerIssueMsg>[0]
    expect(renderMsg('en', installerIssueMsg(missing))).not.toMatch(CJK)
    expect(renderMsg('en', installerIssueMsg({ code: 'ENGINE_ERROR', message: '失败', messageEn: '失败', path: null }))).not.toMatch(CJK)
  })
  it('keeps an English-only native message rather than a generic fallback', () => {
    const native = { code: 'WORKER_UNAVAILABLE', message: 'PowerShell 7 was not found.', path: null } as unknown as Parameters<typeof installerIssueMsg>[0]
    expect(renderMsg('en', installerIssueMsg(native))).toBe('PowerShell 7 was not found.')
  })
  it('shows the Chinese message unchanged in Chinese', () => {
    expect(renderMsg('zh', installerIssueMsg({ code: 'BUSY', message: '忙', messageEn: 'Busy now', path: null }))).toBe('忙')
  })
})

describe('engine error lines on the result page', () => {
  const failed = { operationId: 'o', planId: 'p', state: 'finished' as const, progress: null, error: null,
    result: { status: 'rolled-back' as const, batchId: 'b', items: [], errors: ['写入失败：拒绝访问', 'Access to the path is denied.'],
      errorsEn: ['The write was refused.', 'Access to the path is denied.'] } }
  const props = { preview: null, busy: false, isDemo: false, onDone: () => {}, onBackups: () => {}, onOpenBackup: () => {}, onReconcile: () => {} }
  it('shows the English twin of each engine error in English', () => {
    render(<LangProvider storage={null} languages={['en-US']}><ExecutionPage {...props} job={failed} /></LangProvider>)
    const items = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(items).toEqual(['The write was refused.', 'Access to the path is denied.'])
  })
  it('still guards English against a missing or Chinese twin (old data)', () => {
    const old = { ...failed, result: { ...failed.result, errorsEn: ['还是中文'] } }
    render(<LangProvider storage={null} languages={['en-US']}><ExecutionPage {...props} job={old} /></LangProvider>)
    const items = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(items).toEqual(['The engine reported an error; details are in the log. Send a report, or write to feedback@aimloom.dev.', 'Access to the path is denied.'])
  })
  it('shows engine errors verbatim in Chinese', () => {
    render(<LangProvider storage={null} languages={['zh-CN']}><ExecutionPage {...props} job={failed} /></LangProvider>)
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['写入失败：拒绝访问', 'Access to the path is denied.'])
  })
})
