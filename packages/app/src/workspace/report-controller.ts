import type { Lang } from '../i18n'
import type { ReportInput, ReportPreview, SteamAccount } from '../installer/contracts'
import { errorMsg } from './issue-text'
import type { Msg } from '../i18n'

/** The backend's own limits, counted the way it counts them: `string.length` (UTF-16 units). */
/**
 * Cuts at `max` UTF-16 units without splitting a surrogate pair: a lone high surrogate cannot be
 * encoded, and the native call would fail with a serde message instead of a player sentence.
 */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const last = value.charCodeAt(max - 1)
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}

export const DESCRIPTION_MAX = 2000
export const CONTACT_MAX = 200

export type ReportPhase = 'form' | 'previewing' | 'sending' | 'sent' | 'failed'

export interface ReportState {
  phase: ReportPhase
  description: string
  contact: string
  attachLog: boolean
  /** The text shown in the preview box, once `previewing` has loaded it. */
  previewText: string | null
  previewLoading: boolean
  /** The reason the last send (or the preview it needed) failed. */
  sendError: Msg | null
  number: string | null
}

/** What the sheet knows about the player and the app that the form fields do not carry. */
export interface ReportContext {
  account: SteamAccount | null
  langChoice: string
  lang: Lang
  gameFound: boolean
}

/** The subset of the installer bridge this controller needs. */
export interface ReportBridge {
  reportPreview(input: ReportInput): Promise<ReportPreview>
  reportSend(sha256: string): Promise<{ number: string }>
}

function buildInput(state: ReportState, ctx: ReportContext): ReportInput {
  const description = state.description.trim()
  const contact = state.contact.trim()
  return {
    description: description === '' ? null : description,
    contact: contact === '' ? null : contact,
    attachLog: state.attachLog,
    account: ctx.account,
    langChoice: ctx.langChoice,
    lang: ctx.lang,
    gameFound: ctx.gameFound,
  }
}

/**
 * Owns the report sheet's form and its trip through preview and send. Never holds a finished
 * string, only keys and `Msg` values (`errorMsg`), so a language switch re-renders correctly.
 *
 * Lives for the whole App session (one instance, created once by `Workspace`), not per mount of
 * the sheet: the workspace's own rule is that a draft survives closing ("every page stays
 * mounted so drafts and pending choices survive switching"), and the same holds here — closing
 * the sheet (`closeSheet`) keeps `description`/`contact`/`attachLog`, and only 完成 after a
 * successful send (`finishSent`) actually clears them.
 *
 * The native layer keeps exactly one built report per session: `reportPreview` returns its text
 * and SHA-256, and `reportSend(sha256)` transmits those exact bytes, refusing a hash that no
 * longer matches with `PLAN_STALE`. This controller mirrors that ownership with two guards, not
 * one:
 *
 * 1. **What to reuse** — `kept.key` is the JSON of the exact input a built preview came from.
 *    An edit is never reused: it produces a different key, so `ensurePreview` naturally rebuilds
 *    without needing a separate "invalidate the cache" step (a mutation test proved an explicit
 *    `kept = null` on every keystroke was dead weight next to this comparison alone).
 * 2. **Whether a resolving request is still allowed to write `kept`** — `generation`, bumped
 *    every time a `send()` starts. This is the guard the content-key check *cannot* provide,
 *    because a retry after a failed send often has THE SAME key (nothing was edited): without
 *    it, a preview request that was still in flight when Send was clicked could resolve late,
 *    after the send it was never used for has already failed, and quietly repopulate `kept` —
 *    so a Retry that touched nothing would reuse a hash the native layer has already moved past
 *    (`PLAN_STALE`). A request whose `generation` no longer matches the current one only returns
 *    its result to its own caller; it never writes the shared cache.
 *
 * `ensurePreview` also de-duplicates: a second caller (Send, while Preview is still loading) for
 * the SAME input awaits the one request already in flight rather than starting a redundant
 * `reportPreview` call.
 */
