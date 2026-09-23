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
  /** Where the explorer's files are served from: the R2 bucket's custom domain (spec 2026-09-22 §4). */
  FILES_ORIGIN: string
  /** The public bucket behind FILES_ORIGIN: the Worker writes a trusted creator's or an approved upload there. */
  FILES: R2Bucket
  /** The private bucket for uploads awaiting review. No domain, no r2.dev; only the review page reads it. */
  UPLOADS: R2Bucket
  /** Comma-separated SteamID64s allowed on the review page. A secret: `wrangler secret put ADMIN_STEAM_IDS`. Never in git. */
  ADMIN_STEAM_IDS?: string
  /** The owner's mailbox. A secret: `wrangler secret put REPORT_TO`. Never in git. */
  REPORT_TO: string
}
/** The rate-limit key. Used for nothing else and written nowhere (spec §5.4). */
export const clientKey = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown'
