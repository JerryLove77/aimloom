import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstallerApp } from '../../src/installer/InstallerApp'
import { createDemoBridge } from '../../src/installer/demo-bridge'

const src = join(import.meta.dirname, '..', '..', 'src')
const tokensCss = readFileSync(join(src, 'installer', 'tokens.css'), 'utf8')
const workspaceCss = readFileSync(join(src, 'workspace', 'workspace.css'), 'utf8')
const stylesCss = readFileSync(join(src, 'installer', 'styles.css'), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} not found`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, string>()
  for (const part of body.split(';')) {
    const at = part.indexOf(':')
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim().toLowerCase())
  }
  return out
}

// User, 2026-09-20: Quick import is shown in the same colour family as the five sections.
const COLOURS = ['bg', 'surface', 'raised', 'text', 'secondary', 'muted', 'line', 'control', 'accent', 'accent-hover',
  'on-accent', 'focus', 'success', 'warning', 'error', 'modal-shadow', 'overlay'].map(n => `--ki-${n}`)

describe('Quick import shares the workspace colours', () => {
  const installer = declarations(tokensCss, '.kvk-installer')
  const workspace = declarations(workspaceCss, '.profiles-app')

  it.each(COLOURS)('%s is the same value in both roots', name => {
    expect(installer.get(name)).toBeDefined()
    expect(installer.get(name)).toBe(workspace.get(name))
  })
  it('is a light scheme, so native scrollbars and form controls follow', () => {
    expect(installer.get('color-scheme')).toBe('light')
  })
  it('uses the darker accent for small text and icons: brand orange on white is only about 2.5:1', () => {
    expect(installer.get('--ki-accent-text')).toBe(workspace.get('--ws-accent-text'))
  })
  it('hard-codes no colour in the page stylesheet', () => {
    expect(stylesCss.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull()
  })
})

describe('the sidebar footer', () => {
  it('shows the real App version, not a placeholder', async () => {
    render(<InstallerApp bridge={createDemoBridge()} isDemo />)
    expect(await screen.findByText(`v${__APP_VERSION__}`)).toBeInTheDocument()
    expect(screen.queryByText('v0.1.x')).toBeNull()
  })
})
