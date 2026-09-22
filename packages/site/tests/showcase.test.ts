import { describe, expect, it } from 'vitest'
import { parseShowcase, showcase } from '../src/data/showcase'

const item = { file: 'media/theme-blue-hour.png', alt: { zh: '蓝色主题', en: 'Blue theme' }, caption: { zh: '随包提供', en: 'Ships in the package' }, inPackage: true }

describe('parseShowcase', () => {
  it('accepts an item whose file exists', () => {
    expect(parseShowcase([item], () => true)).toHaveLength(1)
  })
  it('rejects an item whose file is missing — no invented screenshots', () => {
    expect(() => parseShowcase([item], () => false)).toThrow(/media\/theme-blue-hour\.png/)
  })
  it('rejects a remote file', () => {
    expect(() => parseShowcase([{ ...item, file: 'https://x/y.png' }], () => true)).toThrow(/public/)
  })
})

describe('the committed showcase.json', () => {
  it('references only files that exist', () => {
    expect(Array.isArray(showcase)).toBe(true)
  })
})
