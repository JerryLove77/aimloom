import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain .mjs script
import { bodyFrom, commandFor } from '../scripts/report.mjs'

describe('the owner\'s report tool', () => {
  it('reads one report\'s body from the database', () => {
    expect(commandFor(['AL-260921-7K3F'])).toEqual({ file: 'npx', one: true, args: ['wrangler', '--config', '.wrangler.generated.jsonc', 'd1', 'execute', 'aimloom', '--remote', '--json', '--command', "SELECT body FROM reports WHERE number = 'AL-260921-7K3F'"] })
    expect(commandFor(['AL-260921-7K3F', '--preview']).args).toEqual(['wrangler', '--config', '.wrangler.generated.jsonc', 'd1', 'execute', 'aimloom-preview', '--env', 'preview', '--remote', '--json', '--command', "SELECT body FROM reports WHERE number = 'AL-260921-7K3F'"])
  })
  it('lists the latest rows and never their bodies', () => {
    const c = commandFor(['--list'])
    expect(c.one).toBe(false)
    expect(c.args.at(-1)).toBe('SELECT number, created_at, app_label, lang, has_log, has_contact, steam_id, bytes, mail FROM reports ORDER BY created_at DESC LIMIT 20')
    expect(commandFor(['--list', '--preview']).args.slice(0, 8)).toEqual(['wrangler', '--config', '.wrangler.generated.jsonc', 'd1', 'execute', 'aimloom-preview', '--env', 'preview'])
  })
  it('refuses anything that is not a report number: the argument reaches SQL and a command line', () => {
    for (const bad of ['', 'AL-1', '../x', "AL-260921-7K3F' OR '1'='1", 'AL-260921-7K3F; rm -rf /', 'AL-260921-ILOU']) expect(() => commandFor([bad]), bad).toThrow(/report number/)
  })
  it('pulls the body out of wrangler\'s JSON and prints it readable', () => {
    expect(bodyFrom('[{"results":[{"body":"{\\"number\\":\\"AL-1\\",\\"log\\":\\"中文\\"}"}],"success":true}]')).toBe('{\n  "number": "AL-1",\n  "log": "中文"\n}')
    expect(bodyFrom('[{"results":[],"success":true}]')).toBeNull()
  })
})
