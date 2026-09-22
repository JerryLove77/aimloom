import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LangProvider, LANG_STORAGE_KEY } from '../../../src/i18n'
import { Workspace } from '../../../src/workspace/Workspace'
import { createDemoBridge } from '../../../src/installer/demo-bridge'
import { createDemoAssetBridge, createDemoProfileBridge } from '../../../src/profiles/demo'
import { InstallerFailure } from '../../../src/installer/contracts'
import type { InstallerBridge } from '../../../src/installer/contracts'

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m } }

function app({ langStorage = memory(), settingsStorage = memory(), bridge = createDemoBridge() }: {
  langStorage?: ReturnType<typeof memory>; settingsStorage?: ReturnType<typeof memory>; bridge?: InstallerBridge
} = {}) {
  render(<LangProvider storage={langStorage} languages={['zh-CN']}>
    <Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo storage={settingsStorage} />
  </LangProvider>)
  return { langStorage, settingsStorage }
}
// Only the active section's WorkspaceShell is ever mounted (inactive pages return null), so
// exactly one Settings button exists in the tree at a time. Its accessible name gains an update
// sentence while the dot shows (decision 3 / finding 5), so this only anchors the start.
const settingsButton = () => screen.getByRole('button', { name: /^(设置|Settings)(\s|$)/ })

