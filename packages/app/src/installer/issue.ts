import { hasCjk, isEnglishText, t, type Msg } from '../i18n'
import type { Issue } from './contracts'

export { hasCjk, isEnglishText }
const usable = (text: unknown): text is string => typeof text === 'string' && isEnglishText(text)

/**
 * An installer issue in both languages. The Chinese side is always the issue's own message,
 * unchanged. The English side is the issue's `messageEn` when it is real English; otherwise a
 * message that is itself English (a native failure worded only in English), and failing both,
 * a fixed English line for the issue's code. Both layers do send `messageEn`; this still guards
 * old data and any native failure that arrives as a bare, OS-localized string.
 */
export function installerIssueMsg(issue: Omit<Issue, 'messageEn'> & { messageEn?: string | undefined }): Msg {
  if (usable(issue.messageEn)) return { zh: issue.message, en: issue.messageEn }
  if (usable(issue.message)) return { zh: issue.message, en: issue.message }
  // A code this build does not know still gets an English line rather than `undefined`.
  const byCode = t('en', `installer.issue.${issue.code}`) as string | undefined
  return { zh: issue.message, en: byCode ?? t('en', 'installer.issue.ENGINE_ERROR') }
}

/**
 * A raw engine error line (no English counterpart on the wire) in the given language: Chinese is
 * shown as is; in English, a line containing CJK becomes a fixed English line, others stay as is.
 */
export function engineErrorText(lang: 'zh' | 'en', text: string): string {
  return lang === 'en' && !isEnglishText(text) ? t('en', 'installer.exec.errorUntranslated') : text
}

/**
 * One line of a final report in the given language. English uses the line's English twin when it
 * is real English, and otherwise guards the Chinese line as `engineErrorText` does (old data).
 */
export function executionErrorText(lang: 'zh' | 'en', text: string, english: string | undefined): string {
  if (lang === 'zh') return text
  return usable(english) ? english : engineErrorText('en', text)
}

/** Builds a bilingual issue from one dictionary entry, for the issues this UI raises itself. */
export function localIssue(code: Issue['code'], key: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]): Issue {
  return { code, message: t('zh', key, params), messageEn: t('en', key, params), path: null }
}
