import { describe, expect, it } from 'vitest'
import { HTML_LANG, LANGS, localizePath, otherLang, pickLang, t } from '../src/i18n'
import { zh } from '../src/i18n/zh'
import { en } from '../src/i18n/en'
import releases from '../src/data/releases.json'

/** CJK ideographs and punctuation, full-width forms. */
const CHINESE = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/
/** Labels that name the Chinese version in its own script, the one place English pages show it. */
const LANGUAGE_LABELS = new Set(['nav.lang.switch', 'nav.lang.aria', 'chooser.title', 'chooser.zh'])

describe('dictionaries', () => {
  it('have identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
  it('have no empty strings', () => {
    for (const d of [zh, en]) for (const [k, v] of Object.entries(d)) expect(v, k).not.toBe('')
  })
  it('use straight quotes in English: curly ones render as wide CJK glyphs in the site font stack', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/[“”]/)
  })
  it('keep Chinese out of English copy: the App\'s labels are described, not quoted', () => {
    for (const [k, v] of Object.entries(en)) if (!LANGUAGE_LABELS.has(k)) expect(v, k).not.toMatch(CHINESE)
  })
  it('keep Chinese out of the English release notes and known issues', () => {
    for (const r of releases.releases) {
      expect(r.notes.en, r.version).not.toMatch(CHINESE)
      for (const issue of r.knownIssues.en) expect(issue, r.version).not.toMatch(CHINESE)
    }
  })
  it('keep the four nav labels distinct per language', () => {
    for (const lang of LANGS) {
      const labels = (['nav.features', 'nav.guide', 'nav.changelog', 'nav.download'] as const).map(k => t(lang, k))
      expect(new Set(labels).size).toBe(4)
    }
  })
})

describe('helpers', () => {
  it('localizePath prefixes the language and keeps a trailing slash', () => {
    expect(localizePath('zh', '/')).toBe('/zh/')
    expect(localizePath('en', '/download')).toBe('/en/download/')
  })
  it('otherLang flips', () => {
    expect(otherLang('zh')).toBe('en')
    expect(otherLang('en')).toBe('zh')
  })
  it('pickLang prefers a saved choice, then the browser language', () => {
    expect(pickLang('en', 'zh-CN')).toBe('en')
    expect(pickLang(null, 'zh-CN')).toBe('zh')
    expect(pickLang(null, 'zh-TW')).toBe('zh')
    expect(pickLang(null, 'en-US')).toBe('en')
    expect(pickLang('nonsense', 'fr')).toBe('en')
  })
  it('maps html lang attributes', () => {
    expect(HTML_LANG.zh).toBe('zh-CN')
    expect(HTML_LANG.en).toBe('en')
  })
})
