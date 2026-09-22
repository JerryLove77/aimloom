import { recommendedRelease, releases } from '../data/releases'

/** Read by the App's launch check (v0.1.3). A static file: no script runs, nothing about the reader is sent. */
export function GET(): Response {
  const release = recommendedRelease(releases)
  return new Response(JSON.stringify({ version: release !== null && release.status !== 'preparing' ? release.version : null }), { headers: { 'content-type': 'application/json' } })
}