describe('Settings', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('opens from the sidebar with the three language choices and the version', () => {
    app(); fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog', { name: '设置' })
    expect(within(dialog).getByRole('radio', { name: '跟随系统（当前：中文）' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: '中文' })).not.toBeChecked()
    expect(within(dialog).getByText(`Aimloom v${__APP_VERSION__}`)).toBeInTheDocument()
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: '跟随系统（当前：中文）' }))
  })
  it('switches the whole workspace to English at once and remembers it', () => {
    const { langStorage } = app(); fireEvent.click(settingsButton())
    fireEvent.click(screen.getByRole('radio', { name: 'English' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(langStorage.m.get(LANG_STORAGE_KEY)).toBe('en')
  })
  it('closes on Escape and returns focus to the button', () => {
    app(); const button = settingsButton(); fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
  it('closes on a click outside', () => {
    app(); fireEvent.click(settingsButton())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('the five sections render in both languages', () => {
    it.each([
      { lang: ['zh-CN'], headings: ['账户', '问题反馈', '更新'] },
      { lang: ['en-US'], headings: ['Account', 'Feedback', 'Updates'] },
    ])('renders Language, Account, Feedback, Updates and the version ($headings)', ({ lang, headings }) => {
      render(<LangProvider storage={memory()} languages={lang}>
        <Workspace bridge={createDemoBridge()} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo storage={memory()} />
      </LangProvider>)
      fireEvent.click(settingsButton())
      const dialog = screen.getByRole('dialog')
      for (const heading of headings) expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument()
      expect(within(dialog).getByText('feedback@aimloom.dev')).toBeInTheDocument()
    })
  })

  it('pasting a Steam link calls accountResolve and shows the name as connected, with no word about verification', async () => {
    const accountResolve = vi.fn().mockResolvedValue({ steamId: '76561190000000000', name: 'Demo Player' })
    const { settingsStorage } = app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'https://steamcommunity.com/id/demoplayer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    expect(accountResolve).toHaveBeenCalledWith('https://steamcommunity.com/id/demoplayer')
    await waitFor(() => expect(within(dialog).getByText('Demo Player')).toBeInTheDocument())
    // The user's call, 2026-09-21: a tag reading 未验证 beside a name that just connected looks
    // like a failure. Verification belongs to the upload page, which is the only place that needs it.
    expect(within(dialog).getByText('已连接')).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/验证/)
    expect(settingsStorage.m.get('aimloom.account')).toContain('Demo Player')
  })

  it('a link that fails looksLikeSteamUrl never calls accountResolve, and shows the bad-link error', () => {
    const accountResolve = vi.fn()
    app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'not a url' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    expect(accountResolve).not.toHaveBeenCalled()
    expect(within(dialog).getByText('这不像 Steam 个人资料链接。')).toBeInTheDocument()
  })

  it('a refused resolve shows the error in the player language and stores nothing', async () => {
    const accountResolve = vi.fn().mockRejectedValue(new InstallerFailure({ code: 'ENGINE_ERROR', message: '连接失败，请稍后再试。', messageEn: 'Could not connect. Try again later.', path: null }))
    const { settingsStorage } = app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'https://steamcommunity.com/id/demoplayer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('连接失败，请稍后再试。'))
    expect(settingsStorage.m.get('aimloom.account')).toBeUndefined()
  })

  it('移除 clears the stored account', async () => {
    const accountResolve = vi.fn().mockResolvedValue({ steamId: '76561190000000000', name: 'Demo Player' })
    const { settingsStorage } = app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'https://steamcommunity.com/id/demoplayer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() => expect(within(dialog).getByText('Demo Player')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '移除' }))
    expect(screen.queryByText('Demo Player')).toBeNull()
    expect(settingsStorage.m.get('aimloom.account')).toBeUndefined()
  })

  it('the startup-check switch persists', () => {
    const { settingsStorage } = app()
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    const checkbox = within(dialog).getByRole('checkbox', { name: '启动时检查新版本' })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(settingsStorage.m.get('aimloom.updates')).toBe('off')
  })

  it('with a newer version the download line appears and calls openDownload with the current language', async () => {
    const openDownload = vi.fn().mockResolvedValue(undefined)
    const bridge = { ...createDemoBridge(), updateCheck: vi.fn().mockResolvedValue({ latest: '0.9.9', newer: true }), openDownload }
    app({ bridge })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('有新版本 v0.9.9。')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '去下载' }))
    expect(openDownload).toHaveBeenCalledWith('zh')
  })

  it('the Settings button shows the dot only when newer is true', async () => {
    const bridge = { ...createDemoBridge(), updateCheck: vi.fn().mockResolvedValue({ latest: '0.9.9', newer: true }) }
    app({ bridge })
    await waitFor(() => expect(document.querySelector('.ws-update-dot')).toBeInTheDocument())
  })

  it('no dot when there is no newer version', async () => {
    app()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.querySelector('.ws-update-dot')).toBeNull()
  })

  it('a current version shows the "current" line, not the download button', async () => {
    const bridge = { ...createDemoBridge(), updateCheck: vi.fn().mockResolvedValue({ latest: '0.1.3', newer: false }) }
    app({ bridge })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('已是最新版本。')).toBeInTheDocument())
    expect(within(dialog).queryByRole('button', { name: '去下载' })).toBeNull()
  })

  it('a failed update check renders no update line and throws nothing', async () => {
    const bridge = { ...createDemoBridge(), updateCheck: vi.fn().mockRejectedValue(new Error('offline')) }
    expect(() => app({ bridge })).not.toThrow()
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(within(dialog).queryByText('已是最新版本。')).toBeNull()
    expect(within(dialog).queryByText(/有新版本/)).toBeNull()
  })

  it('打开日志文件夹 calls openLogs', () => {
    const openLogs = vi.fn().mockResolvedValue(undefined)
    app({ bridge: { ...createDemoBridge(), openLogs } })
    fireEvent.click(settingsButton())
    fireEvent.click(screen.getByRole('button', { name: '打开日志文件夹' }))
    expect(openLogs).toHaveBeenCalled()
  })

  it('shows the bilingual failure inline instead of doing nothing, when opening the log folder is refused', async () => {
    const openLogs = vi.fn().mockRejectedValue({
      code: 'ENGINE_ERROR',
      message: '日志文件夹还不存在，请先使用本程序一次。',
      messageEn: 'The logs folder does not exist yet. Use the App at least once first.',
    })
    app({ bridge: { ...createDemoBridge(), openLogs } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getByRole('button', { name: '打开日志文件夹' }))
    await waitFor(() => expect(within(dialog).getByText('日志文件夹还不存在，请先使用本程序一次。')).toBeInTheDocument())
    expect(dialog).toBeInTheDocument()
  })

  it('the feedback address is selectable text, not a button', () => {
    app(); fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    const email = within(dialog).getByText('feedback@aimloom.dev')
    expect(email.tagName).not.toBe('BUTTON')
    expect(email.tagName).not.toBe('A')
    expect(getComputedStyle(email).userSelect).not.toBe('none')
  })

  it('closing the popover while a resolve is pending stores nothing and sets no state', async () => {
    let settle: ((account: { steamId: string; name: string }) => void) | undefined
    const pending = new Promise<{ steamId: string; name: string }>(resolve => { settle = resolve })
    const accountResolve = vi.fn().mockReturnValue(pending)
    const { settingsStorage } = app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'https://steamcommunity.com/id/demoplayer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    settle?.({ steamId: '76561190000000000', name: 'Demo Player' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settingsStorage.m.get('aimloom.account')).toBeUndefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closing the popover while a resolve is about to reject stores no error either', async () => {
    let settle: ((error: unknown) => void) | undefined
    const pending = new Promise<never>((_resolve, reject) => { settle = reject })
    const accountResolve = vi.fn().mockReturnValue(pending)
    app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'https://steamcommunity.com/id/demoplayer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    settle?.(new Error('offline'))
    await new Promise(resolve => setTimeout(resolve, 0))
    // Nothing to assert on a re-opened popover's error text -- the popover that requested this
    // resolve is gone, and a fresh one (if reopened) starts from readAccount(), not from this state.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('several synchronous clicks on Connect while a resolve is pending produce exactly one accountResolve call', () => {
    const accountResolve = vi.fn().mockReturnValue(new Promise(() => {}))
    app({ bridge: { ...createDemoBridge(), accountResolve } })
    fireEvent.click(settingsButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('https://steamcommunity.com/id/…'), { target: { value: 'https://steamcommunity.com/id/demoplayer' } })
    const connect = within(dialog).getByRole('button', { name: '连接' })
    fireEvent.click(connect); fireEvent.click(connect); fireEvent.click(connect)
    expect(accountResolve).toHaveBeenCalledTimes(1)
  })

  describe('the update dot clears once the popover has been opened this session', () => {
    it('shows the dot when newer is true, before the popover has ever opened', async () => {
      const bridge = { ...createDemoBridge(), updateCheck: vi.fn().mockResolvedValue({ latest: '0.9.9', newer: true }) }
      app({ bridge })
      await waitFor(() => expect(document.querySelector('.ws-update-dot')).toBeInTheDocument())
    })
    it('the dot disappears once the popover opens, and stays gone after it closes', async () => {
      const bridge = { ...createDemoBridge(), updateCheck: vi.fn().mockResolvedValue({ latest: '0.9.9', newer: true }) }
      app({ bridge })
      await waitFor(() => expect(document.querySelector('.ws-update-dot')).toBeInTheDocument())
      fireEvent.click(settingsButton())
      expect(document.querySelector('.ws-update-dot')).toBeNull()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(document.querySelector('.ws-update-dot')).toBeNull()
    })
    it('never shows the dot when there is no newer version, even after opening the popover', async () => {
      app()
      await new Promise(resolve => setTimeout(resolve, 0))
      fireEvent.click(settingsButton())
      expect(document.querySelector('.ws-update-dot')).toBeNull()
    })
  })
})
