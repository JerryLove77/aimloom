import { parseCrosshair, renderCrosshair, toSvg, getTuningParams, readTuningValue, tune,
  type CrosshairGame, type ParsedCrosshair, type TuneValue, type TuningParam } from '../../../crosshair/src/index'
import { canonicalPngIssue, encodePng } from '../../../crosshair/src/png'
import { errorMsg } from '../workspace/issue-text'
import { type Lang, type Msg } from '../i18n'
import { toBase64 } from './png'

/** The native calls the save-elsewhere path needs. It never touches the game. */
export interface CrosshairExportBridge {
  pickFolder(kind: 'export', lang: Lang): Promise<string | null>
  exportFile(input: { directory: string; fileName: string; base64: string; gameRoot: string }): Promise<{ path: string; bytes: number; sha256: string }>
}

export interface CrosshairExportState {
  code: string
  svg: string | null
  width: number
  height: number
  pngBase64: string | null
  warnings: string[]
  ready: boolean
  saving: boolean
  message: Msg | null
  error: Msg | null
  /** Set once the pasted code parses; drives the fine-tune section's controls. */
  game: CrosshairGame | null
  params: TuningParam[]
  /** Current control values, seeded from the parsed code and changed by setTune. */
  values: Record<string, TuneValue>
  /** True once any value differs from what the pasted code decoded to. */
  tuned: boolean
}

function readAllValues(parsed: ParsedCrosshair, params: TuningParam[]): Record<string, TuneValue> {
  const values: Record<string, TuneValue> = {}
  for (const param of params) values[param.id] = readTuningValue(parsed, param.id)
  return values
}

/**
 * Renders a crosshair code into a PNG, and (CUR-C2) tunes it with per-game controls before it
 * is added to the game or saved elsewhere. Adding the PNG to the game is the Crosshair page
 * controller's job (one plan and one job per session), so this controller owns only the parse,
 * the tuned render, and the secondary "save a copy somewhere else" action. The file name lives
 * with the page controller's add mode, where the name rules and the taken-name check already
 * are. The pasted code itself (`state.code`) is never rewritten by tuning.
 */
export function createCrosshairExportController(bridge: CrosshairExportBridge, gameRoot: string) {
  let state: CrosshairExportState = {
    code: '', svg: null, width: 0, height: 0, pngBase64: null, warnings: [], ready: false,
    saving: false, message: null, error: null,
    game: null, params: [], values: {}, tuned: false,
  }
  let parsed: ParsedCrosshair | null = null
  let baseValues: Record<string, TuneValue> = {}
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<CrosshairExportState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  /** Renders `source` (the base parse, or a tuned copy of it) and publishes the raster/PNG. */
  function renderFrom(source: ParsedCrosshair): boolean {
    try {
      const raster = renderCrosshair(source)
      const png = encodePng({ width: raster.width, height: raster.height, data: raster.data, warnings: [] })
      // The engine accepts only a canonical PNG within its size limits; refuse here, with a reason.
      const issue = canonicalPngIssue(png)
      if (issue) { publish({ svg: null, pngBase64: null, ready: false, error: { zh: issue.zh, en: issue.en } }); return false }
      publish({
        svg: toSvg(raster), width: raster.width, height: raster.height, pngBase64: toBase64(png),
        warnings: raster.warnings.map(warning => warning.message), ready: true, error: null,
      })
      return true
    } catch (error) {
      publish({ svg: null, pngBase64: null, ready: false, error: errorMsg(error, { key: 'crosshair.error.parseCode' }) })
      return false
    }
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setCode(value: string): void {
      // Any edit invalidates the previous render: what is added or saved must match the code shown.
      parsed = null
      baseValues = {}
      publish({ code: value, svg: null, pngBase64: null, width: 0, height: 0, warnings: [], ready: false, error: null, message: null,
        game: null, params: [], values: {}, tuned: false })
    },
    async preview(): Promise<boolean> {
      try {
        parsed = parseCrosshair(state.code)
      } catch (error) {
        parsed = null
        publish({ svg: null, pngBase64: null, ready: false, game: null, params: [], values: {}, tuned: false,
          error: errorMsg(error, { key: 'crosshair.error.parseCode' }) })
        return false
      }
      const params = getTuningParams(parsed.game)
      baseValues = readAllValues(parsed, params)
      publish({ game: parsed.game, params, values: { ...baseValues }, tuned: false })
      return renderFrom(parsed)
    },
    /** Changes one control and re-renders from the pasted code plus every current value. */
    setTune(id: string, value: TuneValue): void {
      if (!parsed) return
      const values = { ...state.values, [id]: value }
      let source: ParsedCrosshair
      try {
        source = tune(parsed, values)
      } catch (error) {
        publish({ error: errorMsg(error, { key: 'crosshair.error.parseCode' }) })
        return
      }
      const tunedFlag = Object.keys(baseValues).some(key => values[key] !== baseValues[key])
      publish({ values, tuned: tunedFlag })
      renderFrom(source)
    },
    /** Restores every control to what the pasted code decoded to (恢复成粘贴的代码). */
    resetTune(): void {
      if (!parsed) return
      publish({ values: { ...baseValues }, tuned: false })
      renderFrom(parsed)
    },
    /** Saves a copy outside the game: choose a folder, then write once. Cancelling is not an error. */
    async saveAs(fileName: string, lang: Lang): Promise<boolean> {
      if (state.saving) return false
      if (!state.ready || !state.pngBase64) { publish({ error: { key: 'crosshair.error.previewFirst' } }); return false }
      publish({ error: null, message: null })
      try {
        const directory = await bridge.pickFolder('export', lang)
        if (!directory) return false
        publish({ saving: true })
        const result = await bridge.exportFile({ directory, fileName, base64: state.pngBase64, gameRoot })
        publish({ saving: false, message: { key: 'crosshair.saved.success', params: { path: result.path } } })
        return true
      } catch (error) {
        publish({ saving: false, error: errorMsg(error, { key: 'crosshair.error.saveFailed' }) })
        return false
      }
    },
  }
}

export type CrosshairExportController = ReturnType<typeof createCrosshairExportController>
