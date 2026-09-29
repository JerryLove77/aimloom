import { applyD1Migrations } from 'cloudflare:test'
import { beforeEach } from 'vitest'
import { emptyBucket, emptyDatabase, test } from './seed'

// Every test starts from empty buckets and an empty database brought up by the real migrations,
// in order, as production was.
beforeEach(async () => {
  await Promise.all([emptyBucket(test.FILES), emptyBucket(test.UPLOADS)])
  await emptyDatabase(test.DB)
  await applyD1Migrations(test.DB, test.TEST_MIGRATIONS)
})
