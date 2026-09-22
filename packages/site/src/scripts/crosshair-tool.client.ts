/**
 * The client-side island for /crosshair (WEB-CROSSHAIR): wires the static markup in
 * `src/pages/[lang]/crosshair.astro` to the pure logic in `src/lib/crosshair-tool.ts`. Runs only
 * in the visitor's browser (Astro bundles this as a module script); it never contacts the
 * network and never touches a file outside a `<a download>` the visitor triggers themselves.
 *
 * Mirrors `packages/app/src/crosshair/CodeExportDialog.tsx` (same control shapes, same
 * dependency-disable and palette-ownership rules) so the two tuners never diverge in meaning,
 * but owns no plan/job state — there is no game to write to from a browser tab.
 */
import {
  previewFromCode, previewWithTune, downloadFileName, errorText, warningText, readAllValues,
  getTuningParams, type ParsedCrosshair, type TuneValue, type TuningParam, type CrosshairGame,
} from '../lib/crosshair-tool'
import {
  TUNE_CUSTOM_ALPHA, TUNE_CUSTOM_COLOR_PICKER, dependencyDisabled,
  tuneLabel, PALETTE_OWNED_IDS, paletteState,
} from '../lib/crosshair-labels'

type Lang = 'zh' | 'en'

function toHex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase()
}
function rgbToHex6(r: number, g: number, b: number): string { return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}` }
function hex6ToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [Number.parseInt(value.slice(0, 2), 16) || 0, Number.parseInt(value.slice(2, 4), 16) || 0, Number.parseInt(value.slice(4, 6), 16) || 0]
}
function valorantAlpha(hex8: string): number { return (Number.parseInt(hex8.slice(6, 8), 16) || 255) / 255 }
function composeValorantHex(rgbHex6: string, alpha: number): string {
  return `${rgbHex6.replace('#', '').toUpperCase()}${toHex2(alpha * 255)}`
}

function el<T extends HTMLElement>(root: ParentNode, id: string): T {
  const found = root.querySelector<T>(`#${id}`)
  if (!found) throw new Error(`crosshair tool: missing #${id}`)
  return found
}

