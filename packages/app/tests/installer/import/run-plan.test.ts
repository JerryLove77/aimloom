import { describe, expect, it, vi } from 'vitest'
import { runPlan, waitForJob } from '../../../src/section/run-plan'

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

  it('keeps polling past one minute until the job is terminal', async () => {
    vi.useFakeTimers()
    let polls = 0
    const b = { execute: async () => ({}), job: async () => (++polls < 400 ? { state: 'running' } : { state: 'finished', result: { status: 'completed' } }) }
    const outcome = runPlan(b, 'op', 'plan')
    await vi.advanceTimersByTimeAsync(400 * 250)
    expect(await outcome).toEqual({ kind: 'completed' })
    expect(polls).toBe(400)
    vi.useRealTimers()
  })

  it('treats a failed poll after an accepted execute as unknown, but a refused execute still throws', async () => {
    const polling = { execute: async () => ({}), job: async (): Promise<never> => { throw new Error('ipc down') } }
    expect(await waitForJob(polling, 'op', 'plan')).toMatchObject({ state: 'unknown' })
    expect(await runPlan(polling, 'op', 'plan')).toEqual({ kind: 'unknown' })
    const refused = { execute: async (): Promise<never> => { throw new Error('refused') }, job: async () => ({ state: 'running' }) }
    await expect(waitForJob(refused, 'op', 'plan')).rejects.toThrow('refused')
  })
})
