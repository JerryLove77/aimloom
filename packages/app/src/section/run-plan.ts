/** The two calls that carry out a reviewed plan. Every section bridge has them. */
export interface PlanRunner {
  execute(input: { operationId: string; planId: string; confirmation: 'install'; allowConflicts: boolean }): Promise<unknown>
  job(operationId: string): Promise<{ state: string; result?: { status: string } | null; error?: { code: string; message: string; messageEn?: string } | null }>
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

/** Executes a plan as an install, never with conflict permission, and waits for its job to end. */
export async function runPlan(bridge: PlanRunner, operationId: string, planId: string): Promise<PlanOutcome> {
  await bridge.execute({ operationId, planId, confirmation: 'install', allowConflicts: false })
  let job = await bridge.job(operationId)
  for (let attempt = 0; !TERMINAL.includes(job.state) && attempt < 240; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    job = await bridge.job(operationId)
  }
  if (job.state === 'failed') return { kind: 'failed', error: job.error }
  if (job.state !== 'finished') return { kind: 'unknown' }
  const status = job.result?.status
  if (status === 'completed') return { kind: 'completed' }
  if (status === 'no-change') return { kind: 'no-change' }
  return { kind: 'incomplete', status }
}
