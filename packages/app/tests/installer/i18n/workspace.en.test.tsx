import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { Workspace } from '../../../src/workspace/Workspace'
import { ImportSheet } from '../../../src/workspace/ImportSheet'
import { createDemoBridge } from '../../../src/installer/demo-bridge'
import { createDemoProfileBridge, createDemoAssetBridge } from '../../../src/profiles/demo'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))

const CJK = /[　-〿㐀-鿿＀-￯]/

describe('workspace shell in English', () => {
  it('renders the sidebar in English, with no Chinese anywhere in it', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <Workspace bridge={createDemoBridge()} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />
      </LangProvider>,
    )
    const sidebar = await screen.findByRole('complementary')
    expect(sidebar.className).toMatch(/ws-sidebar/)
    expect(sidebar.textContent).not.toMatch(CJK)

    for (const label of ['Profile', 'Theme', 'Sounds', 'Crosshair', 'Enemy look']) {
      expect(within(sidebar).getByRole('button', { name: label })).toBeVisible()
    }
    expect(within(sidebar).getByRole('button', { name: 'Quick import' })).toBeVisible()
    expect(within(sidebar).getByRole('button', { name: 'Settings' })).toBeVisible()
  })
})

describe('the add-to-game sheet in English', () => {
  it('shows its title, labels and buttons in English, with no Chinese anywhere in the sheet', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ themeName: 'Night', wallTint: { x: 0, y: 0, z: 0 } }))
    const assets: ProfileAssetBridge = {
      chooseDirectory: async () => null,
      list: async () => ({ directory: '', files: [], errors: [] }),
      read: async () => bytes,
    }
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <ImportSheet kind="theme" sourcePath="C:\Users\me\Downloads\Night.json" directory="D:\Game\FPSAimTrainer\Saved\SaveGames\Themes"
          installed={[]} assets={assets} busy={false} error={null} onAdd={async () => true} onClose={() => {}} />
      </LangProvider>,
    )
    const sheet = await screen.findByRole('dialog', { name: 'Add a theme' })
    expect(within(sheet).getByText('Source')).toBeVisible()
    expect(within(sheet).getByText('Destination')).toBeVisible()
    expect(within(sheet).getByLabelText('File name')).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeVisible()
    await screen.findByRole('button', { name: 'Add to game' })
    // The source path and directory come from fixtures with no CJK in them, so nothing here is exempt.
    expect(sheet.textContent).not.toMatch(CJK)
  })
})
