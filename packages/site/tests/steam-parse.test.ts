import { describe, expect, it } from 'vitest'
import { parseSteamUrl, parseSteamXml } from '../src/worker/steam'

describe('parseSteamUrl', () => {
  it('accepts the two public profile forms, with or without a slash or a query', () => {
    expect(parseSteamUrl('https://steamcommunity.com/profiles/76561198000000042/')).toBe('https://steamcommunity.com/profiles/76561198000000042/?xml=1')
    expect(parseSteamUrl('https://steamcommunity.com/id/some_Name-1')).toBe('https://steamcommunity.com/id/some_Name-1/?xml=1')
    expect(parseSteamUrl(' https://steamcommunity.com/id/abc/?l=schinese ')).toBe('https://steamcommunity.com/id/abc/?xml=1')
    expect(parseSteamUrl('http://www.steamcommunity.com/id/abc')).toBe('https://steamcommunity.com/id/abc/?xml=1')
  })
  it('refuses anything that could make the Worker fetch somewhere else', () => {
    for (const bad of ['https://steamcommunity.com.evil.test/id/abc', 'https://evil.test/profiles/76561198000000042', 'https://steamcommunity.com/id/abc/../../market', 'https://steamcommunity.com/profiles/123', 'https://steamcommunity.com/groups/abc', 'https://steamcommunity.com/id/a%2Fb', 'https://user:pw@steamcommunity.com/id/abc', 'steamcommunity.com/id/abc', 'not a url', ''])
      expect(parseSteamUrl(bad), bad).toBeNull()
  })
})

describe('parseSteamXml', () => {
  it('reads the id and the name', () => {
    expect(parseSteamXml('<profile><steamID64>76561198000000042</steamID64><steamID><![CDATA[PlayerOne]]></steamID><privacyState>private</privacyState></profile>')).toEqual({ steamId: '76561198000000042', name: 'PlayerOne' })
  })
  it('keeps a Chinese name and cuts a very long one to 64 characters', () => {
    expect(parseSteamXml('<steamID64>76561198000000042</steamID64><steamID><![CDATA[瞄准练习]]></steamID>')).toEqual({ steamId: '76561198000000042', name: '瞄准练习' })
    const r = parseSteamXml(`<steamID64>76561198000000042</steamID64><steamID><![CDATA[${'x'.repeat(100)}]]></steamID>`)
    expect(r !== null && r !== 'not-found' && r.name.length).toBe(64)
  })
  it('tells an unknown profile from an unreadable answer', () => {
    expect(parseSteamXml('<response><error><![CDATA[The specified profile could not be found.]]></error></response>')).toBe('not-found')
    expect(parseSteamXml('<html>maintenance</html>')).toBeNull()
  })
  it('reads a profile whose name is literally <error>: a parsable profile wins over the error check', () => {
    expect(parseSteamXml('<profile><steamID64>76561198000000042</steamID64><steamID><![CDATA[<error>]]></steamID></profile>')).toEqual({ steamId: '76561198000000042', name: '<error>' })
  })
})