export function mountCrosshairTool(): void {
  const root = document.getElementById('cx-app')
  if (!root) return
  const lang = (root.dataset.lang === 'en' ? 'en' : 'zh') as Lang

  const codeInput = el<HTMLTextAreaElement>(root, 'cx-code')
  const previewBtn = el<HTMLButtonElement>(root, 'cx-preview-btn')
  const errorBox = el<HTMLDivElement>(root, 'cx-error')
  const errorText_ = el<HTMLParagraphElement>(root, 'cx-error-text')
  const swatches = el<HTMLDivElement>(root, 'cx-swatches')
  const imgDark = el<HTMLImageElement>(root, 'cx-img-dark')
  const imgLight = el<HTMLImageElement>(root, 'cx-img-light')
  const sizeText = el<HTMLParagraphElement>(root, 'cx-size')
  const warningsBox = el<HTMLDivElement>(root, 'cx-warnings')
  const warningsList = el<HTMLUListElement>(root, 'cx-warnings-list')
  const tuneSection = el<HTMLDivElement>(root, 'cx-tune')
  const tuneControls = el<HTMLDivElement>(root, 'cx-tune-controls')
  const resetBtn = el<HTMLButtonElement>(root, 'cx-reset-btn')
  const downloadBtn = el<HTMLButtonElement>(root, 'cx-download-btn')

  let pasted: ParsedCrosshair | null = null
  let current: ParsedCrosshair | null = null
  let baseValues: Record<string, TuneValue> = {}
  let params: TuningParam[] = []
  let pngBytes: Uint8Array | null = null
  let objectUrl: string | null = null

  function showError(message: string | null): void {
    if (message === null) { errorBox.hidden = true; errorText_.textContent = ''; return }
    errorBox.hidden = false
    errorText_.textContent = message
  }

  function releaseImageUrls(): void {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
  }

  function reset(): void {
    pasted = null; current = null; baseValues = {}; params = []; pngBytes = null
    releaseImageUrls()
    swatches.hidden = true
    sizeText.hidden = true
    warningsBox.hidden = true
    warningsList.innerHTML = ''
    tuneSection.hidden = true
    tuneControls.innerHTML = ''
    downloadBtn.disabled = true
    resetBtn.disabled = true
  }

  function currentValues(): Record<string, TuneValue> {
    return current ? readAllValues(current, params) : {}
  }

  function applyPreview(parsed: ParsedCrosshair): boolean {
    try {
      const { preview } = previewWithTune(parsed, {})
      pngBytes = preview.png
      const svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(preview.svg)}`
      imgDark.src = svgUrl
      imgLight.src = svgUrl
      imgDark.alt = lang === 'zh' ? '准星预览' : 'Crosshair preview'
      imgLight.alt = `${imgDark.alt} · ${lang === 'zh' ? '浅色底' : 'light background'}`
      swatches.hidden = false
      sizeText.hidden = false
      sizeText.textContent = lang === 'zh'
        ? `${preview.width} × ${preview.height} 像素`
        : `${preview.width} × ${preview.height} px`
      warningsList.innerHTML = ''
      for (const warning of preview.warnings) {
        const li = document.createElement('li')
        li.textContent = warningText(warning, lang)
        warningsList.appendChild(li)
      }
      warningsBox.hidden = preview.warnings.length === 0
      downloadBtn.disabled = false
      showError(null)
      return true
    } catch (error) {
      pngBytes = null
      downloadBtn.disabled = true
      showError(errorText(error, lang))
      return false
    }
  }

  function refreshTuneUi(game: CrosshairGame): void {
    const values = currentValues()
    const tuned = params.some(param => values[param.id] !== baseValues[param.id])
    resetBtn.disabled = !tuned
    tuneControls.innerHTML = ''
    for (const param of params) {
      if (PALETTE_OWNED_IDS[game].includes(param.id)) continue
      if (param.id === 'color') { tuneControls.appendChild(buildPaletteControl(game, values)); continue }
      const value = values[param.id] ?? (param.kind === 'boolean' ? false : param.kind === 'color' ? '' : 0)
      tuneControls.appendChild(buildControl(game, param, value))
    }
    tuneSection.hidden = false
  }

  function onTune(id: string, value: TuneValue): void {
    if (!current) return
    try {
      const { parsed, preview } = previewWithTune(current, { [id]: value })
      current = parsed
      pngBytes = preview.png
      const svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(preview.svg)}`
      imgDark.src = svgUrl
      imgLight.src = svgUrl
      warningsList.innerHTML = ''
      for (const warning of preview.warnings) {
        const li = document.createElement('li')
        li.textContent = warningText(warning, lang)
        warningsList.appendChild(li)
      }
      warningsBox.hidden = preview.warnings.length === 0
      downloadBtn.disabled = false
      showError(null)
      refreshTuneUi(parsed.game)
    } catch (error) {
      showError(errorText(error, lang))
    }
  }

  function buildControl(game: CrosshairGame, param: TuningParam, value: TuneValue): HTMLElement {
    const label = tuneLabel(game, param.id, lang)
    const disabled = dependencyDisabled(game, param.id, currentValues())
    const row = document.createElement('div')
    row.className = (param.kind === 'boolean' ? 'cx-tune-row cx-tune-switch' : 'cx-tune-row cx-tune-slider') + (disabled ? ' is-disabled' : '')
    const span = document.createElement('span')
    span.textContent = label
    row.appendChild(span)
    if (param.kind === 'boolean') {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('aria-label', label)
      input.checked = value === true
      input.disabled = disabled
      input.addEventListener('change', () => onTune(param.id, input.checked))
      row.appendChild(input)
      return row
    }
    const numeric = typeof value === 'number' ? value : 0
    const controls = document.createElement('span')
    controls.className = 'cx-tune-controls'
    const input = document.createElement('input')
    input.type = 'range'
    input.setAttribute('aria-label', label)
    input.min = String(param.min ?? 0)
    input.max = String(param.max ?? 1)
    input.step = String(param.step ?? 1)
    input.value = String(numeric)
    input.disabled = disabled
    const valueSpan = document.createElement('span')
    valueSpan.className = 'cx-tune-value'
    valueSpan.textContent = String(numeric)
    input.addEventListener('input', () => {
      valueSpan.textContent = input.value
      onTune(param.id, Number(input.value))
    })
    controls.appendChild(input)
    controls.appendChild(valueSpan)
    row.appendChild(controls)
    return row
  }

  /** Right-aligned wrapper matching `.cx-tune-controls`' column, so the picker lines up under the
   * palette swatches above it instead of sitting at the row's left edge. */
  function pickerRow(): { row: HTMLElement; picker: HTMLInputElement } {
    const row = document.createElement('div')
    row.className = 'cx-tune-custom-color-row'
    const inner = document.createElement('div')
    inner.className = 'cx-tune-custom-color'
    const picker = document.createElement('input')
    picker.type = 'color'
    inner.appendChild(picker)
    row.appendChild(inner)
    return { row, picker }
  }

  function buildCustomColorControl(game: CrosshairGame, values: Record<string, TuneValue>, disabled: boolean): HTMLElement {
    const wrap = document.createElement('div')
    if (game === 'cs2') {
      const red = typeof values.red === 'number' ? values.red : 0
      const green = typeof values.green === 'number' ? values.green : 0
      const blue = typeof values.blue === 'number' ? values.blue : 0
      const { row, picker } = pickerRow()
      picker.setAttribute('aria-label', TUNE_CUSTOM_COLOR_PICKER[lang])
      picker.disabled = disabled
      picker.value = rgbToHex6(red, green, blue)
      picker.addEventListener('input', () => {
        const [r, g, b] = hex6ToRgb(picker.value)
        if (!current) return
        try {
          const { parsed, preview } = previewWithTune(current, { red: r, green: g, blue: b })
          current = parsed
          pngBytes = preview.png
          const svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(preview.svg)}`
          imgDark.src = svgUrl; imgLight.src = svgUrl
          downloadBtn.disabled = false
          refreshTuneUi(parsed.game)
        } catch (error) { showError(errorText(error, lang)) }
      })
      wrap.appendChild(row)
      return wrap
    }
    const hex8 = typeof values.customColor === 'string' && values.customColor ? values.customColor : 'FFFFFFFF'
    const alpha = valorantAlpha(hex8)
    const { row, picker } = pickerRow()
    picker.setAttribute('aria-label', TUNE_CUSTOM_COLOR_PICKER[lang])
    picker.disabled = disabled
    picker.value = `#${hex8.slice(0, 6)}`
    picker.addEventListener('input', () => onTune('customColor', composeValorantHex(picker.value, alpha)))
    wrap.appendChild(row)

    const alphaRow = document.createElement('div')
    alphaRow.className = 'cx-tune-row cx-tune-slider'
    const alphaLabel = document.createElement('span')
    alphaLabel.textContent = TUNE_CUSTOM_ALPHA[lang]
    alphaRow.appendChild(alphaLabel)
    const controls = document.createElement('span')
    controls.className = 'cx-tune-controls'
    const alphaInput = document.createElement('input')
    alphaInput.type = 'range'
    alphaInput.min = '0'; alphaInput.max = '1'; alphaInput.step = '0.01'
    alphaInput.value = String(alpha)
    alphaInput.disabled = disabled
    alphaInput.setAttribute('aria-label', TUNE_CUSTOM_ALPHA[lang])
    const valueSpan = document.createElement('span')
    valueSpan.className = 'cx-tune-value'
    valueSpan.textContent = alpha.toFixed(2)
    alphaInput.addEventListener('input', () => {
      valueSpan.textContent = Number(alphaInput.value).toFixed(2)
      onTune('customColor', composeValorantHex(hex8.slice(0, 6), Number(alphaInput.value)))
    })
    controls.appendChild(alphaInput)
    controls.appendChild(valueSpan)
    alphaRow.appendChild(controls)
    wrap.appendChild(alphaRow)
    return wrap
  }

  function buildPaletteControl(game: CrosshairGame, values: Record<string, TuneValue>): HTMLElement {
    const state = paletteState(game, values, lang)
    const disabled = dependencyDisabled(game, 'color', values)
    const paletteLength = state.swatches.length

    const container = document.createElement('div')
    const row = document.createElement('div')
    row.className = 'cx-tune-row cx-tune-palette-row' + (disabled ? ' is-disabled' : '')
    const span = document.createElement('span')
    span.textContent = state.label
    row.appendChild(span)
    const controls = document.createElement('span')
    controls.className = 'cx-tune-controls'
    const group = document.createElement('div')
    group.className = 'cx-tune-palette'
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', state.label)

    for (const swatch of state.swatches) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(swatch.checked))
      button.className = 'cx-swatch-btn'
      button.disabled = disabled
      button.setAttribute('aria-label', swatch.name)
      button.title = swatch.name
      button.style.backgroundColor = `rgb(${swatch.rgb[0]}, ${swatch.rgb[1]}, ${swatch.rgb[2]})`
      button.addEventListener('click', () => onTune('color', swatch.index))
      group.appendChild(button)
    }
    const customButton = document.createElement('button')
    customButton.type = 'button'
    customButton.setAttribute('role', 'radio')
    customButton.setAttribute('aria-checked', String(state.custom.checked))
    customButton.className = 'cx-swatch-btn cx-swatch-custom'
    customButton.disabled = disabled
    customButton.setAttribute('aria-label', state.custom.name)
    customButton.title = state.custom.name
    customButton.addEventListener('click', () => {
      if (game === 'cs2') onTune('color', paletteLength)
      else onTune('customColor', typeof values.customColor === 'string' && values.customColor ? values.customColor : 'FFFFFFFF')
    })
    group.appendChild(customButton)
    controls.appendChild(group)
    row.appendChild(controls)
    container.appendChild(row)
    if (state.custom.checked) container.appendChild(buildCustomColorControl(game, values, disabled))
    return container
  }

  codeInput.addEventListener('input', () => {
    previewBtn.disabled = codeInput.value.trim().length === 0
    reset()
    showError(null)
  })
  previewBtn.disabled = true
  // Explore links here as #code=<code>. A fragment never reaches the server, so the tool's "nothing
  // is uploaded" stays true; the code only fills the box, and the visitor still presses Preview.
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('code')
  if (fromLink && fromLink.length <= 4096) { codeInput.value = fromLink; previewBtn.disabled = fromLink.trim().length === 0 }

  previewBtn.addEventListener('click', () => {
    reset()
    try {
      const { parsed } = previewFromCode(codeInput.value)
      pasted = parsed
      current = parsed
      params = getTuningParams(parsed.game)
      baseValues = readAllValues(parsed, params)
      applyPreview(parsed)
      refreshTuneUi(parsed.game)
    } catch (error) {
      showError(errorText(error, lang))
    }
  })

  resetBtn.addEventListener('click', () => {
    if (!pasted) return
    current = pasted
    applyPreview(pasted)
    refreshTuneUi(pasted.game)
  })

  downloadBtn.addEventListener('click', () => {
    if (!pngBytes || !current) return
    releaseImageUrls()
    const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' })
    objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = downloadFileName(current.game)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  })

  reset()
}
