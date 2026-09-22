import { describe, expect, it } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LANG_STORAGE_KEY, LangProvider, readChoice, renderMsg, resolveLang, systemLang, t, useLang, useT, writeChoice } from '../../../src/i18n'
import { zh } from '../../../src/i18n/zh'
import { en } from '../../../src/i18n/en'

const CJK = /[　-〿㐀-鿿＀-￯]/
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
const memory = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }

describe('dictionaries', () => {
  it('have the same keys, no empty values, and the same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(zh[key], key).not.toBe(''); expect(en[key], key).not.toBe('')
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })
  it('keep English free of Chinese characters and curly quotes', () => {
    for (const [key, value] of Object.entries(en)) { expect(value, key).not.toMatch(CJK); expect(value, key).not.toMatch(/[“”‘’]/) }
  })
})

describe('choosing the language', () => {
  it('follows the first system language: any zh is Chinese, anything else English', () => {
    expect(systemLang(['zh-CN'])).toBe('zh'); expect(systemLang(['zh-TW'])).toBe('zh')
    expect(systemLang(['en-US', 'zh-CN'])).toBe('en'); expect(systemLang(['fr'])).toBe('en'); expect(systemLang([])).toBe('en')
  })
  it('a saved choice wins; system resolves; anything unreadable means system', () => {
    expect(resolveLang('en', ['zh-CN'])).toBe('en'); expect(resolveLang('system', ['zh-CN'])).toBe('zh')
    expect(readChoice(memory({ [LANG_STORAGE_KEY]: 'zh' }))).toBe('zh')
    expect(readChoice(memory({ [LANG_STORAGE_KEY]: 'klingon' }))).toBe('system')
    expect(readChoice({ getItem: () => { throw new Error('denied') } })).toBe('system')
    expect(readChoice(null)).toBe('system')
  })
  it('writing a choice never throws, even when storage refuses', () => {
    const s = memory(); writeChoice(s, 'en'); expect(s.m.get(LANG_STORAGE_KEY)).toBe('en')
    expect(() => writeChoice({ setItem: () => { throw new Error('full') } }, 'zh')).not.toThrow()
  })
})

describe('rendering text', () => {
  it('fills named placeholders and leaves unknown ones visible', () => {
    expect(t('en', 'settings.version', { version: '0.1.2' })).toBe('Aimloom v0.1.2')
    expect(t('zh', 'settings.language.system', { current: '中文' })).toBe('跟随系统（当前：中文）')
  })
  it('renders a keyed message or a backend pair in the current language', () => {
    expect(renderMsg('en', { key: 'settings.title' })).toBe('Settings')
    expect(renderMsg('zh', { zh: '甲', en: 'A' })).toBe('甲'); expect(renderMsg('en', { zh: '甲', en: 'A' })).toBe('A')
  })
})

describe('LangProvider', () => {
  function Probe() { const { lang, setChoice } = useLang(); const tr = useT(); return <button onClick={() => setChoice(lang === 'zh' ? 'en' : 'zh')}>{tr('settings.title')}</button> }
  it('renders Chinese without a provider, the language the App shipped in', () => {
    render(<Probe />); expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()
  })
  it('switches immediately, stores the choice and marks <html lang>', () => {
    const storage = memory()
    render(<LangProvider storage={storage} languages={['zh-CN']}><Probe /></LangProvider>)
    expect(document.documentElement.lang).toBe('zh-CN')
    act(() => screen.getByRole('button', { name: '设置' }).click())
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(storage.m.get(LANG_STORAGE_KEY)).toBe('en'); expect(document.documentElement.lang).toBe('en')
  })
})
