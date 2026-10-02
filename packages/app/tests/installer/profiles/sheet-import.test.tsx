import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'
import type { Msg } from '../../../src/i18n'
import { useSheetImport } from '../../../src/profiles/sheet-import'

it('keeps a folder-refresh failure after a clean reconciliation', async () => {
  const { result } = renderHook(() => {
    const [error, setError] = useState<Msg | null>(null)
    const importer = useSheetImport({
      onAddFile: undefined, onPickFile: undefined, onUnresolvedChange: undefined,
      onReconcile: async () => ({ state: 'reconciled', error: null }),
      setError, keys: { generic: { key: 'import.fallback' }, unknown: 'audio.error.importUnknown', reconcileFailed: 'audio.error.reconcileFailed' },
      afterAdd: () => {},
      // AudioSheet's folder loader catches its read error and publishes it here.
      afterReconcile: async () => { setError({ key: 'audio.error.listSounds' }) },
    })
    return { error, importer }
  })
  await act(async () => { await result.current.importer.reconcile() })
  expect(result.current.error).toEqual({ key: 'audio.error.listSounds' })
})
