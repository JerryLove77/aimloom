// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clip, DESCRIPTION_MAX } from '../../../src/workspace/report-controller'

/** No lone surrogate: what `String.prototype.isWellFormed` answers, without needing the es2024 lib. */
const wellFormed = (text: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)

describe('the cap on what a player types into a report', () => {
  it('leaves a text within the cap alone', () => expect(clip('abc', 3)).toBe('abc'))
  it('cuts at the cap', () => expect(clip('abcd', 3)).toBe('abc'))
  it('never leaves half of a surrogate pair at the cut', () => {
    const pasted = 'a'.repeat(DESCRIPTION_MAX - 1) + '😀😀' // the first emoji straddles the cap
    const kept = clip(pasted, DESCRIPTION_MAX)
    expect(kept).toBe('a'.repeat(DESCRIPTION_MAX - 1))
    expect(wellFormed(kept)).toBe(true)
    expect(wellFormed(pasted.slice(0, DESCRIPTION_MAX))).toBe(false) // what the plain slice did
  })
  it('keeps a whole pair that ends exactly at the cap', () => expect(clip('ab😀x', 4)).toBe('ab😀'))
})
