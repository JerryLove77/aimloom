/** The explorer's catalogue shapes, shared by the Worker and the page renderer (no runtime bindings here). */
/** The explorer's own sub-paths under /explore/, so never an item's slug. */
export const RESERVED_SLUGS = ['item-shell', 'upload', 'mine', 'review'] as const
export const RESERVED_SLUG = RESERVED_SLUGS[0]
export const KINDS = ['theme', 'sound', 'crosshair'] as const
export type Kind = typeof KINDS[number]
export const SORTS = ['new', 'popular'] as const
export type Sort = typeof SORTS[number]
export const PAGE_SIZE = 24
/** "Most downloaded, 30 days" appears only once the counter has this many days behind it. */
export const TRENDING_DAYS = 30
export const MAX_QUERY = 64

export interface Item {
  slug: string; kind: Kind; status: ItemStatus; title_zh: string; title_en: string; summary_zh: string; summary_en: string
  author: string; author_url: string | null; licence: string; file_name: string; file_key: string
  bytes: number; sha256: string; code: string | null; featured: number | null; published_at: string
  source: 'maintainer' | 'upload'; uploader: string | null; uploaded_at: string | null; reject_reason: string | null
}
export type ItemStatus = 'published' | 'hidden' | 'pending' | 'rejected' | 'withdrawn'
export interface ListQuery { kind: Kind; q: string; sort: Sort; page: number }
export interface ListResult { items: Item[]; total: number; page: number; pages: number; popularAvailable: boolean }

