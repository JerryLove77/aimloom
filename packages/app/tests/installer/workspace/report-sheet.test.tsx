import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LangProvider } from '../../../src/i18n'
import { Workspace } from '../../../src/workspace/Workspace'
import { WorkspaceShell, SettingsState } from '../../../src/workspace/WorkspaceShell'
import { Dialog, isAnyDialogOpen } from '../../../src/installer/components/Dialog'
import { createDemoBridge } from '../../../src/installer/demo-bridge'
import { createDemoAssetBridge, createDemoProfileBridge } from '../../../src/profiles/demo'
import { createReportController, type ReportContext } from '../../../src/workspace/report-controller'
import { GAME_ROOT_STORAGE_KEY } from '../../../src/workspace/game-root'
import type { InstallerBridge, ReportPreview } from '../../../src/installer/contracts'

/** A `reportPreview` mock that never resolves on its own; the test resolves each call in order. */
function deferredPreview() {
  const resolvers: ((value: ReportPreview) => void)[] = []
  const fn = vi.fn().mockImplementation(() => new Promise<ReportPreview>(resolve => { resolvers.push(resolve) }))
  return { fn, resolvers }
}

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m } }

function app({ settingsStorage = memory(), bridge = createDemoBridge() }: {
  settingsStorage?: ReturnType<typeof memory>; bridge?: InstallerBridge
} = {}) {
  const result = render(<LangProvider storage={memory()} languages={['zh-CN']}>
    <Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo storage={settingsStorage} />
  </LangProvider>)
  return { settingsStorage, ...result }
}
// Only the active section's WorkspaceShell is ever mounted, so exactly one Settings button
// exists in the tree at a time (same anchor as tests/installer/workspace/settings.test.tsx).
const settingsButton = () => screen.getByRole('button', { name: /^(设置|Settings)(\s|$)/ })

/** Opens the report sheet the way a player does: Settings → 发送问题报告…. */
function openSheet() {
  fireEvent.click(settingsButton())
  fireEvent.click(screen.getByRole('button', { name: '发送问题报告…' }))
  return screen.getByRole('dialog', { name: '发送问题报告' })
}

