import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { zh } from './zh'
import { en } from './en'
import type { Issue } from '../installer/contracts'

export type Lang = 'zh' | 'en'
export type LangChoice = 'system' | Lang
export type MessageKey = keyof typeof zh
export type Params = Record<string, string | number>
/** A message kept in state: a key rendered at display time, or a pair made outside the UI. */
export type Msg = { key: MessageKey; params?: Params } | { zh: string; en: string }

export const LANG_STORAGE_KEY = 'aimloom.lang'
/** Each language named in its own script, as language pickers do. */
export const LANGUAGE_NAMES: Record<Lang, string> = { zh: '中文', en: 'English' }
const DICTS: Record<Lang, Record<MessageKey, string>> = { zh, en }

type Reader = Pick<Storage, 'getItem'> | null
type Writer = Pick<Storage, 'setItem'> | null

/**
 * CJK punctuation (U+3000–303F), ideographs (U+3400–9FFF) and full-width forms (U+FF00–FFEF) —
 * the same three ranges the Rust (`has_cjk`) and PowerShell (`Get-KvkEnglishText`) guards use.
 * This is the App's single definition; every other module imports it.
 */
const CJK = /[　-〿㐀-鿿＀-￯]/
/** True when a text holds Chinese (or other CJK) characters. */
export const hasCjk = (text: string): boolean => CJK.test(text)

/**
 * True when a text may be shown to an English player: not blank, and no CJK **outside
 * double-quoted spans**. A span is `"…"` — ASCII double quotes, no nesting — and it holds
 * game content: a file name, a theme name, a Profile name or a path, which is never
 * translated and may well be Chinese. An odd number of quotes leaves the unclosed tail
 * outside, so a broken message can never smuggle an untranslated sentence through.
 *
 * `scripts/installer/kvk-engine.ps1` (`Test-KvkEnglishSafe`) and
 * `packages/app/src-tauri/src/installer/protocol.rs` (`is_english`) implement the same rule
 * over the same CJK ranges; a shared ten-case parity table pins them together
 * (`tests/installer/i18n/english-text.test.ts`).
 */
export function isEnglishText(text: string): boolean {
  if (text.trim() === '') return false
  const parts = text.split('"')
  const last = parts.length - 1
  for (let i = 0; i <= last; i += 1) {
    const inside = i % 2 === 1 && i !== last
    if (!inside && hasCjk(parts[i] ?? '')) return false
  }
  return true
}

export function systemLang(languages: readonly string[]): Lang {
  return (languages[0] ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
export function readChoice(storage: Reader): LangChoice {
  try { const value = storage?.getItem(LANG_STORAGE_KEY); return value === 'zh' || value === 'en' || value === 'system' ? value : 'system' }
  catch { return 'system' }
}
export function writeChoice(storage: Writer, choice: LangChoice): void {
  try { storage?.setItem(LANG_STORAGE_KEY, choice) } catch { /* the choice still holds for this session */ }
}
export function resolveLang(choice: LangChoice, languages: readonly string[]): Lang {
  return choice === 'system' ? systemLang(languages) : choice
}
export function t(lang: Lang, key: MessageKey, params?: Params): string {
  const template = DICTS[lang][key]
  return params ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : template
}
/**
 * English needs two keys wherever a count appears (spec §4.1): `<key>` reads as a plural and
 * `<key>.one` as a singular. Chinese has no plural, so every `.one` value is byte-identical to
 * its plural twin and Chinese output never changes. List headings that only append a number
 * ("Game sounds folder · 1") need no twin — only sentences do.
 */
export function plural(count: number, key: MessageKey): MessageKey {
  return count === 1 ? (`${key}.one` as MessageKey) : key
}
export function renderMsg(lang: Lang, msg: Msg): string {
  return 'key' in msg ? t(lang, msg.key, msg.params) : msg[lang]
}
/** An issue from the engine or the native layer, in the current language. */
export function issueText(lang: Lang, issue: Pick<Issue, 'message' | 'messageEn'>): string {
  return lang === 'en' ? issue.messageEn : issue.message
}

export function browserStorage(): Storage | null { try { return window.localStorage } catch { return null } }
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

interface LangState { lang: Lang; choice: LangChoice; system: Lang; setChoice(choice: LangChoice): void }
// Without a provider — every existing test — the UI is Chinese, the language it shipped in.
const LangContext = createContext<LangState>({ lang: 'zh', choice: 'zh', system: 'zh', setChoice: () => {} })

export function LangProvider({ children, storage = browserStorage(), languages = browserLanguages() }: {
  children: ReactNode; storage?: (Reader & Writer) | null; languages?: readonly string[]
}) {
  const [choice, setChoiceState] = useState<LangChoice>(() => readChoice(storage))
  const system = systemLang(languages)
  const lang = choice === 'system' ? system : choice
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  const setChoice = useCallback((next: LangChoice) => { setChoiceState(next); writeChoice(storage, next) }, [storage])
  const value = useMemo(() => ({ lang, choice, system, setChoice }), [lang, choice, system, setChoice])
  return createElement(LangContext.Provider, { value }, children)
}
export const useLang = () => useContext(LangContext)
export function useT() { const { lang } = useLang(); return useCallback((key: MessageKey, params?: Params) => t(lang, key, params), [lang]) }
export function useMsg() { const { lang } = useLang(); return useCallback((msg: Msg) => renderMsg(lang, msg), [lang]) }
