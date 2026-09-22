import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StatusStrip, Tag, Toast, useToast } from '../../src/workspace/ui'
import { WorkspaceShell } from '../../src/workspace/WorkspaceShell'

describe('workspace primitives', () => {
  it('labels every tag with text, not colour alone', () => {
    render(<><Tag kind="current" /><Tag kind="pending" /><Tag kind="temporary" /><Tag kind="unsaved" /><Tag kind="missing" /></>)
    for (const label of ['当前使用', '已选，未应用', '暂选', '未保存', '文件缺失']) expect(screen.getByText(label)).toBeVisible()
  })

  it('shows 待应用 无 when nothing is pending and the pending value otherwise', () => {
    const { rerender } = render(<StatusStrip current="Clean Dark" pending={null} />)
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用Clean Dark待应用无')
    rerender(<StatusStrip current="Clean Dark" pending="Blue Hour" />)
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用Blue Hour')
  })

  it('hides the toast after its duration', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    render(<Toast message="背景已应用" onDone={done} duration={3000} />)
    expect(screen.getByRole('status')).toHaveTextContent('背景已应用')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(done).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('renders nothing when there is no toast message', () => {
    render(<Toast message={null} onDone={() => {}} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a refusal toast carries no success tick and stays a little longer', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    render(<Toast message="一次只能添加一个文件。" tone="info" onDone={done} />)
    expect(screen.getByRole('status')).toHaveTextContent('一次只能添加一个文件。')
    expect(screen.getByRole('status')).not.toHaveTextContent('✓')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(done).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(done).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('a page can raise its own toast beside the controller message', () => {
    function Page({ message }: { message: string | null }) {
      const { toast, tone, hide, show } = useToast(message)
      return <><button type="button" onClick={() => show('音效文件请拖到 Audio 栏目。', 'info')}>refuse</button><Toast message={toast} tone={tone} onDone={hide} /></>
    }
    const { rerender } = render(<Page message={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'refuse' }))
    expect(screen.getByRole('status')).toHaveTextContent('音效文件请拖到 Audio 栏目。')
    expect(screen.getByRole('status')).not.toHaveTextContent('✓')
    rerender(<Page message="已添加「Night.json」" />)
    expect(screen.getByRole('status')).toHaveTextContent('✓已添加「Night.json」')
  })

  it('shows the drop hint over the window without taking focus or clicks', () => {
    const shell = (hint: { accepted: boolean; text: string } | null) => <WorkspaceShell active="scheme" onSelect={() => {}} isDemo={false} eyebrow="SCHEME" title="背景" scope="" dropHint={hint}><p>content</p></WorkspaceShell>
    const { rerender, container } = render(shell(null))
    expect(container.querySelector('.ws-drop-overlay')).toBeNull()
    rerender(shell({ accepted: true, text: '松开以添加主题' }))
    const overlay = container.querySelector('.ws-drop-overlay')!
    expect(overlay).toHaveTextContent('松开以添加主题')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
    expect(overlay).not.toHaveClass('ws-drop-overlay-refused')
    rerender(shell({ accepted: false, text: '音效文件（.wav / .ogg）请拖到 Audio 栏目。' }))
    expect(container.querySelector('.ws-drop-overlay')).toHaveClass('ws-drop-overlay-refused')
  })
})
