/** Independent keyset positions for the two admin lists. No arbitrary return URL is accepted. */
export const REVIEW_PAGE_SIZE = 24
export interface ReviewCursor { at: string; slug: string }
export interface ReviewPage<T> { items: T[]; next: ReviewCursor | null }
export interface ReviewCursors { pending: ReviewCursor | null; live: ReviewCursor | null }

function cursor(value: string | null): ReviewCursor | null {
  if (!value || value.length > 160) return null
  try {
    const row: unknown = JSON.parse(value)
    if (!Array.isArray(row) || row.length !== 2) return null
    const [at, slug] = row
    if (typeof at !== 'string' || at.length > 40 || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) return null
    return { at, slug }
  } catch { return null }
}

export function parseReviewCursors(params: URLSearchParams): ReviewCursors {
  return { pending: cursor(params.get('pending_after')), live: cursor(params.get('live_after')) }
}

export function reviewSearch(cursors: ReviewCursors): string {
  const params = new URLSearchParams()
  for (const kind of ['pending', 'live'] as const) {
    const value = cursors[kind]
    if (value) params.set(`${kind}_after`, JSON.stringify([value.at, value.slug]))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
