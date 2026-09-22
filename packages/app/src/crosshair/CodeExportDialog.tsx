import { useMemo, useSyncExternalStore } from 'react'
import { CS2_PALETTE, VALORANT_PALETTE, type PaletteColor } from '../../../crosshair/src/palette'
import type { TuneValue, TuningParam } from '../../../crosshair/src/tuning'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { useLang, useMsg, useT, type Lang, type MessageKey } from '../i18n'
import { crosshairFileName, crosshairNameIssue, type CrosshairController } from './controller'
import { createCrosshairExportController, type CrosshairExportBridge } from './export-controller'

type Game = 'cs2' | 'valorant'

// Ids the fine-tune list would otherwise render as their own row, but that PaletteControl
// draws inside its own custom-color control instead (red/green/blue as one colour picker; the
// VALORANT custom hex and its "is it active" flag as the custom swatch's selection state).
const PALETTE_OWNED_IDS: Record<Game, readonly string[]> = {
  cs2: ['red', 'green', 'blue'],
  valorant: ['customColor', 'useCustomColor'],
}

/** Which controls a toggle governs: a value survives while its parent is off, but is not editable. */
function dependencyDisabled(game: Game, id: string, values: Record<string, TuneValue>): boolean {
  if (game === 'cs2') {
    if (id === 'outline') return values.outlineEnabled !== true
    if (id === 'alpha') return values.alphaEnabled !== true
    return false
  }
  if (id === 'outlineThickness' || id === 'outlineOpacity') return values.outlines !== true
  if (id === 'dotThickness' || id === 'dotOpacity') return values.centerDot !== true
  if (id.startsWith('inner.') && id !== 'inner.enabled') return values['inner.enabled'] !== true
  if (id.startsWith('outer.') && id !== 'outer.enabled') return values['outer.enabled'] !== true
  return false
}

function toHex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase()
}
function rgbToHex6(r: number, g: number, b: number): string { return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}` }
function hex6ToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [Number.parseInt(value.slice(0, 2), 16) || 0, Number.parseInt(value.slice(2, 4), 16) || 0, Number.parseInt(value.slice(4, 6), 16) || 0]
}
/** VALORANT's `customColor` is an 8-hex RGBA string (see valorant.ts); the alpha byte is its last two digits. */
function valorantAlpha(hex8: string): number { return (Number.parseInt(hex8.slice(6, 8), 16) || 255) / 255 }
function composeValorantHex(rgbHex6: string, alpha: number): string {
  return `${rgbHex6.replace('#', '').toUpperCase()}${toHex2(alpha * 255)}`
}

/** One control for one tunable parameter; the section is presentation only, the render lives
 * in the export controller. */
function TuneControl({ param, game, value, disabled, onChange }: {
  param: TuningParam
  game: Game
  value: TuneValue
  disabled: boolean
  onChange: (id: string, value: TuneValue) => void
}) {
  const t = useT()
  const label = t(`crosshair.tune.${game}.${param.id}` as MessageKey)
  // aria-label (not a wrapping <label>) keeps each control's accessible name exactly the
  // parameter's name, not the name plus the numeric value shown beside a slider.
  if (param.kind === 'boolean') {
    return <div className="cx-tune-row cx-tune-switch">
      <span>{label}</span>
      <input type="checkbox" aria-label={label} checked={value === true} disabled={disabled}
        onChange={event => onChange(param.id, event.target.checked)} />
    </div>
  }
  // number: a range slider with the numeric value shown beside it. (palette is drawn by PaletteControl.)
  const numeric = typeof value === 'number' ? value : 0
  const min = param.min ?? 0
  const max = param.max ?? 1
  const step = param.step ?? 1
  return <div className="cx-tune-row cx-tune-slider">
    <span>{label}</span>
    <span className="cx-tune-controls">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={numeric} disabled={disabled}
        onChange={event => onChange(param.id, Number(event.target.value))} />
      <span className="cx-tune-value">{numeric}</span>
    </span>
  </div>
}

/** The custom-colour control revealed once the "custom" swatch is chosen. */
function CustomColorControl({ game, values, disabled, onChange }: {
  game: Game
  values: Record<string, TuneValue>
  disabled: boolean
  onChange: (id: string, value: TuneValue) => void
}) {
  const t = useT()
  const pickerLabel = t('crosshair.tune.customColorPicker')
  if (game === 'cs2') {
    const red = typeof values.red === 'number' ? values.red : 0
    const green = typeof values.green === 'number' ? values.green : 0
    const blue = typeof values.blue === 'number' ? values.blue : 0
    return <div className="cx-tune-custom-color">
      <input type="color" aria-label={pickerLabel} disabled={disabled} value={rgbToHex6(red, green, blue)}
        onChange={event => {
          const [nextRed, nextGreen, nextBlue] = hex6ToRgb(event.target.value)
          onChange('red', nextRed); onChange('green', nextGreen); onChange('blue', nextBlue)
        }} />
    </div>
  }
  const hex8 = typeof values.customColor === 'string' && values.customColor ? values.customColor : 'FFFFFFFF'
  const alpha = valorantAlpha(hex8)
  const alphaLabel = t('crosshair.tune.customAlpha')
  return <>
    <div className="cx-tune-custom-color">
      <input type="color" aria-label={pickerLabel} disabled={disabled} value={`#${hex8.slice(0, 6)}`}
        onChange={event => onChange('customColor', composeValorantHex(event.target.value, alpha))} />
    </div>
    <div className="cx-tune-row cx-tune-slider">
      <span>{alphaLabel}</span>
      <span className="cx-tune-controls">
        <input type="range" aria-label={alphaLabel} min={0} max={1} step={0.01} value={alpha} disabled={disabled}
          onChange={event => onChange('customColor', composeValorantHex(hex8.slice(0, 6), Number(event.target.value)))} />
        <span className="cx-tune-value">{alpha.toFixed(2)}</span>
      </span>
    </div>
  </>
}

