import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { AudioPage } from '../../../src/audio/AudioPage'
import { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import { createDemoBridge } from '../../../src/installer/demo-bridge'
import { createDemoAssetBridge } from '../../../src/profiles/demo'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:audio-en'), revokeObjectURL: vi.fn() }))

const CJK = /[　-〿㐀-鿿＀-￯]/

describe('the Sounds (Audio) page in English', () => {
  it('shows its heading, eyebrow, tabs, search box and Apply action in English, with no Chinese in the page body', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <AudioPage bridge={createDemoBridge()} assets={createDemoAssetBridge()} section={'audio' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    const heading = await screen.findByRole('heading', { name: 'Sounds', level: 1 })
    const main = heading.closest('main') ?? heading.parentElement!.parentElement!
    expect(within(main).getByText('SOUNDS · CURRENT SETUP')).toBeVisible()

    const tabs = within(main).getByRole('group', { name: 'Sound events' })
    const buttons = within(tabs).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([
      'Kill sound', 'Spawn sound', 'MBS · Good', 'MBS · Okay', 'MBS · Bad', 'MBS · Change now',
    ])
    // Demo bindings: kill = ['saya_kick_deeper', 'Bell5'] — the current value joins with the
    // English separator, and there is no pending edit yet, so no " · Pending" suffix.
    const kill = within(tabs).getByRole('button', { name: /^Kill sound/ })
    expect(kill).toHaveAccessibleName('Kill sound (now: saya_kick_deeper, Bell5)')

    const search = within(main).getByRole('searchbox', { name: 'Search sounds' })
    expect(search).toHaveAttribute('placeholder', 'Search sounds…')

    await screen.findByRole('button', { name: 'Advanced: bind several sounds' })
    await screen.findByRole('button', { name: 'Apply sound' })

    // The demo bridge's sound names (Bell5, spawn05, saya_kick_deeper, hit, Twice, None) are
    // all Latin, so nothing here needs stripping before the CJK check.
    expect(main.textContent).not.toMatch(CJK)
  })

  it('marks a tab as pending in English once its draft differs from the binding', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <AudioPage bridge={createDemoBridge()} assets={createDemoAssetBridge()} section={'audio' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    // Kill already binds two sounds, so the list editor opens by itself: rows are "Add X",
    // not "Use X" (that form only shows for a single-sound event with the list folded away).
    fireEvent.click(await screen.findByRole('button', { name: 'Add hit' }))
    const tabs = screen.getByRole('group', { name: 'Sound events' })
    const kill = within(tabs).getByRole('button', { name: /^Kill sound/ })
    expect(kill).toHaveAccessibleName('Kill sound (now: saya_kick_deeper, Bell5) · Pending')
  })
})
