import { t, type MessageKey, type Msg } from '../i18n'

/** A job as every section bridge reports it. */
export interface PlanJob { state: string; result?: { status: string } | null; error?: { code: string; message: string; messageEn?: string } | null }

/** The two calls that carry out a reviewed plan. Every section bridge has them. */
export interface PlanRunner {
  execute(input: { operationId: string; planId: string; confirmation: 'install'; allowConflicts: boolean }): Promise<unknown>
  job(operationId: string): Promise<PlanJob>
}

export type PlanOutcome =
  | { kind: 'completed' }
  | { kind: 'no-change' }
  | { kind: 'failed'; error: { code: string; message: string; messageEn?: string } | null | undefined }
  /** The outcome could not be determined. Never success: the caller locks until reconciliation. */
  | { kind: 'unknown' }
  /** `status` is the engine's own code (e.g. `'recovery-required'`), or absent if the job
   * finished without one; the caller decides how to word an absent status per language. */
  | { kind: 'incomplete'; status: string | undefined }

const TERMINAL = ['finished', 'failed', 'unknown', 'reconciled']
const MAX_CONSECUTIVE_POLL_FAILURES = 3

/**
 * Executes a plan as an install, never with conflict permission, and polls its job (250 ms)
 * until it is terminal. There is no time cap: the worker may still be writing, and giving up
 * while the job is `running` would unlock a page the worker is still changing.
 *
 * A refused `execute` throws, as it proves nothing was written. Once execute was accepted,
 * retry transient query failures without repeating the write. Three consecutive failed
 * queries answer an `unknown` job and keep the caller locked until reconciliation retrieves
 * the native result or checks a genuinely unknown worker outcome.
 */
export async function waitForJob(bridge: PlanRunner, operationId: string, planId: string): Promise<PlanJob> {
  await bridge.execute({ operationId, planId, confirmation: 'install', allowConflicts: false })
  let failures = 0
  while (true) {
    try {
      const job = await bridge.job(operationId)
      if (TERMINAL.includes(job.state)) return job
      failures = 0
    } catch {
      if (++failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return { state: 'unknown', result: null, error: null }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

/** Executes a plan and waits for its job to end. Any final state other than `finished` is unknown. */
export async function runPlan(bridge: PlanRunner, operationId: string, planId: string): Promise<PlanOutcome> {
  const job = await waitForJob(bridge, operationId, planId)
  if (job.state === 'failed') return { kind: 'failed', error: job.error }
  if (job.state !== 'finished') return { kind: 'unknown' }
  const status = job.result?.status
  if (status === 'completed') return { kind: 'completed' }
  if (status === 'no-change') return { kind: 'no-change' }
  return { kind: 'incomplete', status }
}

/** A status code the engine returns, or none. A real code is language-neutral and sits in
 * either dictionary's template as-is; an absent one needs its own translated word, so this
 * builds the final bilingual pair directly instead of leaving `{status}` for later substitution. */
export function incompleteMsg(key: MessageKey, status: string | undefined): Msg {
  if (status !== undefined) return { key, params: { status } }
  return {
    zh: t('zh', key, { status: t('zh', 'common.unknownStatus') }),
    en: t('en', key, { status: t('en', 'common.unknownStatus') }),
  }
}
