import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createManualFileDropSource, noFileDrops, routeDrop, useFileDrop, type FileDropSource } from '../../../src/workspace/file-drop'
import type { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import { renderMsg } from '../../../src/i18n'

describe('routeDrop', () => {
  it('accepts the one kind of file a section can add', () => {
    expect(routeDrop('scheme', ['C:/d/Blue.JSON'])).toEqual({ ok: true, path: 'C:/d/Blue.JSON' })
    expect(routeDrop('audio', ['C:/d/hit.ogg'])).toEqual({ ok: true, path: 'C:/d/hit.ogg' })
    expect(routeDrop('audio', ['C:/d/hit.WAV'])).toEqual({ ok: true, path: 'C:/d/hit.WAV' })
    expect(routeDrop('crosshair', ['C:/d/dot.png'])).toEqual({ ok: true, path: 'C:/d/dot.png' })
  })

  it('names the section that accepts a file dropped on the wrong one', () => {
    expect(routeDrop('audio', ['C:/d/Blue.json'])).toEqual({ ok: false, message: { key: 'import.drop.whereTheme' } })
    expect(routeDrop('scheme', ['C:/d/hit.wav'])).toEqual({ ok: false, message: { key: 'import.drop.whereSound' } })
    expect(routeDrop('profile', ['C:/d/dot.png'])).toEqual({ ok: false, message: { key: 'import.drop.whereCrosshair' } })
    expect(renderMsg('zh', { key: 'import.drop.whereTheme' })).toMatch(/Theme 栏目/)
  })

  it('the enemy skin section accepts no file drop: it picks from the game catalog', () => {
    expect(routeDrop('enemy', ['C:/d/Blue.json'])).toEqual({ ok: false, message: { key: 'import.drop.whereTheme' } })
  })

  it('takes one file at a time and says which types it knows', () => {
    expect(routeDrop('scheme', ['C:/a.json', 'C:/b.json'])).toEqual({ ok: false, message: { key: 'import.drop.tooMany' } })
    expect(routeDrop('scheme', ['C:/d/readme.txt'])).toEqual({ ok: false, message: { key: 'import.drop.unsupported' } })
    expect(routeDrop('scheme', [])).toEqual({ ok: false, message: { key: 'import.drop.empty' } })
  })
})

function Probe({ source, section = 'scheme', active = true, busy = false, onFile, onRefused }: {
  source: FileDropSource; section?: WorkspaceSection; active?: boolean; busy?: boolean; onFile: (path: string) => void; onRefused: (message: string) => void
}) {
  const hint = useFileDrop(source, { section, active, busy, onFile, onRefused })
  return <p data-testid="hint">{hint ? `${hint.accepted ? 'yes' : 'no'}:${hint.text}` : 'none'}</p>
}

describe('useFileDrop', () => {
  it('shows a hint while a file hovers, then hands an accepted drop to the section', () => {
    const source = createManualFileDropSource()
    const onFile = vi.fn(); const onRefused = vi.fn()
    render(<Probe source={source} onFile={onFile} onRefused={onRefused} />)
    act(() => source.emit({ type: 'enter', paths: ['C:/d/Blue.json'] }))
    expect(screen.getByTestId('hint')).toHaveTextContent(/^yes:/)
    act(() => source.emit({ type: 'drop', paths: ['C:/d/Blue.json'] }))
    expect(screen.getByTestId('hint')).toHaveTextContent('none')
    expect(onFile).toHaveBeenCalledWith('C:/d/Blue.json')
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('says before the drop that a file will be refused, and clears the hint on leave', () => {
    const source = createManualFileDropSource()
    const onFile = vi.fn(); const onRefused = vi.fn()
    render(<Probe source={source} onFile={onFile} onRefused={onRefused} />)
    act(() => source.emit({ type: 'enter', paths: ['C:/d/hit.wav'] }))
    expect(screen.getByTestId('hint')).toHaveTextContent(/^no:.*Sounds/)
    act(() => source.emit({ type: 'leave' }))
    expect(screen.getByTestId('hint')).toHaveTextContent('none')
    act(() => source.emit({ type: 'drop', paths: ['C:/d/hit.wav'] }))
    expect(onRefused).toHaveBeenCalledWith(expect.stringMatching(/Sounds/))
    expect(onFile).not.toHaveBeenCalled()
  })

  it('ignores a drop while the section is busy, and everything while it is inactive', () => {
    const source = createManualFileDropSource()
    const onFile = vi.fn(); const onRefused = vi.fn()
    const view = render(<Probe source={source} busy onFile={onFile} onRefused={onRefused} />)
    act(() => source.emit({ type: 'drop', paths: ['C:/d/Blue.json'] }))
    expect(onFile).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledWith(expect.stringMatching(/正在处理/))
    onRefused.mockClear()
    view.rerender(<Probe source={source} active={false} onFile={onFile} onRefused={onRefused} />)
    act(() => source.emit({ type: 'enter', paths: ['C:/d/Blue.json'] }))
    act(() => source.emit({ type: 'drop', paths: ['C:/d/Blue.json'] }))
    expect(screen.getByTestId('hint')).toHaveTextContent('none')
    expect(onFile).not.toHaveBeenCalled()
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount, and the empty source never calls back', () => {
    const source = createManualFileDropSource()
    const onFile = vi.fn()
    const view = render(<Probe source={source} onFile={onFile} onRefused={() => {}} />)
    view.unmount()
    source.emit({ type: 'drop', paths: ['C:/d/Blue.json'] })
    expect(onFile).not.toHaveBeenCalled()
    expect(noFileDrops.subscribe(() => { throw new Error('never') })).toBeTypeOf('function')
  })
})