export function createReportController(bridge: ReportBridge) {
  let state: ReportState = {
    phase: 'form', description: '', contact: '', attachLog: true,
    previewText: null, previewLoading: false, sendError: null, number: null,
  }
  let kept: { key: string; preview: ReportPreview } | null = null
  let inFlight: { key: string; generation: number; promise: Promise<ReportPreview> } | null = null
  let generation = 0
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ReportState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }

  /**
   * The preview for the current input: the kept one if its key still matches, the one already
   * in flight for that same key if there is one, or a fresh `reportPreview` call. A request's
   * resolution is only ever allowed to populate `kept` if `generation` has not moved since it
   * started — see the class doc for why this, and not the key comparison, is what closes B1.
   */
  async function ensurePreview(ctx: ReportContext): Promise<ReportPreview> {
    const input = buildInput(state, ctx)
    const key = JSON.stringify(input)
    if (kept && kept.key === key) return kept.preview
    if (inFlight && inFlight.key === key) return inFlight.promise
    const myGeneration = generation
    const promise = bridge.reportPreview(input).then(preview => {
      if (myGeneration === generation) kept = { key, preview }
      return preview
    })
    inFlight = { key, generation: myGeneration, promise }
    try { return await promise }
    finally { if (inFlight && inFlight.promise === promise) inFlight = null }
  }

  /** Discards a kept preview and bumps `generation`, so a request already in flight for it can
   * resolve without resurrecting a preview the player is no longer looking at. */
  function forgetPreview() { kept = null; generation += 1 }

  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },

    setDescription(value: string): void {
      if (state.phase === 'sending') return
      const next = value.length > DESCRIPTION_MAX ? clip(value, DESCRIPTION_MAX) : value
      publish({ description: next, phase: state.phase === 'previewing' ? 'form' : state.phase, previewText: null, sendError: null })
    },
    setContact(value: string): void {
      if (state.phase === 'sending') return
      const next = value.length > CONTACT_MAX ? clip(value, CONTACT_MAX) : value
      publish({ contact: next, phase: state.phase === 'previewing' ? 'form' : state.phase, previewText: null, sendError: null })
    },
    setAttachLog(value: boolean): void {
      if (state.phase === 'sending') return
      publish({ attachLog: value, phase: state.phase === 'previewing' ? 'form' : state.phase, previewText: null, sendError: null })
    },

    /** 「查看将要发送的内容」: expands the box, building a preview only if none is still valid. */
    async togglePreview(ctx: ReportContext): Promise<void> {
      if (state.phase === 'previewing') { publish({ phase: 'form' }); return }
      if (state.phase !== 'form') return
      publish({ phase: 'previewing', previewLoading: true, previewText: null, sendError: null })
      try {
        const preview = await ensurePreview(ctx)
        publish({ previewLoading: false, previewText: preview.text })
      } catch (error) {
        publish({ phase: 'form', previewLoading: false, sendError: errorMsg(error, { key: 'report.failed.generic' }) })
      }
    },

    /**
     * Send. Bumps `generation` first — a preview already in flight (from Preview, or from an
     * earlier Send that this call is superseding) may still finish and be USED for this attempt
     * via `ensurePreview`'s de-dupe, but may no longer write `kept`, so it can never be replayed
     * by a later, untouched Retry. Then obtains a valid preview for the CURRENT input (reusing
     * one in flight rather than starting a second `reportPreview` call) and sends its hash.
     */
    async send(ctx: ReportContext): Promise<void> {
      if (state.phase === 'sending') return
      generation += 1
      publish({ phase: 'sending', sendError: null })
      try {
        const preview = await ensurePreview(ctx)
        const result = await bridge.reportSend(preview.sha256)
        kept = null
        publish({ phase: 'sent', number: result.number })
      } catch (error) {
        kept = null
        publish({ phase: 'failed', sendError: errorMsg(error, { key: 'report.failed.generic' }) })
      }
    },

    /** 「重试」: back to the form with everything the player typed intact. Never resent automatically. */
    retry(): void {
      if (state.phase !== 'failed') return
      publish({ phase: 'form', sendError: null })
    },

    /**
     * The sheet closed without sending (Cancel, Esc, or the equivalent) — ruling: a draft
     * survives closing, so `description`/`contact`/`attachLog` are untouched. Everything else
     * about the *display* resets to `form`: reopening never shows a stale `sent`/`failed`
     * screen, and a kept preview does not survive a close (`forgetPreview`) — reopening rebuilds
     * it on demand rather than risking a hash built from a session the player has left.
     */
    closeSheet(): void {
      if (state.phase === 'sending') return
      // Once a report has gone out its text is no longer a draft. Keeping it because the player
      // pressed Esc rather than 完成 would put an already-sent report back in front of them, one
      // click from a duplicate — so every way of leaving the sent screen clears it.
      if (state.phase === 'sent') { this.finishSent(); return }
      forgetPreview()
      publish({ phase: 'form', previewText: null, previewLoading: false, sendError: null })
    },

    /** 完成 after a successful send: the report already went out, so this clears the draft too. */
    finishSent(): void {
      forgetPreview()
      publish({
        phase: 'form', description: '', contact: '', attachLog: true,
        previewText: null, previewLoading: false, sendError: null, number: null,
      })
    },
  }
}

export type ReportController = ReturnType<typeof createReportController>
