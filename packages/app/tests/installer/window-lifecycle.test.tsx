import { describe, it, expect } from 'vitest';
import { canLeaveOperation } from '../../src/installer/window-lifecycle';
import type { Job } from '../../src/installer/contracts';
describe('window lifecycle', () => {
    for (const state of ['running', 'unknown', 'finished', 'failed', 'reconciled'] as const)
        it(`handles ${state}`, () => { const job: Job = { operationId: 'op', planId: 'p', state, progress: null, result: null, error: null }; expect(canLeaveOperation(job)).toBe(!['running', 'unknown'].includes(state)); });
    it('allows no operation', () => expect(canLeaveOperation(null)).toBe(true));
});
