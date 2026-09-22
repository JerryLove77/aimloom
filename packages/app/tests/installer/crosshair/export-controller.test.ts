import { describe, expect, it } from 'vitest'
import { canonicalPngIssue } from '../../../../crosshair/src/png'
import { createCrosshairExportController } from '../../../src/crosshair/export-controller'
import { renderMsg } from '../../../src/i18n'

// A real code from the crosshair package fixtures; codes are five groups of five characters.
const CS2 = 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG'
const VALORANT = '0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0'

type ExportInput = { directory: string; fileName: string; base64: string; gameRoot: string }
function bridge(folder: string | null = 'D:/Exports') {
  const written: ExportInput[] = []
  const picks: string[] = []
  return {
    written, picks,
    pickFolder: async (kind: 'export', lang: string) => { picks.push(`${kind}:${lang}`); return folder },
    exportFile: async (input: ExportInput) => {
      written.push(input)
      return { path: `${input.directory}/${input.fileName}`, bytes: 100, sha256: 'a'.repeat(64) }
    },
  }
}

describe('crosshair code rendering', () => {
  it('renders a pasted CS2 code into a preview and a PNG the engine accepts', async () => {
    const controller = createCrosshairExportController(bridge(), 'D:/Game')
    controller.setCode(CS2)
    expect(await controller.preview()).toBe(true)
    const state = controller.getState()
    expect(state.ready).toBe(true)
    expect(state.svg).toMatch(/^<svg/)
    expect(state.width).toBeGreaterThan(0)
    // The same bytes go to planCrosshairAdd, so they must already be canonical.
    expect(canonicalPngIssue(Uint8Array.from(Buffer.from(state.pngBase64!, 'base64')))).toBeNull()
  })

  it('renders a VALORANT code too, and rejects text that is not a code', async () => {
    const controller = createCrosshairExportController(bridge(), 'D:/Game')
    controller.setCode(VALORANT)
    expect(await controller.preview()).toBe(true)
    controller.setCode('hello there')
    expect(await controller.preview()).toBe(false)
    expect(controller.getState().ready).toBe(false)
    const error = controller.getState().error
    expect(error ? renderMsg('zh', error) : null).toMatch(/准星代码|未识别/)
  })

  it('an edit invalidates the previous render', async () => {
    const controller = createCrosshairExportController(bridge(), 'D:/Game')
    controller.setCode(CS2)
    await controller.preview()
    controller.setCode(`${CS2} `)
    expect(controller.getState().ready).toBe(false)
    expect(controller.getState().pngBase64).toBeNull()
  })
})

describe('saving the PNG somewhere else', () => {
  it('saveAs picks a folder, then exports once under the given name', async () => {
    const b = bridge()
    const controller = createCrosshairExportController(b, 'D:/Game')
    controller.setCode(CS2)
    await controller.preview()
    expect(await controller.saveAs('my-crosshair.png', 'zh')).toBe(true)
    expect(b.picks).toEqual(['export:zh'])
    expect(b.written).toHaveLength(1)
    expect(b.written[0]).toMatchObject({ directory: 'D:/Exports', fileName: 'my-crosshair.png', gameRoot: 'D:/Game' })
    expect(controller.getState().message).toEqual({ key: 'crosshair.saved.success', params: { path: 'D:/Exports/my-crosshair.png' } })
  })

  it('a cancelled folder dialog saves nothing and is not an error', async () => {
    const b = bridge(null)
    const controller = createCrosshairExportController(b, 'D:/Game')
    controller.setCode(CS2)
    await controller.preview()
    expect(await controller.saveAs('mine.png', 'zh')).toBe(false)
    expect(b.written).toEqual([])
    expect(controller.getState().error).toBeNull()
  })

  it('refuses to save before a code has been rendered', async () => {
    const b = bridge()
    const controller = createCrosshairExportController(b, 'D:/Game')
    expect(await controller.saveAs('mine.png', 'zh')).toBe(false)
    expect(controller.getState().error).toEqual({ key: 'crosshair.error.previewFirst' })
    expect(b.picks).toEqual([])
  })

  it('reports a refused write in Chinese without claiming success', async () => {
    const failing = {
      pickFolder: async () => 'D:/Exports',
      exportFile: async () => { throw new Error('不能另存：这个文件夹里已经有「mine.png」 (already exists)') },
    }
    const controller = createCrosshairExportController(failing, 'D:/Game')
    controller.setCode(CS2)
    await controller.preview()
    expect(await controller.saveAs('mine.png', 'zh')).toBe(false)
    const error = controller.getState().error
    expect(error ? renderMsg('zh', error) : null).toMatch(/已经有/)
    expect(controller.getState().message).toBeNull()
  })
})
