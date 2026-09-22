export interface RateLimit { limit(options: { key: string }): Promise<{ success: boolean }> }
// 'attachment' only: the real EmailAttachment (worker-configuration.d.ts) requires a contentId when
// disposition is 'inline', which this Worker never sends, and the wider union made MailMessage
// unassignable to the platform's real EmailMessageBuilder.
export interface MailAttachment { filename: string; type: string; disposition: 'attachment'; content: string }
export interface MailMessage {
  to: string; from: { email: string; name: string }; subject: string; text: string
  replyTo?: string; attachments?: MailAttachment[]
}
export interface AppEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  DB: D1Database
  // The generated Cloudflare type for a `send_email` binding (worker-configuration.d.ts): checks
  // buildMail's output against the platform's real EmailMessageBuilder, not a hand-written stand-in.
  MAIL: SendEmail
  REPORT_LIMIT: RateLimit
  STEAM_LIMIT: RateLimit
  /** The owner's mailbox. A secret: `wrangler secret put REPORT_TO`. Never in git. */
  REPORT_TO: string
}
/** The rate-limit key. Used for nothing else and written nowhere (spec §5.4). */
export const clientKey = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown'
