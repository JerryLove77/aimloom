import { useEffect, useState } from 'react'
import type { Lang, MessageKey, Msg } from '../i18n'
import { errorMsg } from '../section/issue-text'
import type { FileAddOutcome, FileImportInput } from '../section/file-import'

/**
 * Adding an outside file from a Profile sheet: the nested add sheet's state, and the lock that
 * an `unknown` result holds on the whole sheet until 核对结果 reconciles that very operation.
 * The sheet decides what to refresh after an add or a reconcile.
 */
export function useSheetImport({ onAddFile, onPickFile, onReconcile, onUnresolvedChange, setError, keys, afterAdd, afterReconcile }: {
  onAddFile: ((input: FileImportInput) => Promise<FileAddOutcome>) | undefined
  onPickFile: ((lang: Lang) => Promise<string | null>) | undefined
  onReconcile: (() => Promise<void>) | undefined
  onUnresolvedChange: ((unresolved: boolean) => void) | undefined
  setError(error: Msg | null): void
  keys: { generic: Msg; unknown: MessageKey; reconcileFailed: MessageKey }
  afterAdd(): void | Promise<void>
  afterReconcile(): void | Promise<void>
}) {
  // The outside file being confirmed in the nested add sheet. Nothing is written until 添加到游戏.
  const [importPath, setImportPath] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<Msg | null>(null)
  // `unknown` is never success: this stays true, locking choosing/confirming/further adds, until
  // 核对结果 reconciles the very operation that came back unresolved.
  const [unresolved, setUnresolved] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  useEffect(() => { onUnresolvedChange?.(unresolved) }, [unresolved, onUnresolvedChange])
  return {
    importPath, importing, importError, unresolved, reconciling,
    /** What reopening the sheet clears. */
    reset() { setImportPath(null); setImportError(null); setUnresolved(false) },
    closeImport() { setImportPath(null) },
    async pick(lang: Lang) {
      if (!onPickFile) return
      try { const path = await onPickFile(lang); if (path) { setImportError(null); setImportPath(path) } }
      catch (reason) { setError(errorMsg(reason, keys.generic)) }
    },
    async add(input: FileImportInput): Promise<boolean> {
      if (!onAddFile) return false
      setImporting(true); setImportError(null)
      const outcome = await onAddFile(input)
      setImporting(false)
      if (outcome.kind === 'added') { setImportPath(null); const after = afterAdd(); if (after) await after; return true }
      // The same page-level rule applies here: an unknown result closes this add sheet and locks
      // the Profile sheet behind it until 核对结果, exactly as Theme/Sounds lock their own page.
      if (outcome.kind === 'unknown') { setImportPath(null); setUnresolved(true); setError({ key: keys.unknown }); return false }
      setImportError(outcome.message)
      return false
    },
    async reconcile() {
      if (!onReconcile) return
      setReconciling(true)
      try {
        await onReconcile()
        setUnresolved(false)
        setError(null)
        const after = afterReconcile()
        if (after) await after
      } catch (reason) { setError(errorMsg(reason, { key: keys.reconcileFailed })) }
      finally { setReconciling(false) }
    },
  }
}
