import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlan, waitForJob } from '../../../src/section/run-plan'

const bridge = (jobs: { state: string; result?: { status: string } | null; error?: { code: string; message: string } | null }[]) => {
  const executed: unknown[] = []
  let index = 0
  return { executed, execute: async (input: unknown) => { executed.push(input); return { operationId: 'op' } }, job: async () => jobs[Math.min(index++, jobs.length - 1)]! }
}

describe('runPlan', () => {
  afterEach(() => vi.useRealTimers())

  it('recovers from a failed status query without executing the write again', async () => {
    vi.useFakeTimers()
    const b = bridge([{ state: 'finished', result: { status: 'completed' } }])
    let polls = 0
    b.job = async () => {
      if (++polls === 1) throw new Error('temporary IPC failure')
      return { state: 'finished', result: { status: 'completed' } }
    }
    const outcome = runPlan(b, 'op', 'plan')
    await vi.advanceTimersByTimeAsync(250)
    expect(await outcome).toEqual({ kind: 'completed' })
    expect(b.executed).toHaveLength(1)
  })

  it('resets the failure budget after a successful running response', async () => {
    vi.useFakeTimers()
    let polls = 0
    const b = {
      execute: async () => ({}),
      job: async () => {
        polls++
        if ([1, 2, 4, 5].includes(polls)) throw new Error('temporary IPC failure')
        return polls === 3 ? { state: 'running' } : { state: 'finished', result: { status: 'completed' } }
      },
    }
    const outcome = runPlan(b, 'op', 'plan')
    await vi.advanceTimersByTimeAsync(1500)
    expect(await outcome).toEqual({ kind: 'completed' })
  })
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

  it('keeps repeated poll failures unknown, but a refused execute still throws', async () => {
    vi.useFakeTimers()
    const polling = { execute: async () => ({}), job: async (): Promise<never> => { throw new Error('ipc down') } }
    const job = waitForJob(polling, 'op', 'plan')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await job).toMatchObject({ state: 'unknown' })
    const outcome = runPlan(polling, 'op', 'plan')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await outcome).toEqual({ kind: 'unknown' })
    const refused = { execute: async (): Promise<never> => { throw new Error('refused') }, job: async () => ({ state: 'running' }) }
    await expect(waitForJob(refused, 'op', 'plan')).rejects.toThrow('refused')
  })
})
