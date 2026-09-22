import type { AppEnv, MailMessage } from './env'
import type { Report } from './report-schema'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
// The `\s+` -> ' ' collapse is not just cosmetic truncation: it is what keeps a CR or LF out of the
// mail subject, so an attacker-chosen description can never inject a header. Do not simplify it away.
const head = (s: string, max: number) => { const chars = [...s.replace(/\s+/g, ' ').trim()]; return chars.length <= max ? chars.join('') : chars.slice(0, max).join('') + '…' }
// A blank (whitespace-only, schema-legal) description must read as "none", not as an empty line
// and a subject ending in a bare "· ".
const NO_DESCRIPTION = '(no description)'
const nonBlank = (description: string | null): string | null => (description?.trim() ? description : null)

export function buildMail(number: string, report: Report, to: string): MailMessage {
  const who = report.account ? `${report.account.name} (${report.account.steamId}, unverified)` : 'none'
  const description = nonBlank(report.description)
  const text = [
    `Report ${number}`,
    `App: ${report.app.label} · commit ${report.app.commit} · built ${report.app.built}`,
    `Windows ${report.system.windows} · display language ${report.system.displayLanguage} · App language ${report.system.lang} (choice: ${report.system.langChoice})`,
    `PowerShell: ${report.system.powershell ?? 'not found'} · game found: ${report.game.found ? 'yes' : 'no'}`,
    `Steam: ${who}`,
    `Contact: ${report.contact ?? 'none'}`,
    '',
    description ?? NO_DESCRIPTION,
    '',
    `Full report: npm run report -w @kvk/site -- ${number}`,
  ].join('\n')
  const message: MailMessage = {
    to, from: { email: 'reports@aimloom.dev', name: 'Aimloom reports' },
    subject: `[Aimloom] ${number} · ${report.app.label} · ${report.system.lang} · ${description ? head(description, 60) : NO_DESCRIPTION}`,
    text,
  }
  if (report.contact !== null && EMAIL.test(report.contact)) message.replyTo = report.contact
  if (report.log !== null) message.attachments = [{ filename: `${number}.log.txt`, type: 'text/plain; charset=utf-8', disposition: 'attachment', content: report.log }]
  return message
}

/** Best effort (spec §5.2 step 6): the outcome is written to the index row and nothing is thrown. */
export async function notify(number: string, report: Report, env: AppEnv): Promise<void> {
  let state = 'sent'
  try {
    if (!env.REPORT_TO) state = 'failed:NO_MAILBOX'
    else await env.MAIL.send(buildMail(number, report, env.REPORT_TO))
  } catch (error) {
    state = `failed:${/E_[A-Z_]+/.exec(String(error))?.[0] ?? 'UNKNOWN'}`
  }
  try { await env.DB.prepare('UPDATE reports SET mail = ? WHERE number = ?').bind(state, number).run() } catch { /* the report itself is safe */ }
}