/**
 * A row of colour swatch buttons (radio semantics) for the game's actual preset palette, plus
 * a "custom" swatch that reveals CustomColorControl. Picking a preset writes the `color` index
 * and (VALORANT) turns custom color back off; picking custom activates it — there is no
 * separate "use custom colour" checkbox to find.
 */
function PaletteControl({ game, values, disabled, lang, onChange }: {
  game: Game
  values: Record<string, TuneValue>
  disabled: boolean
  lang: Lang
  onChange: (id: string, value: TuneValue) => void
}) {
  const t = useT()
  const label = t(`crosshair.tune.${game}.color` as MessageKey)
  const customLabel = t('crosshair.tune.customSwatch')
  const palette: readonly PaletteColor[] = game === 'cs2' ? CS2_PALETTE : VALORANT_PALETTE
  const colorIndex = typeof values.color === 'number' ? values.color : 0
  const isCustom = game === 'cs2' ? colorIndex >= palette.length : values.useCustomColor === true
  function selectPreset(index: number): void { onChange('color', index) }
  function selectCustom(): void {
    if (game === 'cs2') onChange('color', palette.length)
    else onChange('customColor', typeof values.customColor === 'string' && values.customColor ? values.customColor : 'FFFFFFFF')
  }
  return <>
    <div className="cx-tune-row cx-tune-palette-row">
      <span>{label}</span>
      <div className="cx-tune-palette" role="radiogroup" aria-label={label}>
        {palette.map((entry, index) => {
          const name = lang === 'zh' ? entry.nameZh : entry.nameEn
          return <button key={index} type="button" role="radio" aria-checked={!isCustom && colorIndex === index}
            className="cx-swatch-btn" disabled={disabled} aria-label={name} title={name}
            style={{ backgroundColor: `rgb(${entry.rgb[0]}, ${entry.rgb[1]}, ${entry.rgb[2]})` }}
            onClick={() => selectPreset(index)} />
        })}
        <button type="button" role="radio" aria-checked={isCustom} className="cx-swatch-btn cx-swatch-custom"
          disabled={disabled} aria-label={customLabel} title={customLabel} onClick={selectCustom}>
          <span aria-hidden="true">?</span>
        </button>
      </div>
    </div>
    {isCustom ? <CustomColorControl game={game} values={values} disabled={disabled} onChange={onChange} /> : null}
  </>
}

/**
 * Two backdrops so a mostly-white and a mostly-dark crosshair are both checked before adding.
 * The dark swatch keeps the page's original preview accessible name so it stays findable as
 * "the" preview; the light swatch's name says which one it is.
 */
function TuneSwatches({ svg, previewAlt, dark, light }: { svg: string | null; previewAlt: string; dark: string; light: string }) {
  if (!svg) return null
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  // Each image carries its own background inline: a generic `img` rule elsewhere in this
  // stylesheet (the single-preview checkerboard) has equal CSS specificity to a class selector,
  // so it can otherwise win by source order and paint both swatches the same backdrop. An
  // inline style always wins regardless of stylesheet order, which is what the bug needed.
  return <div className="cx-tune-swatches">
    <figure className="cx-tune-swatch cx-tune-swatch-dark"><img src={url} alt={previewAlt} style={{ background: '#1a1a1c' }} /><figcaption>{dark}</figcaption></figure>
    <figure className="cx-tune-swatch cx-tune-swatch-light"><img src={url} alt={`${previewAlt} · ${light}`} style={{ background: '#f2f2f2' }} /><figcaption>{light}</figcaption></figure>
  </div>
}

/**
 * Paste a CS2/VALORANT code, preview it, and add it to the game's crosshairs folder.
 *
 * The write goes through the page controller's add path, because a native session holds one
 * plan and one job: the name rules, the taken-name check and the unknown-result lock already
 * live there. This sheet owns only the render, plus the secondary "save a copy elsewhere".
 */
