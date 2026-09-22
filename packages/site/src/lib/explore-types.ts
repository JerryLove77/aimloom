/** The explorer's catalogue shapes, shared by the Worker and the page renderer (no runtime bindings here). */
/** The detail page shell's own path segment, so never an item's slug. */
export const RESERVED_SLUG = 'item-shell'
export const KINDS = ['theme', 'sound', 'crosshair'] as const
export type Kind = typeof KINDS[number]
export const SORTS = ['new', 'popular'] as const
export type Sort = typeof SORTS[number]
export const PAGE_SIZE = 24
/** "Most downloaded, 30 days" appears only once the counter has this many days behind it. */
export const TRENDING_DAYS = 30
export const MAX_QUERY = 64

export interface Item {
  slug: string; kind: Kind; title_zh: string; title_en: string; summary_zh: string; summary_en: string
  author: string; author_url: string | null; licence: string; file_name: string; file_key: string
  bytes: number; sha256: string; code: string | null; featured: number | null; published_at: string
}
export interface ListQuery { kind: Kind; q: string; sort: Sort; page: number }
export interface ListResult { items: Item[]; total: number; page: number; pages: number; popularAvailable: boolean }

