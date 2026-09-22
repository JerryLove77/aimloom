import { describe, expect, it } from 'vitest'
import { InstallerFailure } from '../../src/installer/contracts'
import { errorMsg } from '../../src/workspace/issue-text'
import { renderMsg } from '../../src/i18n'
import { LocalizedError } from '../../../core/src/types'
import { CrosshairError } from '../../../crosshair/src/errors'

const fallback = { zh: '新增失败', en: 'Add failed' }
const render = (msg: ReturnType<typeof errorMsg>) => ({ zh: renderMsg('zh', msg), en: renderMsg('en', msg) })

describe('errorMsg', () => {
  it('keeps a Chinese engine message as it is, paired with its own English text', () => {
    const failure = new InstallerFailure({ code: 'ENGINE_ERROR', message: 'crosshairs 文件夹里已经有「dot.png」', messageEn: 'The crosshairs folder already has "dot.png"', path: null })
    expect(errorMsg(failure, fallback)).toEqual({ zh: 'crosshairs 文件夹里已经有「dot.png」', en: 'The crosshairs folder already has "dot.png"' })
  })

  it('maps a coded English refusal to fixed wording in both languages', () => {
    const stale = new InstallerFailure({ code: 'PLAN_STALE', message: 'Install source or target changed after preview.', messageEn: 'Install source or target changed after preview.', path: null })
    const rendered = render(errorMsg(stale, fallback))
    expect(rendered.zh).toMatch(/预览之后发生了改变/)
    expect(rendered.en).toMatch(/changed after preview/)
    // A job error is a plain object, not an InstallerFailure.
    expect(render(errorMsg({ code: 'RECOVERY_REQUIRED', message: 'An unfinished operation must be recovered.' }, fallback)).zh).toMatch(/一键拖入/)
    expect(render(errorMsg({ code: 'BUSY', message: 'an installer operation is still unresolved' }, fallback)).zh).toMatch(/还没有结束/)
  })

  it('never shows Chinese to an English player: a Chinese message with no messageEn falls back to the caller\'s English', () => {
    expect(errorMsg({ code: 'ENGINE_ERROR', message: '磁盘已满，文件没有添加。' }, fallback))
      .toEqual({ zh: '磁盘已满，文件没有添加。', en: fallback.en })
    expect(errorMsg(new Error('磁盘已满，文件没有添加。'), fallback))
      .toEqual({ zh: '磁盘已满，文件没有添加。', en: fallback.en })
  })

  it('never shows bare English: the fallback leads and the detail follows, in both languages', () => {
    expect(errorMsg(new Error('Invalid backup context.'), { zh: '新增失败，游戏文件未改变。', en: 'Add failed; the game files did not change.' }))
      .toEqual({ zh: '新增失败，游戏文件未改变。（详细信息：Invalid backup context.）', en: 'Add failed; the game files did not change. (Details: Invalid backup context.)' })
    expect(errorMsg({ code: 'ENGINE_ERROR', message: 'Case collision at target: x' }, fallback))
      .toEqual({ zh: '新增失败（详细信息：Case collision at target: x）', en: 'Add failed (Details: Case collision at target: x)' })
  })

  it('uses the fallback alone when there is nothing to add', () => {
    expect(errorMsg(undefined, fallback)).toEqual(fallback)
    expect(errorMsg(new Error(''), fallback)).toEqual(fallback)
  })

  it('keeps a core LocalizedError\'s own English half, instead of substituting the fallback\'s', () => {
    const error = new LocalizedError('environment.wall 必须是对象', 'environment.wall must be an object')
    expect(errorMsg(error, fallback)).toEqual({ zh: 'environment.wall 必须是对象', en: 'environment.wall must be an object' })
  })

  it('keeps a CrosshairError\'s own English half, instead of substituting the fallback\'s', () => {
    const error = new CrosshairError('INVALID_CODE', '未识别准星代码，请使用 CSGO- 开头的 CS2 代码或 VALORANT 导出代码', 'Unrecognized crosshair code; use a CS2 code starting with CSGO- or a VALORANT export code')
    expect(errorMsg(error, fallback)).toEqual({ zh: error.message, en: error.en })
  })

  it('ignores a messageEn that is not English, falling back rather than showing Chinese', () => {
    // Old data, or a layer that copied the Chinese into both halves: the English side must not
    // publish it. The caller's fallback English stands in.
    const message = '游戏正在运行，已停止写入。'
    expect(errorMsg({ code: 'ENGINE_ERROR', message, messageEn: message }, fallback))
      .toEqual({ zh: message, en: 'Add failed' })
  })

  it('keeps the missing-PowerShell message from Rust, paired with its own English text', () => {
    const message = '没有找到 PowerShell 7。请先安装，然后重新打开本程序'
    const messageEn = 'PowerShell 7 was not found. Install it, then reopen this program'
    expect(errorMsg(new InstallerFailure({ code: 'WORKER_UNAVAILABLE', message, messageEn, path: null }), { zh: '失败', en: 'Failed' }))
      .toEqual({ zh: message, en: messageEn })
  })
})
