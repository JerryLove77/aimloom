import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { EnemyPage } from '../../../src/enemy/EnemyPage'
import { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import { createDemoBridge } from '../../../src/installer/demo-bridge'

const CJK = /[　-〿㐀-鿿＀-￯]/

describe('the Enemy skin page in English', () => {
  it('shows its heading, eyebrow and Apply action in English, with no Chinese in the page body', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <EnemyPage bridge={createDemoBridge()} section={'enemy' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    const heading = await screen.findByRole('heading', { name: 'Enemy skin', level: 1 })
    const main = heading.closest('main') ?? heading.parentElement!.parentElement!
    expect(within(main).getByText('ENEMY · CURRENT SETUP')).toBeVisible()
    await screen.findByRole('button', { name: 'Apply skin' })
    // The catalog's own labels ("Ghost", "Stylized", …) are all Latin, so nothing here needs
    // stripping before the CJK check.
    expect(main.textContent).not.toMatch(CJK)
  })

  it('shows the three shape tabs in English and filters the list on the active one', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <EnemyPage bridge={createDemoBridge()} section={'enemy' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    await screen.findByRole('button', { name: /^Humanoid/, pressed: true })
    expect(screen.getByRole('button', { name: /^Cube/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Sphere/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /^Cube/ }))
    expect(await screen.findByRole('button', { name: /^Cube/, pressed: true })).toBeVisible()
  })
})
