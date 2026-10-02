import { describe, expect, it } from 'vitest'
import { parseReviewCursors, reviewSearch } from '../src/lib/review-pagination'

describe('review positions', () => {
  it('round-trips independent positions and omits unrelated redirect parameters', () => {
    const positions = { pending: { at: '', slug: 'old-item' }, live: { at: '2026-10-01T12:00:00.000Z', slug: 'new-item' } }
    const params = new URLSearchParams(reviewSearch(positions)); params.set('next','https://example.com/')
    expect(parseReviewCursors(params)).toEqual(positions)
    expect(reviewSearch(parseReviewCursors(params))).not.toContain('example.com')
    expect(parseReviewCursors(new URLSearchParams(reviewSearch({ ...positions, pending: null })))).toEqual({ ...positions, pending: null })
  })
  it.each(['not-json', '{}', '[null,"valid"]', '[1,"valid"]', '["x","../bad"]', '["x","<script>"]', '["x","valid",1]', 'x'.repeat(161)])('resets an invalid position without affecting the other list: %s', value => {
    const params = new URLSearchParams({ pending_after: value, live_after: '["2026-10-01T12:00:00Z","sample"]' })
    expect(parseReviewCursors(params)).toEqual({ pending:null,live:{at:'2026-10-01T12:00:00Z',slug:'sample'} })
  })
})
