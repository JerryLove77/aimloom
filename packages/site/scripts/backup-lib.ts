/** What `site:backup` fetches, pure so it can be tested: every file the database points at. */
export interface ItemRow { kind: string; status: string; file_key: string; sha256: string }
export interface Fetch { bucket: 'aimloom-files' | 'aimloom-uploads'; key: string }

/**
 * A pending upload lives in the private bucket under `pending/…`; everything else — live, hidden,
 * or withdrawn after going live — is in the public bucket under `files/…`, and a theme there also
 * has its two previews. Rejected and withdrawn pending files were deleted and are skipped.
 */
export function backupPlan(rows: ItemRow[]): Fetch[] {
  const out = new Map<string, Fetch>()
  for (const r of rows) {
    if (r.file_key.startsWith('pending/')) {
      if (r.status === 'pending') out.set(`u:${r.file_key}`, { bucket: 'aimloom-uploads', key: r.file_key })
      continue
    }
    out.set(`f:${r.file_key}`, { bucket: 'aimloom-files', key: r.file_key })
    if (r.kind === 'theme') for (const lang of ['zh', 'en']) out.set(`f:p:${r.sha256}:${lang}`, { bucket: 'aimloom-files', key: `previews/${r.sha256}/${lang}.svg` })
  }
  return [...out.values()]
}
