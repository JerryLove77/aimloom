import { betaRelease, isNewer, recommendedRelease, releases } from '../data/releases'

/** Read by the App's launch check. A static file: no script runs, nothing about the reader is sent. */
export function GET(): Response {
  const release = recommendedRelease(releases)
  const version = release !== null && release.status !== 'preparing' ? release.version : null
  const betaEntry = betaRelease(releases)
  // A finished beta (no longer newer than the stable recommendation) disappears on its own.
  const beta = betaEntry !== null && (version === null || isNewer(betaEntry.version, version)) ? betaEntry.version : null
  return new Response(JSON.stringify({ version, beta }), { headers: { 'content-type': 'application/json' } })
}
