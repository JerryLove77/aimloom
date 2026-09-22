import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { ExploreLink } from '../../../src/workspace/ExploreLink'
import { SettingsState } from '../../../src/workspace/WorkspaceShell'
import type { ExploreKind } from '../../../src/installer/contracts'

function renderLink(lang: 'zh' | 'en', kind: ExploreKind, openExplore = vi.fn().mockResolvedValue(undefined)) {
  const value = {
    anchor: null, open: () => {}, close: () => {}, storage: null,
    accountResolve: () => Promise.reject(new Error('no bridge')), openLogs: () => Promise.resolve(), openDownload: () => Promise.resolve(), openExplore,
    update: null, updateDot: false, appInfo: null, betaOn: false, setBetaOn: () => {}, openReport: () => {}, rootOverlay: null,
  }
  render(<LangProvider storage={null} languages={[lang === 'zh' ? 'zh-CN' : 'en-US']}><SettingsState.Provider value={value}><ExploreLink kind={kind} /></SettingsState.Provider></LangProvider>)
  return openExplore
}

describe('the link to aimloom.dev\'s explorer', () => {
  it('names the kind in the page language and asks the App for that kind only', () => {
    const open = renderLink('zh', 'theme')
    fireEvent.click(screen.getByRole('button', { name: '在 aimloom.dev 找更多背景' }))
    expect(open).toHaveBeenCalledWith('zh', 'theme')
  })
  it('works the same in English for sounds and crosshairs', () => {
    const open = renderLink('en', 'crosshair')
    fireEvent.click(screen.getByRole('button', { name: 'Find more crosshairs on aimloom.dev' }))
    expect(open).toHaveBeenCalledWith('en', 'crosshair')
  })
  it('changes nothing on the page when the browser cannot be opened', async () => {
    renderLink('en', 'sound', vi.fn().mockRejectedValue(new Error('no browser')))
    fireEvent.click(screen.getByRole('button', { name: 'Find more sounds on aimloom.dev' }))
    await Promise.resolve()
    expect(screen.getByRole('button', { name: 'Find more sounds on aimloom.dev' })).toBeInTheDocument()
  })
})
