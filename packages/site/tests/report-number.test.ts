import { describe, expect, it } from 'vitest'
import { reportNumber } from '../src/worker/report-number'

describe('reportNumber', () => {
  it('is AL-YYMMDD-XXXX from the UTC date and four Crockford base-32 characters', () => {
    const n = reportNumber(new Date('2026-09-21T23:59:59Z'), () => new Uint8Array([0, 31, 32, 255]))
    expect(n).toBe('AL-260921-0Z0Z')
  })
  it('uses UTC, not the local day', () => {
    expect(reportNumber(new Date('2026-09-22T00:00:01+08:00'), () => new Uint8Array(4))).toBe('AL-260921-0000')
  })
  it('never uses I, L, O or U', () => {
    const all = new Set<string>(); for (let b = 0; b < 256; b++) all.add(reportNumber(new Date(0), () => new Uint8Array([b, b, b, b])).slice(-1))
    expect([...all].join('')).not.toMatch(/[ILOU]/); expect(all.size).toBe(32)
  })
})
