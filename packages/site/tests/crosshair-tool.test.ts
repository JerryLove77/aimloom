import { describe, expect, it } from 'vitest'
import {
  previewFromCode, previewWithTune, downloadFileName, errorText, warningText, readAllValues,
  getTuningParams, CrosshairError,
} from '../src/lib/crosshair-tool'
import { tuneLabel, dependencyDisabled, PALETTE_OWNED_IDS, paletteState } from '../src/lib/crosshair-labels'

// From packages/crosshair/tests/fixtures/cs2.json and valorant.json (upstream published test
// fixtures; see that folder's provenance note). Kept as literals here so this suite has no
// cross-package file dependency.
const CS2_CODE = 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG'
const VALORANT_CODE = '0;s;1;P;c;1;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0'

describe('previewFromCode', () => {
  it('parses and renders a CS2 code to a canonical PNG', () => {
    const { parsed, preview } = previewFromCode(CS2_CODE)
    expect(parsed.game).toBe('cs2')
    expect(preview.game).toBe('cs2')
    expect(preview.width).toBeGreaterThan(0)
    expect(preview.height).toBeGreaterThan(0)
    // PNG signature.
    expect(Array.from(preview.png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(preview.svg).toContain('<svg')
  })

  it('parses and renders a VALORANT code', () => {
    const { parsed, preview } = previewFromCode(VALORANT_CODE)
    expect(parsed.game).toBe('valorant')
    expect(preview.game).toBe('valorant')
    expect(Array.from(preview.png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

  it('throws a bilingual CrosshairError on a bad code', () => {
    expect(() => previewFromCode('not a crosshair code')).toThrow(CrosshairError)
    try {
      previewFromCode('not a crosshair code')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CrosshairError)
      expect(errorText(error, 'zh')).toContain('未识别')
      expect(errorText(error, 'en')).toMatch(/Unrecognized/i)
    }
  })

  it('gives a bilingual, non-empty message for an unknown error shape too', () => {
    expect(errorText(new Error('boom'), 'zh')).not.toBe('')
    expect(errorText(new Error('boom'), 'en')).not.toBe('')
  })
})

describe('previewWithTune', () => {
  it('changes a CS2 slider value without mutating the original parse', () => {
    const { parsed } = previewFromCode(CS2_CODE)
    const before = readAllValues(parsed, getTuningParams('cs2'))
    const { parsed: tuned, preview } = previewWithTune(parsed, { length: 8 })
    expect(readAllValues(tuned, getTuningParams('cs2')).length).toBe(8)
    // the original parse is untouched
    expect(readAllValues(parsed, getTuningParams('cs2')).length).toBe(before.length)
    expect(preview.png.length).toBeGreaterThan(0)
  })

  it('clamps an out-of-range value instead of rejecting it', () => {
    const { parsed } = previewFromCode(CS2_CODE)
    const { parsed: tuned } = previewWithTune(parsed, { length: 9999 })
    expect(readAllValues(tuned, getTuningParams('cs2')).length).toBe(10)
  })

  it('changes a VALORANT boolean control', () => {
    const { parsed } = previewFromCode(VALORANT_CODE)
    const { parsed: tuned } = previewWithTune(parsed, { centerDot: true })
    expect(readAllValues(tuned, getTuningParams('valorant')).centerDot).toBe(true)
  })
})

describe('downloadFileName', () => {
  it('names the file after the game', () => {
    expect(downloadFileName('cs2')).toBe('aimloom-cs2-crosshair.png')
    expect(downloadFileName('valorant')).toBe('aimloom-valorant-crosshair.png')
  })
})

describe('warningText', () => {
  it('renders the Chinese message as-is and an English one from the code table', () => {
    const { preview } = previewFromCode(CS2_CODE)
    // this fixture may or may not carry warnings; exercise the function directly either way
    const warning = { code: 'STATIC_APPROXIMATION', message: 'zh text' }
    expect(warningText(warning, 'zh')).toBe('zh text')
    expect(warningText(warning, 'en')).toMatch(/static approximate/i)
    expect(preview.game).toBe('cs2')
  })

  it('falls back to the Chinese text for an unknown warning code', () => {
    const warning = { code: 'SOME_FUTURE_CODE', message: 'zh only' }
    expect(warningText(warning, 'en')).toBe('zh only')
  })
})

describe('crosshair-labels', () => {
  it('mirrors the App tuner\'s dependency-disable and palette-ownership rules', () => {
    expect(dependencyDisabled('cs2', 'outline', { outlineEnabled: false })).toBe(true)
    expect(dependencyDisabled('cs2', 'outline', { outlineEnabled: true })).toBe(false)
    expect(dependencyDisabled('valorant', 'inner.length', { 'inner.enabled': false })).toBe(true)
    expect(PALETTE_OWNED_IDS.cs2).toEqual(['red', 'green', 'blue'])
    expect(PALETTE_OWNED_IDS.valorant).toEqual(['customColor', 'useCustomColor'])
  })

  it('labels every tunable parameter in both languages', () => {
    for (const game of ['cs2', 'valorant'] as const) {
      for (const param of getTuningParams(game)) {
        if (PALETTE_OWNED_IDS[game].includes(param.id)) continue
        expect(tuneLabel(game, param.id, 'zh'), param.id).not.toBe(param.id)
        expect(tuneLabel(game, param.id, 'en'), param.id).not.toBe(param.id)
      }
    }
  })
})

describe('paletteState', () => {
  it('renders one swatch per CS2 preset plus a trailing custom entry, with the preset in use marked', () => {
    const { parsed } = previewFromCode(CS2_CODE)
    const values = readAllValues(parsed, getTuningParams('cs2'))
    const state = paletteState('cs2', values, 'en')
    expect(state.swatches).toHaveLength(5) // CS2_PALETTE
    expect(state.swatches.map(s => s.index)).toEqual([0, 1, 2, 3, 4])
    for (const swatch of state.swatches) expect(swatch.rgb).toHaveLength(3)
    // exactly one entry (a preset, or custom) is checked
    const checkedCount = state.swatches.filter(s => s.checked).length + (state.custom.checked ? 1 : 0)
    expect(checkedCount).toBe(1)
  })

  it('marks the custom swatch once a CS2 colour index runs past the last preset', () => {
    const { parsed } = previewFromCode(CS2_CODE)
    const { parsed: tuned } = previewWithTune(parsed, { color: 5 }) // 0-4 are presets; 5 is custom
    const values = readAllValues(tuned, getTuningParams('cs2'))
    const state = paletteState('cs2', values, 'en')
    expect(state.swatches.every(s => !s.checked)).toBe(true)
    expect(state.custom.checked).toBe(true)
  })

  it('renders one swatch per VALORANT preset plus custom, switching on useCustomColor', () => {
    const { parsed } = previewFromCode(VALORANT_CODE)
    const baseValues = readAllValues(parsed, getTuningParams('valorant'))
    const before = paletteState('valorant', baseValues, 'en')
    expect(before.swatches).toHaveLength(8) // VALORANT_PALETTE

    const { parsed: tuned } = previewWithTune(parsed, { customColor: 'FF0000FF' })
    const values = readAllValues(tuned, getTuningParams('valorant'))
    const after = paletteState('valorant', values, 'en')
    expect(after.swatches.every(s => !s.checked)).toBe(true)
    expect(after.custom.checked).toBe(true)
  })

  it('gives every preset an accessible, non-empty name in both languages', () => {
    for (const game of ['cs2', 'valorant'] as const) {
      const { parsed } = previewFromCode(game === 'cs2' ? CS2_CODE : VALORANT_CODE)
      const values = readAllValues(parsed, getTuningParams(game))
      for (const lang of ['zh', 'en'] as const) {
        const state = paletteState(game, values, lang)
        for (const swatch of state.swatches) expect(swatch.name, `${game} ${lang} #${swatch.index}`).not.toBe('')
        expect(state.custom.name, `${game} ${lang} custom`).not.toBe('')
      }
    }
  })
})
