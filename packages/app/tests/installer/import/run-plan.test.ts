import { describe, expect, it, vi } from 'vitest'
import { runPlan } from '../../../src/workspace/run-plan'

const bridge = (jobs: { state: string; result?: { status: string } | null; error?: { code: string; message: string } | null }[]) => {
  const executed: unknown[] = []
  let index = 0
  return { executed, execute: async (input: unknown) => { executed.push(input); return { operationId: 'op' } }, job: async () => jobs[Math.min(index++, jobs.length - 1)]! }
}

describe('runPlan', () => {
  it('executes as an install without conflict permission and reports completion', async () => {
    const b = bridge([{ state: 'finished', result: { status: 'completed' } }])
    expect(await runPlan(b, 'op-1', 'plan-1')).toEqual({ kind: 'completed' })
    expect(b.executed).toEqual([{ operationId: 'op-1', planId: 'plan-1', confirmation: 'install', allowConflicts: false }])
  })

  it('polls until the job is terminal', async () => {
    vi.useFakeTimers()
    const b = bridge([{ state: 'running' }, { state: 'running' }, { state: 'finished', result: { status: 'no-change' } }])
    const outcome = runPlan(b, 'op', 'plan')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await outcome).toEqual({ kind: 'no-change' })
    vi.useRealTimers()
  })

  it('never reports an unknown or failed job as success', async () => {
    expect(await runPlan(bridge([{ state: 'unknown' }]), 'op', 'plan')).toEqual({ kind: 'unknown' })
    const error = { code: 'PLAN_STALE', message: 'changed' }
    expect(await runPlan(bridge([{ state: 'failed', error }]), 'op', 'plan')).toEqual({ kind: 'failed', error })
    expect(await runPlan(bridge([{ state: 'finished', result: { status: 'recovery-required' } }]), 'op', 'plan')).toEqual({ kind: 'incomplete', status: 'recovery-required' })
  })
})
