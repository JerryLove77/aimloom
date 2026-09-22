import { hasCjk, isEnglishText, renderMsg, t, type Msg } from '../i18n'
import { LocalizedError } from '../../../core/src/types'
import { CrosshairError } from '../../../crosshair/src/errors'

/** Refusals whose meaning is fixed by their code, whatever English text a layer attached. */
const CODED: Record<string, Msg> = {
  PLAN_STALE: { key: 'common.error.planStale' },
  PLAN_MISSING: { key: 'common.error.planMissing' },
  RECOVERY_REQUIRED: { key: 'common.error.recoveryRequired' },
  BUSY: { key: 'common.error.busy' },
  GAME_RUNNING: { key: 'common.error.gameRunning' },
}

/**
 * The message to show for a failure, in both languages. A message already written for the
 * player (it contains Chinese) is kept, paired with the Issue's own English text when the
 * error carries one. A coded refusal gets its fixed wording. Anything else leads with the
 * caller's fallback and carries the raw text as detail, so bare English never stands alone.
 *
 * WORKER_UNAVAILABLE is deliberately not in the table: Rust words that one itself (a missing
 * PowerShell 7, with the install command), and that wording must reach the page.
 */
export function errorMsg(error: unknown, fallback: Msg): Msg {
  // A core validation/refusal already carries both languages itself; nothing else here (the
  // Chinese-message branch below, in particular) should second-guess or drop its English half.
  if (error instanceof LocalizedError) return { zh: error.zh, en: error.en }
  // The crosshair package's own errors (parsing a code, decoding or encoding a PNG) carry the
  // same pairing, independently of core's LocalizedError.
  if (error instanceof CrosshairError) return { zh: error.message, en: error.en }
  const source = (error && typeof error === 'object' ? ('issue' in error ? (error as { issue: unknown }).issue : error) : null) as
    { code?: unknown; message?: unknown; messageEn?: unknown } | null
  const message = typeof source?.message === 'string' ? source.message.trim() : error instanceof Error ? error.message.trim() : ''
  if (hasCjk(message)) {
    // Without the source's own *English* text, duplicating the Chinese would show Chinese to an
    // English player; the caller's fallback (always bilingual) stands in for the English side.
    // A `messageEn` that holds CJK outside quoted spans is not English, so it falls through to
    // the fallback; a Chinese file or theme name inside quotes is game content and stays.
    const english = typeof source?.messageEn === 'string' ? source.messageEn.trim() : ''
    return { zh: message, en: isEnglishText(english) ? english : renderMsg('en', fallback) }
  }
  const coded = typeof source?.code === 'string' ? CODED[source.code] : undefined
  if (coded) return coded
  if (!message) return fallback
  return {
    zh: t('zh', 'common.error.detail', { fallback: renderMsg('zh', fallback), detail: message }),
    en: t('en', 'common.error.detail', { fallback: renderMsg('en', fallback), detail: message }),
  }
}
