import { describe, expect, it } from 'vitest'
import { ACCOUNT_STORAGE_KEY, looksLikeSteamUrl, readAccount, writeAccount } from '../../../src/workspace/account'
import { UPDATES_STORAGE_KEY, readUpdatesEnabled, writeUpdatesEnabled } from '../../../src/workspace/updates'

function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}
const throwing = {
  getItem() { throw new DOMException('blocked') },
  setItem() { throw new DOMException('blocked') },
  removeItem() { throw new DOMException('blocked') },
}
const account = { steamId: '76561198000000000', name: '跟枪练习生' }

describe('the stored Steam account', () => {
  it('round-trips an account, including a non-ASCII display name', () => {
    const s = store()
    writeAccount(s, account)
    expect(readAccount(s)).toEqual(account)
  })

  it('forgets on null, and reads nothing when nothing was stored', () => {
    const s = store()
    expect(readAccount(s)).toBeNull()
    writeAccount(s, account)
    writeAccount(s, null)
    expect(s.map.has(ACCOUNT_STORAGE_KEY)).toBe(false)
    expect(readAccount(s)).toBeNull()
  })

  it.each([
    ['not JSON at all', '{oops'],
    ['a bare string', '"76561198000000000"'],
    ['an array', '[{"steamId":"76561198000000000","name":"x"}]'],
    ['a SteamID that is too short', '{"steamId":"7656119800000","name":"x"}'],
    ['a SteamID that is too long', '{"steamId":"765611980000000000","name":"x"}'],
    ['a SteamID with a letter', '{"steamId":"7656119800000000a","name":"x"}'],
    ['a SteamID not starting with 7', '{"steamId":"16561198000000000","name":"x"}'],
    ['an empty name', '{"steamId":"76561198000000000","name":""}'],
    ['a name with a line break', '{"steamId":"76561198000000000","name":"a\\nb"}'],
    ['an extra field smuggled alongside', '{"steamId":"76561198000000000","name":"x","verified":true}'],
    ['a missing name', '{"steamId":"76561198000000000"}'],
  ])('reads %s as no account', (_why, raw) => {
    expect(readAccount(store({ [ACCOUNT_STORAGE_KEY]: raw }))).toBeNull()
  })

  it('refuses to store an account it would refuse to read back', () => {
    const s = store()
    writeAccount(s, { steamId: 'nope', name: 'x' })
    expect(s.map.has(ACCOUNT_STORAGE_KEY)).toBe(false)
  })

  it('treats storage that throws, and no storage at all, as no account', () => {
    expect(readAccount(throwing)).toBeNull()
    expect(readAccount(null)).toBeNull()
    expect(() => writeAccount(throwing, account)).not.toThrow()
    expect(() => writeAccount(null, account)).not.toThrow()
  })
})

describe('recognising a Steam profile link', () => {
  it.each([
    'https://steamcommunity.com/id/someone',
    'https://steamcommunity.com/id/someone/',
    'https://www.steamcommunity.com/id/someone',
    'https://steamcommunity.com/profiles/76561198000000000',
    'http://steamcommunity.com/profiles/76561198000000000/',
    'https://steamcommunity.com/id/%E8%B7%9F%E6%9E%AA',
  ])('accepts %s', url => expect(looksLikeSteamUrl(url)).toBe(true))

  it.each([
    ['another host entirely', 'https://evil.test/id/x'],
    ['a host that merely ends with Steam\'s', 'https://notsteamcommunity.com/id/x'],
    ['a host that merely contains Steam\'s', 'https://steamcommunity.com.evil.test/id/x'],
    ['a subdomain nobody publishes profiles on', 'https://store.steamcommunity.com/id/x'],
    ['a path that is not a profile', 'https://steamcommunity.com/app/824270'],
    ['no path at all', 'https://steamcommunity.com/'],
    ['a deeper path', 'https://steamcommunity.com/id/someone/games'],
    ['profiles with something that is not a SteamID', 'https://steamcommunity.com/profiles/someone'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['plain text', 'someone'],
    ['nothing', '   '],
  ])('refuses %s', (_why, url) => expect(looksLikeSteamUrl(url)).toBe(false))
})

describe('the update check switch', () => {
  it('is on until the player turns it off', () => {
    const s = store()
    expect(readUpdatesEnabled(s)).toBe(true)
    writeUpdatesEnabled(s, false)
    expect(s.map.get(UPDATES_STORAGE_KEY)).toBe('off')
    expect(readUpdatesEnabled(s)).toBe(false)
    writeUpdatesEnabled(s, true)
    expect(readUpdatesEnabled(s)).toBe(true)
  })

  it('reads anything it does not recognise as on, never as off', () => {
    // Only an explicit "off" turns the check off, so a corrupt value can never silently
    // stop a player from hearing about a new version.
    for (const raw of ['', 'nonsense', 'OFF', 'false', '0']) {
      expect(readUpdatesEnabled(store({ [UPDATES_STORAGE_KEY]: raw })), raw).toBe(true)
    }
  })

  it('treats storage that throws, and no storage at all, as on', () => {
    expect(readUpdatesEnabled(throwing)).toBe(true)
    expect(readUpdatesEnabled(null)).toBe(true)
    expect(() => writeUpdatesEnabled(throwing, false)).not.toThrow()
    expect(() => writeUpdatesEnabled(null, false)).not.toThrow()
  })
})
