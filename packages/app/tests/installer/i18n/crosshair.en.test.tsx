import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { CrosshairPage } from '../../../src/crosshair/CrosshairPage'
import { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import { createDemoBridge } from '../../../src/installer/demo-bridge'
import { createDemoAssetBridge } from '../../../src/profiles/demo'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:crosshair-en'), revokeObjectURL: vi.fn() }))

const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/

describe('the Crosshair page in English', () => {
  it('shows its heading, eyebrow, entry cards, search box and list heading in English, with no Chinese in the page body', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <CrosshairPage bridge={createDemoBridge()} assets={createDemoAssetBridge()} section={'crosshair' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    const heading = await screen.findByRole('heading', { name: 'Crosshair', level: 1 })
    const main = heading.closest('main') ?? heading.parentElement!.parentElement!
    expect(within(main).getByText('CROSSHAIR · CURRENT SETUP')).toBeVisible()
    expect(await screen.findByRole('button', { name: 'Paste a crosshair code' })).toBeVisible()
    expect(screen.getByText('A CS2 / VALORANT share code, previewed first')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Drop or choose a PNG' })).toBeVisible()
    expect(screen.getByText('Drag one in or click · up to 512×512, 2 MiB')).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'Crosshairs in the game · 4' })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search crosshairs' })).toBeVisible()
    expect(screen.getByPlaceholderText('Search crosshairs…')).toBeVisible()
    // The demo bridge's crosshair file names ("aimloom_slot.png", "dot.png", "plus.png",
    // "circle.png") are all Latin, so nothing here needs stripping before the CJK check.
    expect(main.textContent).not.toMatch(CJK)
  })

  it('shows an English, CJK-free error for an invalid pasted code', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <CrosshairPage bridge={createDemoBridge()} assets={createDemoAssetBridge()} section={'crosshair' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Paste a crosshair code' }))
    const sheet = await screen.findByRole('dialog', { name: 'Paste a crosshair code' })
    fireEvent.change(within(sheet).getByLabelText('Crosshair code'), { target: { value: 'not a code' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Preview' }))
    const error = await within(sheet).findByText(/Unrecognized crosshair code/)
    expect(error.textContent).not.toMatch(CJK)
    expect(within(sheet).getByRole('button', { name: 'Add to game' })).toBeDisabled()
  })
})