export function CodeExportDialog({ bridge, controller, onClose }: {
  bridge: CrosshairExportBridge
  controller: CrosshairController
  onClose: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const page = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const gameRoot = page.gameRoot ?? ''
  const renderer = useMemo(() => createCrosshairExportController(bridge, gameRoot), [bridge, gameRoot])
  const state = useSyncExternalStore(renderer.subscribe, renderer.getState, renderer.getState)
  const busy = state.saving || page.applying
  const game = state.game as Game | null
  // A name taken in the game blocks adding, but a copy saved elsewhere only needs a valid name.
  const validName = crosshairNameIssue(page.newName) === null
  const freeName = validName && !page.nameError
  async function add() {
    if (!state.pngBase64) return
    const added = await controller.addGenerated({ label: t('crosshair.generatedLabel'), pngBase64: state.pngBase64, width: state.width, height: state.height })
    // An unknown result locks the page until Check result, which sits behind this sheet.
    if (added || controller.getState().unresolved) onClose()
  }
  return <Dialog variant="sheet" open title={t('crosshair.entry.code.title')} onClose={() => { if (!busy) onClose() }}>
    <p className="cx-note">{t('crosshair.code.note')}</p>
    <div className="cx-name-field">
      <label htmlFor="crosshair-code">{t('crosshair.code.label')}</label>
      <textarea id="crosshair-code" rows={3} value={state.code} onChange={event => renderer.setCode(event.target.value)} disabled={busy} maxLength={4096} spellCheck={false} />
    </div>
    <Button disabled={busy || !state.code.trim()} onClick={() => void renderer.preview()}>{t('crosshair.preview')}</Button>

    {state.svg ? <div className="cx-code-preview">
      <TuneSwatches svg={state.svg} previewAlt={t('crosshair.code.previewAlt')} dark={t('crosshair.tune.dark')} light={t('crosshair.tune.light')} />
      <span className="cx-note">{t('crosshair.code.previewSize', { width: state.width, height: state.height })}</span>
    </div> : null}
    {state.warnings.length ? <Notice tone="warning">{state.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</Notice> : null}

    {game && state.params.length ? <div className="cx-tune">
      <div className="cx-tune-head">
        <h3>{t('crosshair.tune.heading')}</h3>
        <Button variant="ghost" disabled={busy || !state.tuned} onClick={() => renderer.resetTune()}>{t('crosshair.tune.reset')}</Button>
      </div>
      {state.params.map(param => {
        if (PALETTE_OWNED_IDS[game].includes(param.id)) return null
        if (param.id === 'color') return <PaletteControl key="color" game={game} values={state.values} disabled={busy} lang={lang}
          onChange={(id, value) => renderer.setTune(id, value)} />
        return <TuneControl key={param.id} param={param} game={game}
          value={state.values[param.id] ?? (param.kind === 'boolean' ? false : param.kind === 'color' ? '' : 0)}
          disabled={busy || dependencyDisabled(game, param.id, state.values)} onChange={(id, value) => renderer.setTune(id, value)} />
      })}
    </div> : null}

    <div className="cx-name-field">
      <label htmlFor="crosshair-code-name">{t('crosshair.fileName')}</label>
      <input id="crosshair-code-name" value={page.newName} onChange={event => controller.setNewName(event.target.value)} disabled={busy} aria-invalid={!!page.nameError} aria-describedby={page.nameError ? 'crosshair-code-name-error' : undefined} placeholder={t('crosshair.namePlaceholderCode')} maxLength={128} />
      {page.nameError ? <p id="crosshair-code-name-error" className="pr-error">{msg(page.nameError)}</p> : null}
    </div>
    <div className="cx-picker-source"><span className="ws-muted">{t('crosshair.destination')}</span><span className="ws-path">{page.directory}</span></div>
    <p className="cx-note">{t('crosshair.tune.runningGameNote')}</p>

    {page.error ? <Notice tone="error"><p>{msg(page.error)}</p></Notice> : null}
    {state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}
    {state.message ? <p role="status" className="pr-status">{msg(state.message)}</p> : null}
    <div className="ki-dialog-actions">
      <Button data-safe-focus disabled={busy} onClick={onClose}>{t('crosshair.close')}</Button>
      <Button variant="ghost" disabled={busy || !state.ready || !validName} onClick={() => void renderer.saveAs(crosshairFileName(page.newName), lang)}>{state.saving ? t('crosshair.saving') : t('crosshair.saveAs')}</Button>
      <Button variant="primary" disabled={busy || !state.ready || !freeName} onClick={() => void add()}>{page.applying ? t('crosshair.adding') : t('crosshair.addToGame')}</Button>
    </div>
  </Dialog>
}
