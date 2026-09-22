import { describe, expect, it } from 'vitest'
import { addFileToGame, type FileImportBridge } from '../../../src/workspace/file-import'
import { renderMsg } from '../../../src/i18n'
import type { PlanFileAddRequest } from '../../../src/installer/contracts'

const request: PlanFileAddRequest = { gameRoot: 'D:/Game', kind: 'theme', sourcePath: 'C:/x.json', sourceSha256: 'a'.repeat(64), file: 'x.json', revision: 1 }

function bridge(job: { state: string; result?: { status: string } | null; error?: { code: string; message: string } | null }): FileImportBridge {
  return {
    planFileAdd: async () => ({ planId: 'plan-1' }),
    pickFile: async () => null,
    execute: async input => ({ operationId: input.operationId }),
    job: async () => job,
  }
}

describe('addFileToGame: an incomplete result with no status code', () => {
  it('keeps the Chinese wording exactly, translating only the missing status', async () => {
    const outcome = await addFileToGame(bridge({ state: 'finished', result: {} as { status: string } }), 'op-1', request)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') throw new Error('expected refused')
    expect(renderMsg('zh', outcome.message)).toBe('添加没有完成（未知），请到「一键拖入」处理。')
    expect(renderMsg('en', outcome.message)).toBe('The add did not finish (unknown); handle it in Quick import.')
  })

  it('keeps a real status code as-is in both languages', async () => {
    const outcome = await addFileToGame(bridge({ state: 'finished', result: { status: 'recovery-required' } }), 'op-1', request)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') throw new Error('expected refused')
    expect(renderMsg('zh', outcome.message)).toBe('添加没有完成（recovery-required），请到「一键拖入」处理。')
    expect(renderMsg('en', outcome.message)).toBe('The add did not finish (recovery-required); handle it in Quick import.')
  })
})
