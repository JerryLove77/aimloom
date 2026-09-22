const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base 32: no I, L, O, U

/** `AL-YYMMDD-XXXX`. The date is UTC; the suffix is random, so a number tells nobody how many reports a day holds. */
export function reportNumber(now: Date, random: (n: number) => Uint8Array): string {
  const iso = now.toISOString() // always UTC
  const day = iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10)
  const suffix = [...random(4)].map(b => ALPHABET[b % 32]).join('')
  return `AL-${day}-${suffix}`
}
