import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { renderThemePreview, parseThemeDocument } from '@kvk/theme'
import { ThemePage } from '../../../src/theme/ThemePage'
import { ThemePreview } from '../../../src/theme/ThemePreview'
import { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import { createDemoBridge } from '../../../src/bridge/demo'
import { createDemoAssetBridge } from '../../../src/bridge/profiles-demo'
import type { ProfileAssetBridge } from '../../../src/bridge/assets'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:theme-en'), revokeObjectURL: vi.fn() }))

const CJK = /[　-〿㐀-鿿＀-￯]/

describe('the Theme (Theme) page in English', () => {
  it('shows its heading, eyebrow and Apply action in English, with no Chinese in the page body', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <ThemePage bridge={createDemoBridge()} assets={createDemoAssetBridge()} section={'theme' as WorkspaceSection} onSelect={() => {}} />
      </LangProvider>,
    )
    const heading = await screen.findByRole('heading', { name: 'Theme', level: 1 })
    const main = heading.closest('main') ?? heading.parentElement!.parentElement!
    expect(within(main).getByText('THEME · CUSTOMIZE')).toBeVisible()
    await screen.findByRole('button', { name: 'Apply background' })
    // The demo bridge's theme names ("Clean Dark", "snowi clarity", "clover-alternate",
    // "Broken.json") are all Latin, so nothing here needs stripping before the CJK check.
    expect(main.textContent).not.toMatch(CJK)
  })
})

describe('renderThemePreview in English', () => {
  it('produces an SVG string with no CJK', () => {
    const doc = parseThemeDocument(new TextEncoder().encode(JSON.stringify({
      themeName: 'Night Range',
      wallMaterial: 'DRYWALL', wallRoughness: 1, wallMetallic: 0, wallFullBright: 0.5, wallTint: { x: 0.1, y: 0.2, z: 0.3 }, wallTextureScale: 1,
      floorMaterial: 'DRYWALL', floorRoughness: 1, floorMetallic: 0, floorFullBright: 0.5, floorTint: { x: 0.1, y: 0.2, z: 0.3 }, floorTextureScale: 1,
      ceilingMaterial: 'DRYWALL', ceilingRoughness: 1, ceilingMetallic: 0, ceilingFullBright: 0.5, ceilingTint: { x: 0.1, y: 0.2, z: 0.3 }, ceilingTextureScale: 1,
      rampMaterial: 'DRYWALL', rampRoughness: 1, rampMetallic: 0, rampFullBright: 0.5, rampTint: { x: 0.1, y: 0.2, z: 0.3 }, rampTextureScale: 1,
      skyPresetId: 0, cloudCoverId: 0, solidSkyColor: false, sunVisible: true, skyColor: { r: 1, g: 2, b: 3, a: 255 },
    })))
    const svg = renderThemePreview(doc, 'en')
    expect(svg).toContain('Night Range')
    expect(svg).not.toMatch(CJK)
  })
})

describe('ThemePreview shows a core validation detail in the page\'s own language', () => {
  // `environment: null` fails validateThemeDocument's `object()` check on the environment field, so
  // parseThemeDocument throws a LocalizedError instead of the size/empty-file fallback.
  const invalidBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, name: 'Test Scene', environment: null, warnings: [] }))
  const assets: ProfileAssetBridge = {
    chooseDirectory: async () => null,
    list: async () => ({ directory: '', files: [], errors: [] }),
    read: async () => invalidBytes,
  }

  it('shows the English detail in English', async () => {
    render(
      <LangProvider storage={null} languages={['en-US']}>
        <ThemePreview path="C:\\Game\\Themes\\Broken.json" name="Broken" assets={assets} />
      </LangProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('environment must be an object')
    expect(alert.textContent).not.toMatch(CJK)
  })

  it('shows the Chinese detail in Chinese', async () => {
    render(
      <LangProvider storage={null} languages={['zh-CN']}>
        <ThemePreview path="C:\\Game\\Themes\\Broken.json" name="Broken" assets={assets} />
      </LangProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('environment 必须是对象')
  })
})
