import { zh } from './zh'
import { en } from './en'

export const LANGS = ['zh', 'en'] as const
export type Lang = typeof LANGS[number]
export type MessageKey = keyof typeof zh
export const HTML_LANG: Record<Lang, string> = { zh: 'zh-CN', en: 'en' }
export const LANG_STORAGE_KEY = 'aimloom.lang'

const dictionaries: Record<Lang, Record<MessageKey, string>> = { zh, en }

export function t(lang: Lang, key: MessageKey): string {
  return dictionaries[lang][key]
}

export function otherLang(lang: Lang): Lang {
  return lang === 'zh' ? 'en' : 'zh'
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

/** '/download' → '/en/download/'; '/' → '/en/'. Logical paths never carry the language. */
export function localizePath(lang: Lang, logicalPath: string): string {
  const trimmed = logicalPath.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? `/${lang}/` : `/${lang}/${trimmed}/`
}

/** Spec §2.1: saved choice first, then browser language (Chinese → zh, everything else → en). */
export function pickLang(saved: string | null, navigatorLanguage: string): Lang {
  if (isLang(saved)) return saved
  return /^zh\b/i.test(navigatorLanguage) ? 'zh' : 'en'
}
