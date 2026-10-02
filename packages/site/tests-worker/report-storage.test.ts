import { applyD1Migrations } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { db, emptyDatabase, test } from './seed'
import { deleteExpired, handleReport } from '../src/worker/reports'
import fixture from './fixtures/report.valid.json'
import type { AppEnv } from '../src/worker/env'

const env = { DB: db } as AppEnv
const seed = (number: string, bytes = 10, day = '2026-10-01') => db.prepare(`INSERT INTO reports
  (number,created_at,day,app_label,lang,windows,has_log,has_contact,bytes,body)
  VALUES (?, ?, ?, 'test','en','w',0,0,?,'{}')`).bind(number, `${day}T00:00:00.000Z`, day, bytes)
const stored = () => db.prepare('SELECT bytes FROM report_storage WHERE id=1').first<number>('bytes')
const sum = () => db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM reports').first<number>('bytes')
const send = () => handleReport(new Request('https://aimloom.dev/api/reports', {
  method:'POST', headers:{'content-type':'application/json','user-agent':'Aimloom/0.1.3'}, body:JSON.stringify(fixture),
}), env, {waitUntil(){}}, {now:()=>new Date('2026-10-01T12:00:00Z'),random:()=>new Uint8Array([1,2,3,4])})

describe('report storage counter', () => {
  it('initializes an existing archive and tracks inserts, ignored collisions, updates and deletes', async () => {
    await emptyDatabase(db)
    await applyD1Migrations(db, test.TEST_MIGRATIONS.slice(0,8))
    await seed('AL-261001-TST1',10).run(); await seed('AL-261001-TST2',20).run()
    await applyD1Migrations(db, test.TEST_MIGRATIONS)
    expect(await stored()).toBe(30)
    await seed('AL-261001-TST3',40).run()
    await db.prepare("INSERT INTO reports SELECT * FROM reports WHERE number='AL-261001-TST3' ON CONFLICT(number) DO NOTHING").run()
    expect(await stored()).toBe(70)
    await db.prepare("UPDATE reports SET bytes=25 WHERE number='AL-261001-TST2'").run()
    expect(await stored()).toBe(75)
    await db.prepare("DELETE FROM reports WHERE number='AL-261001-TST1'").run()
    expect(await stored()).toBe(65); expect(await stored()).toBe(await sum())
  })
  it('rolls back accounting with a failed batch', async () => {
    await seed('AL-261001-TST1').run()
    await expect(db.batch([seed('AL-261001-TST2',20), seed('AL-261001-TST1',30)])).rejects.toThrow()
    expect(await stored()).toBe(10); expect(await stored()).toBe(await sum())
  })
  it('retention returns report rows removed, not trigger updates, and frees capacity', async () => {
    await seed('AL-260101-TST1',400*1024*1024,'2026-01-01').run()
    await seed('AL-261001-TST1',10).run()
    expect(await deleteExpired(env,new Date('2026-10-01T12:00:00Z'))).toBe(1)
    expect(await stored()).toBe(10)
    expect((await send()).status).toBe(200)
    expect(await stored()).toBe(await sum())
  })
  it('fails closed if the counter row is missing', async () => {
    await db.prepare('DELETE FROM report_storage').run()
    const r = await send()
    expect(r.status).toBe(507); expect(await r.json()).toEqual({code:'STORAGE_FULL'})
    expect(await sum()).toBe(0)
  })
  it('can run before the counter migration, so Worker deployment can precede it', async () => {
    await emptyDatabase(db); await applyD1Migrations(db,test.TEST_MIGRATIONS.slice(0,8))
    await seed('AL-260101-TST1',10,'2026-01-01').run()
    expect(await deleteExpired(env,new Date('2026-10-01T12:00:00Z'))).toBe(1)
    expect((await send()).status).toBe(200)
    expect(await sum()).toBeGreaterThan(0)
  })
})
