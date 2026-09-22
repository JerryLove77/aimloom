import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../src/i18n'
import { HelpPage } from '../../src/installer/pages/HelpPage'

/**
 * The legacy installer's Help page (spec §2.3): it has no Settings button, so its aside carries
 * its own Feedback block (send a report, the address, open the log folder), and the two promises
 * about the network are the reworded, truthful ones (spec §3.4).
 */
describe('HelpPage — Feedback block', () => {
  it('renders send-a-report and open-logs, wired to the handlers, in Chinese', async () => {
    const user = userEvent.setup()
    const onSendReport = vi.fn()
    const onOpenLogs = vi.fn().mockResolvedValue(undefined)
    render(<LangProvider storage={null} languages={['zh-CN']}><HelpPage onSendReport={onSendReport} onOpenLogs={onOpenLogs} /></LangProvider>)

    const send = screen.getByRole('button', { name: '发送问题报告…' })
    await user.click(send)
    expect(onSendReport).toHaveBeenCalledOnce()

    const openLogs = screen.getByRole('button', { name: '打开日志文件夹' })
    await user.click(openLogs)
    expect(onOpenLogs).toHaveBeenCalledOnce()

    // The address is plain selectable text, not a button or link.
    expect(screen.getByText('feedback@aimloom.dev')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'feedback@aimloom.dev' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'feedback@aimloom.dev' })).not.toBeInTheDocument()
  })

  it('renders the same Feedback block in English', async () => {
    const user = userEvent.setup()
    const onSendReport = vi.fn()
    const onOpenLogs = vi.fn().mockResolvedValue(undefined)
    render(<LangProvider storage={null} languages={['en-US']}><HelpPage onSendReport={onSendReport} onOpenLogs={onOpenLogs} /></LangProvider>)

    await user.click(screen.getByRole('button', { name: 'Send a report…' }))
    expect(onSendReport).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Open log folder' }))
    expect(onOpenLogs).toHaveBeenCalledOnce()
    expect(screen.getByText('feedback@aimloom.dev')).toBeInTheDocument()
  })

  it('shows the bilingual failure inline instead of doing nothing, when opening the log folder is refused', async () => {
    const user = userEvent.setup()
    const onOpenLogs = vi.fn().mockRejectedValue({
      code: 'ENGINE_ERROR',
      message: '日志文件夹还不存在，请先使用本程序一次。',
      messageEn: 'The logs folder does not exist yet. Use the App at least once first.',
    })
    render(<LangProvider storage={null} languages={['zh-CN']}><HelpPage onOpenLogs={onOpenLogs} /></LangProvider>)
    await user.click(screen.getByRole('button', { name: '打开日志文件夹' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('日志文件夹还不存在，请先使用本程序一次。')
  })

  it('omits the actions it cannot perform when no handlers are given, but still shows the address', () => {
    render(<LangProvider storage={null} languages={['zh-CN']}><HelpPage /></LangProvider>)
    expect(screen.queryByRole('button', { name: '发送问题报告…' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开日志文件夹' })).not.toBeInTheDocument()
    expect(screen.getByText('feedback@aimloom.dev')).toBeInTheDocument()
    // The hint offers "send one from inside the app". With no way to do that here, saying so
    // would be a promise this page cannot keep.
    expect(screen.queryByText('在应用里直接发送，或写信给我们。')).not.toBeInTheDocument()
  })

  it('shows the reworded network promises, in both languages, and not the old wording', () => {
    const { unmount } = render(<LangProvider storage={null} languages={['zh-CN']}><HelpPage /></LangProvider>)
    expect(screen.getByText(/只在这三种时候联系 aimloom\.dev/)).toBeInTheDocument()
    expect(screen.getByText(/它从不上传游戏文件、设置、Profile 或备份/)).toBeInTheDocument()
    expect(screen.queryByText('安装、备份、恢复和本页帮助均可离线使用。')).not.toBeInTheDocument()
    expect(screen.queryByText('不需要账号，不自动上传配置或日志。')).not.toBeInTheDocument()
    unmount()

    render(<LangProvider storage={null} languages={['en-US']}><HelpPage /></LangProvider>)
    expect(screen.getByText(/Aimloom contacts aimloom\.dev only when you send a report/)).toBeInTheDocument()
    expect(screen.getByText(/It never uploads game files, settings, Profiles or backups/)).toBeInTheDocument()
    expect(screen.queryByText('Install, backup, restore and this help all work offline.')).not.toBeInTheDocument()
    expect(screen.queryByText('No account needed; settings and logs are not uploaded automatically.')).not.toBeInTheDocument()
  })
})
