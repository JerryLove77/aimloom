import { describe, expect, it } from 'vitest'
import { backupPlan } from '../scripts/backup-lib'

const h = 'a'.repeat(64)
describe('site:backup fetches every file the database points at', () => {
  it('takes live and hidden files from the public bucket, with a theme\'s previews, and pending ones from the private bucket', () => {
    expect(backupPlan([
      { kind: 'theme', status: 'published', file_key: `files/${h}/Night Blue.json`, sha256: h },
      { kind: 'sound', status: 'hidden', file_key: 'files/b/crisp.ogg', sha256: 'b' },
      { kind: 'crosshair', status: 'pending', file_key: 'pending/dot/dot.png', sha256: 'c' },
    ])).toEqual([
      { bucket: 'aimloom-files', key: `files/${h}/Night Blue.json` },
      { bucket: 'aimloom-files', key: `previews/${h}/zh.svg` },
      { bucket: 'aimloom-files', key: `previews/${h}/en.svg` },
      { bucket: 'aimloom-files', key: 'files/b/crisp.ogg' },
      { bucket: 'aimloom-uploads', key: 'pending/dot/dot.png' },
    ])
  })
  it('skips pending files that were rejected or withdrawn (they were deleted), and fetches a shared file once', () => {
    expect(backupPlan([
      { kind: 'sound', status: 'rejected', file_key: 'pending/x/x.wav', sha256: 'x' },
      { kind: 'sound', status: 'withdrawn', file_key: 'pending/y/y.wav', sha256: 'y' },
      { kind: 'sound', status: 'published', file_key: 'files/z/z.wav', sha256: 'z' },
      { kind: 'sound', status: 'withdrawn', file_key: 'files/z/z.wav', sha256: 'z' },
    ])).toEqual([{ bucket: 'aimloom-files', key: 'files/z/z.wav' }])
  })
})
