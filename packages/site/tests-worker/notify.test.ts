import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import fixture from './fixtures/report.valid.json'
import { buildMail, notify } from '../src/worker/notify'
import type { AppEnv, MailMessage } from '../src/worker/env'
import type { Report } from '../src/worker/report-schema'

const report = fixture as Report
const base = testEnv as unknown as Pick<AppEnv, 'DB'>
const row = (n: string) => base.DB.prepare("INSERT INTO reports (number, created_at, day, app_label, lang, windows, has_log, has_contact, bytes, body) VALUES (?, 't', 'd', '0.1.3', 'zh', 'w', 1, 1, 1, '{}')").bind(n).run()
const mailState = (n: string) => base.DB.prepare('SELECT mail FROM reports WHERE number = ?').bind(n).first<string>('mail')

describe('buildMail', () => {
  it('says what and who in the subject, and attaches the log as readable text', () => {
    const m = buildMail('AL-260921-1234', report, 'owner@test.invalid')
    expect(m.subject).toBe('[Aimloom] AL-260921-1234 · 0.1.3 · zh · 应用背景时报错')
    expect(m.from).toEqual({ email: 'reports@aimloom.dev', name: 'Aimloom reports' }); expect(m.to).toBe('owner@test.invalid')
    expect(m.text).toContain('Steam: PlayerOne (76561198000000042, unverified)'); expect(m.text).toContain('Contact: someone@example.com'); expect(m.text).toContain('Windows 10.0.22631')
    expect(m.attachments).toEqual([{ filename: 'AL-260921-1234.log.txt', type: 'text/plain; charset=utf-8', disposition: 'attachment', content: report.log }])
  })
  it('lets the owner just hit Reply when the contact is an email address, and only then', () => {
    expect(buildMail('n', report, 'o@t.invalid').replyTo).toBe('someone@example.com')
    expect(buildMail('n', { ...report, contact: 'discord: aimer#1' }, 'o@t.invalid').replyTo).toBeUndefined()
    expect(buildMail('n', { ...report, contact: null }, 'o@t.invalid').replyTo).toBeUndefined()
  })
  it('copes with an anonymous report without a description or a log', () => {
    const m = buildMail('AL-1', { ...report, account: null, description: null, log: null }, 'o@t.invalid')
    expect(m.subject).toBe('[Aimloom] AL-1 · 0.1.3 · zh · (no description)'); expect(m.text).toContain('Steam: none'); expect(m.attachments).toBeUndefined()
  })
  it('cuts a long description in the subject and keeps it whole in the body', () => {
    const long = '很长的描述'.repeat(40); const m = buildMail('n', { ...report, description: long }, 'o@t.invalid')
    expect([...m.subject.split(' · ')[3]!].length).toBeLessThanOrEqual(61); expect(m.text).toContain(long)
  })
  it('treats a whitespace-only description (schema-legal) as none: no bare "· " subject, no blank body line', () => {
    const m = buildMail('AL-2', { ...report, description: '   \n\t  ' }, 'o@t.invalid')
    expect(m.subject).toBe('[Aimloom] AL-2 · 0.1.3 · zh · (no description)')
    expect(m.subject.endsWith('· ')).toBe(false)
    expect(m.text).toContain('\n(no description)\n')
  })
})

describe('notify', () => {
  it('records sent', async () => {
    await row('AL-S'); const sent: MailMessage[] = []
    await notify('AL-S', report, { ...base, MAIL: { send: async m => { sent.push(m); return { messageId: 'x' } } }, REPORT_TO: 'owner@test.invalid' } as unknown as AppEnv)
    expect(sent).toHaveLength(1); expect(await mailState('AL-S')).toBe('sent')
  })
  it('records a failure and never throws: a report is not lost because mail is down', async () => {
    await row('AL-F')
    await expect(notify('AL-F', report, { ...base, MAIL: { send: async () => { throw new Error('E_DAILY_LIMIT_EXCEEDED: nope') } }, REPORT_TO: 'o@t.invalid' } as unknown as AppEnv)).resolves.toBeUndefined()
    expect(await mailState('AL-F')).toBe('failed:E_DAILY_LIMIT_EXCEEDED')
  })
  it('records that no mailbox is configured', async () => {
    await row('AL-N'); await notify('AL-N', report, { ...base, MAIL: { send: async () => ({ messageId: 'x' }) }, REPORT_TO: '' } as unknown as AppEnv)
    expect(await mailState('AL-N')).toBe('failed:NO_MAILBOX')
  })
})
