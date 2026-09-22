import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(import.meta.dirname, '..', 'src')
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('assets', () => {
  it('declares the token set the Figma record maps to', () => {
    const css = readFileSync(join(src, 'styles', 'tokens.css'), 'utf8')
    for (const name of ['--al-gulf', '--al-papaya', '--al-ink', '--al-warm', '--al-slate', '--al-radius-control', '--al-radius-panel', '--al-space-4']) {
      expect(css, name).toContain(`${name}:`)
    }
  })
  it('never imports a remote font, stylesheet or image', () => {
    for (const file of walk(src).filter(f => /\.(css|astro)$/.test(f))) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/@import\s+url\(\s*['"]?https?:/)
      expect(text, file).not.toMatch(/url\(\s*['"]?https?:/)
      expect(text, file).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\./)
    }
  })
  it('respects reduced motion', () => {
    expect(readFileSync(join(src, 'styles', 'global.css'), 'utf8')).toContain('prefers-reduced-motion')
  })
})