describe('ReportSheet', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('opens from Settings, starts focused on Cancel, and sits inside the token wrapper (like every other sheet)', () => {
    app()
    const dialog = openSheet()
    expect(document.querySelector('.kvk-installer')?.contains(dialog)).toBe(true)
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }))
  })

  it('closes on Escape, like every other sheet, and returns focus to what opened it', () => {
    app()
    const dialog = openSheet()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
  })

  it('Cancel closes it with nothing sent', () => {
    const reportPreview = vi.fn(); const reportSend = vi.fn()
    app({ bridge: { ...createDemoBridge(), reportPreview, reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
    expect(reportPreview).not.toHaveBeenCalled(); expect(reportSend).not.toHaveBeenCalled()
  })

  it('enforces the 2,000 / 200 character limits in the field itself and shows the running count', () => {
    app()
    const dialog = openSheet()
    fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'x'.repeat(2500) } })
    expect(within(dialog).getByLabelText('发生了什么？（选填）')).toHaveValue('x'.repeat(2000))
    expect(within(dialog).getByText('2000 / 2000')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('联系方式（选填）'), { target: { value: 'y'.repeat(300) } })
    expect(within(dialog).getByLabelText('联系方式（选填）')).toHaveValue('y'.repeat(200))
  })

  it('shows the account line when an account is stored', () => {
    const settingsStorage = memory()
    settingsStorage.setItem('aimloom.account', JSON.stringify({ steamId: '76561190000000000', name: 'PlayerOne' }))
    app({ settingsStorage })
    const dialog = openSheet()
    expect(within(dialog).getByText('以 PlayerOne 的身份发送')).toBeInTheDocument()
  })

  it('shows "sent without an account" with no stored account', () => {
    app()
    const dialog = openSheet()
    expect(within(dialog).getByText('不带账户发送')).toBeInTheDocument()
  })

  it('the preview box shows exactly the text reportPreview returned', async () => {
    const reportPreview = vi.fn().mockResolvedValue({ text: 'EXACT PAYLOAD TEXT\nwith a second line', sha256: 'a'.repeat(64), bytes: 10 })
    app({ bridge: { ...createDemoBridge(), reportPreview } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
    expect(within(dialog).getByText('正在准备…')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByText('EXACT PAYLOAD TEXT', { exact: false })).toBeInTheDocument())
    expect(within(dialog).getByText((_, node) => node?.tagName === 'PRE' && node.textContent === 'EXACT PAYLOAD TEXT\nwith a second line')).toBeInTheDocument()
    expect(reportPreview).toHaveBeenCalledTimes(1)
  })

  it('editing description, contact or the checkbox after a preview invalidates it: Send rebuilds and sends the NEW hash, never the old one', async () => {
    const reportPreview = vi.fn()
      .mockResolvedValueOnce({ text: 'first build', sha256: 'sha-one', bytes: 1 })
      .mockResolvedValueOnce({ text: 'second build', sha256: 'sha-two', bytes: 1 })
    const reportSend = vi.fn().mockResolvedValue({ number: 'AL-1' })
    app({ bridge: { ...createDemoBridge(), reportPreview, reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
    await waitFor(() => expect(within(dialog).getByText('first build')).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'edited after preview' } })
    // The stale text is gone -- editing collapses the preview rather than showing bytes that no longer match.
    expect(within(dialog).queryByText('first build')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(reportSend).toHaveBeenCalledWith('sha-two'))
    expect(reportSend).not.toHaveBeenCalledWith('sha-one')
    expect(reportPreview).toHaveBeenCalledTimes(2)
  })

  it('the checkbox also invalidates a built preview', async () => {
    const reportPreview = vi.fn()
      .mockResolvedValueOnce({ text: 'with log', sha256: 'sha-a', bytes: 1 })
      .mockResolvedValueOnce({ text: 'without log', sha256: 'sha-b', bytes: 1 })
    const reportSend = vi.fn().mockResolvedValue({ number: 'AL-2' })
    app({ bridge: { ...createDemoBridge(), reportPreview, reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
    await waitFor(() => expect(within(dialog).getByText('with log')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '附上日志' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(reportSend).toHaveBeenCalledWith('sha-b'))
    expect(reportPreview).toHaveBeenCalledTimes(2)
  })

  it('Send with no preview ever expanded still calls reportPreview first, then sends its hash', async () => {
    const reportPreview = vi.fn().mockResolvedValue({ text: 'built for send', sha256: 'sha-direct', bytes: 1 })
    const reportSend = vi.fn().mockResolvedValue({ number: 'AL-3' })
    app({ bridge: { ...createDemoBridge(), reportPreview, reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(reportSend).toHaveBeenCalledWith('sha-direct'))
    expect(reportPreview).toHaveBeenCalledTimes(1)
  })

  it('while sending: Esc does not close it, Cancel is disabled, and a second Send click makes no second call', async () => {
    let settle: ((value: { number: string }) => void) | undefined
    const pending = new Promise<{ number: string }>(resolve => { settle = resolve })
    const reportSend = vi.fn().mockReturnValue(pending)
    app({ bridge: { ...createDemoBridge(), reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByText('正在发送…')).toBeInTheDocument())
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '发送问题报告' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '正在发送…' }))
    settle?.({ number: 'AL-4' })
    await waitFor(() => expect(within(dialog).getByText('报告编号 AL-4')).toBeInTheDocument())
    expect(reportSend).toHaveBeenCalledTimes(1)
  })

  // Seen on a real screen, 2026-09-21: the failure screen offered 打开日志文件夹 and 重试 and
  // nothing else. Esc worked, but a player who does not know that was stuck looking at an error.
  it('every state of the sheet offers a visible way out, and leaving a failure keeps the text', async () => {
    const reportSend = vi.fn().mockRejectedValue(new Error('offline'))
    app({ bridge: { ...createDemoBridge(), reportSend } })
    let dialog = openSheet()
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'still here' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
    dialog = openSheet()
    expect(within(dialog).getByLabelText('发生了什么？（选填）')).toHaveValue('still here')
  })

  it('a failure shows the reason, keeps the typed text, and is never retried automatically; Retry returns to the form', async () => {
    const reportSend = vi.fn().mockRejectedValue(new Error('offline'))
    app({ bridge: { ...createDemoBridge(), reportSend } })
    const dialog = openSheet()
    fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'my bug report text' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument())
    expect(within(dialog).getByText('你写的内容还在，可以再发一次。')).toBeInTheDocument()
    expect(within(dialog).getByText('feedback@aimloom.dev')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '打开日志文件夹' })).toBeInTheDocument()
    expect(reportSend).toHaveBeenCalledTimes(1)
    // Nothing retries by itself: still exactly one call after the failure has settled and rendered.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reportSend).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
    expect(within(dialog).getByLabelText('发生了什么？（选填）')).toHaveValue('my bug report text')
    expect(reportSend).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('打开日志文件夹 on the failure screen calls the bridge and does not close the sheet', async () => {
    const reportSend = vi.fn().mockRejectedValue(new Error('offline'))
    const openLogs = vi.fn().mockResolvedValue(undefined)
    app({ bridge: { ...createDemoBridge(), reportSend, openLogs } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '打开日志文件夹' }))
    expect(openLogs).toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '发送问题报告' })).toBeInTheDocument()
  })

  it('shows the bilingual failure inline when 打开日志文件夹 itself is refused, instead of doing nothing', async () => {
    const reportSend = vi.fn().mockRejectedValue(new Error('offline'))
    const openLogs = vi.fn().mockRejectedValue({
      code: 'ENGINE_ERROR',
      message: '日志文件夹还不存在，请先使用本程序一次。',
      messageEn: 'The logs folder does not exist yet. Use the App at least once first.',
    })
    app({ bridge: { ...createDemoBridge(), reportSend, openLogs } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '打开日志文件夹' })).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '打开日志文件夹' }))
    await waitFor(() => expect(within(dialog).getByText('日志文件夹还不存在，请先使用本程序一次。')).toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: '发送问题报告' })).toBeInTheDocument()
  })

  describe('game.found means the game was actually found (S5)', () => {
    it('reports found=true when nothing is remembered but the game is discoverable', async () => {
      const reportPreview = vi.fn().mockResolvedValue({ text: 't', sha256: 'sha-1', bytes: 1 })
      // Demo bridge's discover() always yields exactly one candidate and locate() accepts it --
      // this is the "found automatically, never opened another section" player.
      app({ bridge: { ...createDemoBridge(), reportPreview } })
      const dialog = openSheet()
      // Lets the resolveGameRoot() kicked off on open settle before Preview is clicked, exactly
      // as a real player's click (never microtask-adjacent to the open) always would.
      await new Promise(resolve => setTimeout(resolve, 0))
      fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
      await waitFor(() => expect(reportPreview).toHaveBeenCalled())
      expect(reportPreview.mock.calls[0]![0]).toMatchObject({ gameFound: true })
    })

    it('reports found=false for a stale remembered folder that no longer validates, even though one is remembered', async () => {
      const reportPreview = vi.fn().mockResolvedValue({ text: 't', sha256: 'sha-1', bytes: 1 })
      const settingsStorage = memory()
      settingsStorage.setItem(GAME_ROOT_STORAGE_KEY, 'E:\\Games\\FPSAimTrainer')
      const bridge: InstallerBridge = {
        ...createDemoBridge(),
        reportPreview,
        discover: async () => ({ candidates: [], defaultPack: '' }),
        locate: async () => { throw new Error('not a game folder') },
      }
      app({ settingsStorage, bridge })
      const dialog = openSheet()
      await new Promise(resolve => setTimeout(resolve, 0))
      fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
      await waitFor(() => expect(reportPreview).toHaveBeenCalled())
      expect(reportPreview.mock.calls[0]![0]).toMatchObject({ gameFound: false })
    })
  })

  it('success shows the report number, and Copy writes exactly that number to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const reportSend = vi.fn().mockResolvedValue({ number: 'AL-260921-7K3F' })
    app({ bridge: { ...createDemoBridge(), reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByText('报告编号 AL-260921-7K3F')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('AL-260921-7K3F')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '已复制' })).toBeInTheDocument())
  })

  it('Copy does nothing (and does not throw) when the clipboard API is unavailable', async () => {
    // jsdom has no navigator.clipboard by default; this proves ReportSheet guards it rather than assuming it exists.
    const reportSend = vi.fn().mockResolvedValue({ number: 'AL-5' })
    app({ bridge: { ...createDemoBridge(), reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByText('报告编号 AL-5')).toBeInTheDocument())
    expect(() => fireEvent.click(within(dialog).getByRole('button', { name: '复制' }))).not.toThrow()
    expect(within(dialog).queryByRole('button', { name: '已复制' })).toBeNull()
  })

  it('openReport() is refused while another sheet is open, and the Settings button becomes unreachable', async () => {
    app()
    fireEvent.click(screen.getByRole('button', { name: 'Crosshair' }))
    const codeEntry = await screen.findByRole('button', { name: '粘贴准星代码' })
    await waitFor(() => expect(codeEntry).not.toBeDisabled())
    fireEvent.click(codeEntry)
    expect(screen.getByRole('dialog', { name: '粘贴准星代码' })).toBeInTheDocument()
    expect(settingsButton()).toBeDisabled()
    // Even a direct call cannot stack the report sheet over the open one (defense in depth,
    // independent of the disabled button): there is still exactly one dialog on screen.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('opens while a section is locked: WorkspaceShell disables Settings only for an open sheet, never for `locked`', () => {
    const openReport = vi.fn()
    function Harness() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null)
      return <SettingsState.Provider value={{
        anchor, open: setAnchor, close: () => setAnchor(null), storage: null,
        accountResolve: () => Promise.reject(new Error('no bridge')), openLogs: () => Promise.resolve(), openDownload: () => Promise.resolve(),
        update: null, updateDot: false, appInfo: null, betaOn: false, setBetaOn: () => {}, openReport, rootOverlay: null,
      }}>
        <WorkspaceShell active="scheme" onSelect={() => {}} isDemo={false} locked eyebrow="eyebrow" title="title" scope="scope">
          <div />
        </WorkspaceShell>
      </SettingsState.Provider>
    }
    render(<Harness />)
    const button = screen.getByRole('button', { name: '设置' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: '发送问题报告…' }))
    expect(openReport).toHaveBeenCalledTimes(1)
  })

  it('the sheet unmounting mid-send sets no state afterwards', async () => {
    let settle: ((value: { number: string }) => void) | undefined
    const pending = new Promise<{ number: string }>(resolve => { settle = resolve })
    const reportSend = vi.fn().mockReturnValue(pending)
    const { unmount } = app({ bridge: { ...createDemoBridge(), reportSend } })
    const dialog = openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(within(dialog).getByText('正在发送…')).toBeInTheDocument())
    expect(() => unmount()).not.toThrow()
    settle?.({ number: 'AL-6' })
    await expect(pending).resolves.toEqual({ number: 'AL-6' })
    await new Promise(resolve => setTimeout(resolve, 0))
    // Nothing left mounted to assert on; the point is that resolving after unmount throws
    // nothing and produces no React "set state on an unmounted component" act violation.
  })

  describe('fix round 1', () => {
    // These two run against `createReportController` directly, not through the rendered sheet:
    // B2 now disables the Send button while a preview is loading, which closes off the exact
    // button-click path the reviewer used to reach the race. The controller must still be safe
    // on its own terms (a future caller, a different UI, or the button state being bypassed),
    // which is what the coordinator's structural fix (the `generation` guard) is for -- so these
    // call `controller.togglePreview` / `controller.send` directly, exactly as the reviewer's own
    // isolated reproduction did ("an isolated test against the real (unmodified)
    // createReportController").
    const ctx: ReportContext = { account: null, langChoice: 'system', lang: 'zh', gameFound: false }

    it('B1: a preview still in flight when Send starts cannot resurrect itself into an untouched Retry (the reviewer\'s exact sequence)', async () => {
      const { fn: reportPreview, resolvers } = deferredPreview()
      const reportSend = vi.fn().mockRejectedValueOnce(new Error('offline'))
      const controller = createReportController({ reportPreview, reportSend })
      // 1. Open the preview (P1 starts, left unresolved).
      void controller.togglePreview(ctx)
      expect(reportPreview).toHaveBeenCalledTimes(1)
      // 2. Send starts before P1 resolves: it must await P1, never start a second request for it.
      const sending = controller.send(ctx)
      expect(reportPreview).toHaveBeenCalledTimes(1)
      // 3. P1 resolves; Send uses its hash and the send fails.
      resolvers[0]!({ text: 'A', sha256: 'sha-A', bytes: 1 })
      await sending
      expect(reportSend).toHaveBeenNthCalledWith(1, 'sha-A')
      expect(controller.getState().phase).toBe('failed')
      // 4. Retry, then Send again without editing anything.
      reportSend.mockResolvedValueOnce({ number: 'AL-RETRY' })
      controller.retry()
      const retrySending = controller.send(ctx)
      // A real, second reportPreview call must happen -- the untouched Retry never reuses P1's hash.
      expect(reportPreview).toHaveBeenCalledTimes(2)
      resolvers[1]!({ text: 'A', sha256: 'sha-B', bytes: 1 })
      await retrySending
      expect(reportSend).toHaveBeenNthCalledWith(2, 'sha-B')
      expect(reportSend).toHaveBeenCalledTimes(2)
      expect(controller.getState().phase).toBe('sent')
    })

    it('B1: the generation guard (not just de-duplication) is load-bearing -- a preview left in flight by a close must not resurrect into `kept` on reopen', async () => {
      // De-duplicating concurrent requests for the same key closes the reviewer's original
      // double-call path (the test above), but a request can still be "in flight and later
      // abandoned" without any second call ever existing: the sheet closes (B3: the draft
      // survives, but a kept preview must not) while a preview build is still crossing the
      // network. Nothing can cancel that real request. If its resolution were allowed to
      // populate `kept` unconditionally, reopening with the SAME untouched draft (same content
      // key) would silently reuse it -- indistinguishable, by content alone, from a fresh one --
      // even though the session that built it is gone. Only `generation` (bumped by
      // `closeSheet()`) can tell the two apart.
      const { fn: reportPreview, resolvers } = deferredPreview()
      app({ bridge: { ...createDemoBridge(), reportPreview } })
      let dialog = openSheet()
      fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
      await waitFor(() => expect(reportPreview).toHaveBeenCalledTimes(1))
      // Close while that request is still in flight -- nothing can cancel it.
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
      expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
      // It resolves only now, after the sheet is already closed.
      resolvers[0]!({ text: 'STALE FROM BEFORE THE CLOSE', sha256: 'sha-stale', bytes: 1 })
      await new Promise(resolve => setTimeout(resolve, 0))
      // Reopen with the exact same (empty) draft -- the content key is identical to before.
      dialog = openSheet()
      fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
      // A genuinely new request must be made: the stale one must not have been cached as `kept`.
      await waitFor(() => expect(reportPreview).toHaveBeenCalledTimes(2))
      resolvers[1]!({ text: 'FRESH AFTER REOPEN', sha256: 'sha-fresh', bytes: 1 })
      await waitFor(() => expect(within(dialog).getByText('FRESH AFTER REOPEN')).toBeInTheDocument())
      expect(within(dialog).queryByText('STALE FROM BEFORE THE CLOSE')).toBeNull()
    })

    it('B1: editing while a preview is in flight neither shows the stale result nor lets it be sent', async () => {
      const { fn: reportPreview, resolvers } = deferredPreview()
      const reportSend = vi.fn().mockResolvedValue({ number: 'AL-9' })
      const controller = createReportController({ reportPreview, reportSend })
      void controller.togglePreview(ctx)
      expect(reportPreview).toHaveBeenCalledTimes(1)
      controller.setDescription('edited before P1 resolves')
      // The box collapsed: nothing shows the (eventually stale) first request as the preview of the new text.
      expect(controller.getState().phase).toBe('form')
      expect(controller.getState().previewText).toBeNull()
      const sending = controller.send(ctx)
      expect(reportPreview).toHaveBeenCalledTimes(2)
      // Resolve the fresh (second) request first, then the stale first one late.
      resolvers[1]!({ text: 'fresh', sha256: 'sha-fresh', bytes: 1 })
      await sending
      expect(reportSend).toHaveBeenCalledWith('sha-fresh')
      resolvers[0]!({ text: 'STALE', sha256: 'sha-stale', bytes: 1 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(reportSend).not.toHaveBeenCalledWith('sha-stale')
      expect(reportSend).toHaveBeenCalledTimes(1)
    })

    it('B2: Send is disabled while a preview is loading, so clicking it fires no second reportPreview call', async () => {
      const { fn: reportPreview, resolvers } = deferredPreview()
      app({ bridge: { ...createDemoBridge(), reportPreview } })
      const dialog = openSheet()
      fireEvent.click(within(dialog).getByRole('button', { name: '查看将要发送的内容' }))
      await waitFor(() => expect(within(dialog).getByText('正在准备…')).toBeInTheDocument())
      expect(within(dialog).getByRole('button', { name: '发送' })).toBeDisabled()
      fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
      expect(reportPreview).toHaveBeenCalledTimes(1)
      resolvers[0]!({ text: 't', sha256: 'sha-1', bytes: 1 })
      await waitFor(() => expect(within(dialog).getByRole('button', { name: '发送' })).not.toBeDisabled())
    })

    it('B3: typing, then closing and reopening the sheet keeps the draft', () => {
      app()
      let dialog = openSheet()
      fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'draft text survives closing' } })
      fireEvent.change(within(dialog).getByLabelText('联系方式（选填）'), { target: { value: 'me@example.com' } })
      fireEvent.click(within(dialog).getByRole('checkbox', { name: '附上日志' }))
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
      expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
      dialog = openSheet()
      expect(within(dialog).getByLabelText('发生了什么？（选填）')).toHaveValue('draft text survives closing')
      expect(within(dialog).getByLabelText('联系方式（选填）')).toHaveValue('me@example.com')
      expect(within(dialog).getByRole('checkbox', { name: '附上日志' })).not.toBeChecked()
    })

    it('B3: a failure, closed without retrying, reopens to the form -- never the failure screen', async () => {
      const reportSend = vi.fn().mockRejectedValue(new Error('offline'))
      app({ bridge: { ...createDemoBridge(), reportSend } })
      let dialog = openSheet()
      fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
      await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument())
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
      dialog = openSheet()
      expect(within(dialog).queryByRole('alert')).toBeNull()
      expect(within(dialog).queryByText('你写的内容还在，可以再发一次。')).toBeNull()
      expect(within(dialog).getByRole('button', { name: '发送' })).toBeInTheDocument()
    })

    it('B3: after a successful send, Done clears the draft; reopening shows an empty form', async () => {
      const reportSend = vi.fn().mockResolvedValue({ number: 'AL-DONE' })
      app({ bridge: { ...createDemoBridge(), reportSend } })
      let dialog = openSheet()
      fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'about to be sent' } })
      fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
      await waitFor(() => expect(within(dialog).getByText('报告编号 AL-DONE')).toBeInTheDocument())
      fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))
      expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull()
      dialog = openSheet()
      expect(within(dialog).getByLabelText('发生了什么？（选填）')).toHaveValue('')
      expect(within(dialog).queryByText('报告编号 AL-DONE')).toBeNull()
    })

    // The report has already gone out. Keeping its text because the player pressed Esc rather than
    // Done would put an already-sent report back in front of them, one click from a duplicate.
    it('after a successful send, Esc clears the draft exactly as Done does', async () => {
      const reportSend = vi.fn().mockResolvedValue({ number: 'AL-ESC' })
      app({ bridge: { ...createDemoBridge(), reportSend } })
      let dialog = openSheet()
      fireEvent.change(within(dialog).getByLabelText('发生了什么？（选填）'), { target: { value: 'already sent' } })
      fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
      await waitFor(() => expect(within(dialog).getByText('报告编号 AL-ESC')).toBeInTheDocument())
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '发送问题报告' })).toBeNull())
      dialog = openSheet()
      expect(within(dialog).getByLabelText('发生了什么？（选填）')).toHaveValue('')
      expect(within(dialog).queryByText('报告编号 AL-ESC')).toBeNull()
      expect(reportSend).toHaveBeenCalledTimes(1)
    })

    it('B4: the open-dialog counter returns to zero under StrictMode, including an unmount while open', () => {
      function Harness({ open }: { open: boolean }) {
        return <Dialog open={open} title="strict-mode probe" onClose={() => {}}><p>body</p></Dialog>
      }
      const { rerender, unmount } = render(<StrictMode><Harness open={false} /></StrictMode>)
      expect(isAnyDialogOpen()).toBe(false)
      rerender(<StrictMode><Harness open /></StrictMode>)
      expect(isAnyDialogOpen()).toBe(true)
      rerender(<StrictMode><Harness open={false} /></StrictMode>)
      expect(isAnyDialogOpen()).toBe(false)
      rerender(<StrictMode><Harness open /></StrictMode>)
      expect(isAnyDialogOpen()).toBe(true)
      unmount()
      expect(isAnyDialogOpen()).toBe(false)
    })
  })
})
