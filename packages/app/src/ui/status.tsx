import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useT, type MessageKey } from '../i18n'

export type TagKind = 'current' | 'pending' | 'temporary' | 'unsaved' | 'changed' | 'saved' | 'keep' | 'missing' | 'working' | 'duplicate' | 'added'
const GLYPHS: Record<TagKind, string> = {
  current: '●', pending: '◐', temporary: '◐', unsaved: '●', changed: '●', saved: '✓',
  keep: '–', missing: '!', working: '◌', duplicate: '!', added: '+',
}
const KEYS: Record<TagKind, MessageKey> = {
  current: 'common.tag.current', pending: 'common.tag.pending', temporary: 'common.tag.temporary',
  // The aria suffix and this tag share the same word; see src/i18n/zh.ts's shell.unsaved.
  unsaved: 'shell.unsaved',
  changed: 'common.tag.changed', saved: 'common.tag.saved', keep: 'common.tag.keep', missing: 'common.tag.missing',
  working: 'common.tag.working', duplicate: 'common.tag.duplicate', added: 'common.tag.added',
}

/** A status marker: always a glyph plus words, never colour alone. */
export function Tag({ kind, children }: { kind: TagKind; children?: ReactNode }) {
  const t = useT()
  return <span className={`ws-tag ws-tag-${kind}`}><span aria-hidden="true">{GLYPHS[kind]}</span>{children ?? t(KEYS[kind])}</span>
}

/** What is in effect and what is only selected, side by side. */
export function StatusStrip({ current, currentTag = true, pending, aside }: {
  current: ReactNode
  currentTag?: boolean
  pending: ReactNode | null
  aside?: ReactNode
}) {
  const t = useT()
  return <div className="ws-strip" role="group" aria-label={t('common.statusGroup')}>
    <span className="ws-strip-cell">{currentTag ? <Tag kind="current" /> : null}<strong>{current}</strong></span>
    <span className="ws-strip-divider" aria-hidden="true" />
    <span className="ws-strip-cell">{pending === null
      ? <><span className="ws-muted">{t('common.pending')}</span><span className="ws-muted">{t('common.none')}</span></>
      : <><Tag kind="pending" /><strong>{pending}</strong></>}</span>
    {aside ? <span className="ws-strip-aside">{aside}</span> : null}
  </div>
}

export type ToastTone = 'done' | 'info'

/**
 * Light feedback. 'done' confirms an outcome the page's own state also carries; 'info' says why
 * something was not done (a refused drop), so it has no tick and stays a little longer.
 */
export function Toast({ message, tone = 'done', onDone, duration }: { message: string | null; tone?: ToastTone; onDone: () => void; duration?: number }) {
  const t = useT()
  const lasts = duration ?? (tone === 'info' ? 5000 : 3000)
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDone, lasts)
    return () => clearTimeout(timer)
  }, [message, onDone, lasts])
  if (!message) return null
  // Named so it is distinguishable from the other live regions a page may show, such as a
  // preview's "generating preview..." placeholder.
  return <div className={`ws-toast ws-toast-${tone}`} role="status" aria-label={t('common.result')}><span aria-hidden="true">{tone === 'info' ? '!' : '✓'}</span>{message}</div>
}

/** Shows each new controller message once as a toast; `show` raises one the page words itself. */
export function useToast(message: string | null) {
  const [state, setState] = useState<{ text: string; tone: ToastTone } | null>(null)
  useEffect(() => { if (message) setState({ text: message, tone: 'done' }) }, [message])
  const hide = useCallback(() => setState(null), [])
  const show = useCallback((text: string, tone: ToastTone = 'info') => setState({ text, tone }), [])
  return { toast: state?.text ?? null, tone: state?.tone ?? 'done', hide, show }
}
