import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '..', '..', '..', 'src', 'crosshair', 'crosshair.css'), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} not found`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out = new Map<string, string>()
  for (const part of body.split(';')) {
    const at = part.indexOf(':')
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return out
}

describe('crosshair.css: fine-tune section', () => {
  it('sliders and checkboxes use the workspace accent, not the browser default', () => {
    const rule = declarations('.cx-tune input[type="range"], .cx-tune input[type="checkbox"]')
    expect(rule.get('accent-color')).toBe('var(--ki-accent)')
  })
  it('the dark and light swatch backdrops are distinct colours', () => {
    const dark = declarations('.cx-tune-swatch-dark').get('background')
    const light = declarations('.cx-tune-swatch-light').get('background')
    expect(dark).toBeTruthy()
    expect(light).toBeTruthy()
    expect(dark).not.toBe(light)
  })
})
