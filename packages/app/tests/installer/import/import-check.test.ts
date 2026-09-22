import { describe, expect, it } from 'vitest'
import { importFileName, importIssue, themeNameOf } from '../../../src/workspace/import-check'
import { renderMsg } from '../../../src/i18n'

const utf8 = (text: string) => new TextEncoder().encode(text)
function utf16(text: string, bigEndian: boolean) {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe])
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes.set(bigEndian ? [code >> 8, code & 0xff] : [code & 0xff, code >> 8], 2 + i * 2)
  }
  return bytes
}
const installedThemes = [{ name: 'Blue Hour', file: 'Blue.json' }, { name: null, file: 'Broken.json' }]
const installedSounds = [{ name: 'hit', file: 'hit.wav' }, { name: 'Bell5', file: 'Bell5.ogg' }]

describe('import checks', () => {
  it('takes the file name from a Windows or a POSIX path', () => {
    expect(importFileName('C:\\Users\\p\\Downloads\\Blue Hour.json')).toBe('Blue Hour.json')
    expect(importFileName('/home/p/命中.ogg')).toBe('命中.ogg')
  })

  it('reads a theme name from UTF-8 and from both UTF-16 byte orders', () => {
    const json = '{"themeName":"夜间 Night","wallMaterial":"DRYWALL"}'
    expect(themeNameOf(utf8(json))).toBe('夜间 Night')
    expect(themeNameOf(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(json)]))).toBe('夜间 Night')
    expect(themeNameOf(utf16(json, false))).toBe('夜间 Night')
    expect(themeNameOf(utf16(json, true))).toBe('夜间 Night')
  })

  it('says in Chinese why a file is not a theme', () => {
    expect(() => themeNameOf(utf8('{not json'))).toThrow(/不是有效的 JSON/)
    expect(() => themeNameOf(utf8('[1,2]'))).toThrow(/JSON 对象/)
    expect(() => themeNameOf(utf8('{"themeName":"  "}'))).toThrow(/themeName/)
  })

  it('refuses a theme whose internal name is installed, naming the installed file', () => {
    const issue = importIssue('theme', 'Another.json', installedThemes, 'blue HOUR')
    expect(issue?.field).toBe('content')
    expect(renderMsg('zh', issue!.message)).toMatch(/blue HOUR/)
    expect(renderMsg('zh', issue!.message)).toMatch(/Blue\.json/)
    expect(renderMsg('en', issue!.message)).toMatch(/blue HOUR/)
    expect(renderMsg('en', issue!.message)).toMatch(/Blue\.json/)
    expect(importIssue('theme', 'Another.json', installedThemes, 'Unique')).toBeNull()
  })

  it('refuses a file name already in the folder, whatever the letter case', () => {
    expect(importIssue('theme', 'BLUE.JSON', installedThemes, 'Unique')).toMatchObject({ field: 'name' })
    expect(importIssue('sound', 'HIT.WAV', installedSounds)).toMatchObject({ field: 'name' })
  })

  it('refuses a sound stem that exists under the other extension', () => {
    // hit.ogg beside hit.wav would make both unbindable and break a binding that names hit.
    const issue = importIssue('sound', 'hit.ogg', installedSounds)
    expect(issue?.field).toBe('name')
    expect(renderMsg('zh', issue!.message)).toMatch(/hit\.wav/)
    expect(importIssue('sound', 'bell.wav', installedSounds)).toBeNull()
  })

  it('applies the engine name rules, with the extension fixed by the kind', () => {
    for (const bad of ['', '.json', '../x.json', 'a/b.json', 'con.json', 'trailing .json', 'a..b.json', 'note.txt', `${'a'.repeat(124)}.json`]) {
      expect(importIssue('theme', bad, [], 'T'), JSON.stringify(bad)).toMatchObject({ field: 'name' })
    }
    expect(importIssue('sound', 'a;b.wav', [])).toMatchObject({ field: 'name' })
    expect(importIssue('sound', 'song.mp3', [])).toMatchObject({ field: 'name' })
    expect(importIssue('theme', `${'准'.repeat(100)}.json`, [], 'T')).toBeNull()
  })
})
