import { useEffect, useId, useState, type ReactNode } from 'react'
import { sha256Hex } from '../../../crosshair/src/png'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import type { FileAddKind } from '../installer/contracts'
import type { ProfileAssetBridge } from '../profiles/assets'
import { useMsg, useT, type Msg } from '../i18n'
import type { FileImportInput } from './file-import'
import { extensionOf, importFileName, importIssue, stemOf, themeNameOf, ThemeContentError, type InstalledEntry } from './import-check'
import { errorMsg } from './issue-text'

const TITLE_KEYS: Record<FileAddKind, 'import.title.theme' | 'import.title.sound'> = { theme: 'import.title.theme', sound: 'import.title.sound' }
const NOTE_KEYS: Record<FileAddKind, 'import.noteTheme' | 'import.noteSound'> = { theme: 'import.noteTheme', sound: 'import.noteSound' }

type Source = { status: 'reading' } | { status: 'failed'; message: Msg }
  | { status: 'ready'; sha256: string; themeName: string | null; contentIssue: Msg | null }

/**
 * Confirms adding one outside file to the game. It reads the file once, to hash what the
 * player is looking at and to check a theme's internal name; only Add to game writes, and the
 * write is the engine's byte-for-byte copy of that same file. `preview` is the section's own
 * render of it, and a preview that fails never blocks the add.
 */
export function ImportSheet({ kind, sourcePath, directory, installed, assets, busy, error, preview, onAdd, onClose }: {
  kind: FileAddKind
  sourcePath: string
  /** The game folder the file will be copied into. */
  directory: string
  installed: InstalledEntry[]
  assets: ProfileAssetBridge
  busy: boolean
  /** The engine's refusal of the last attempt, if any. */
  error: Msg | null
  preview?: ReactNode
  onAdd(input: FileImportInput): Promise<boolean>
  onClose(): void
}) {
  const t = useT()
  const msg = useMsg()
  const original = importFileName(sourcePath)
  const extension = extensionOf(original)
  const [stem, setStem] = useState(stemOf(original))
  const [source, setSource] = useState<Source>({ status: 'reading' })
  const nameId = useId()
  useEffect(() => {
    let cancelled = false
    setSource({ status: 'reading' })
    void (async () => {
      try {
        const bytes = await assets.read(kind === 'theme' ? 'scheme' : 'audio', sourcePath)
        const sha256 = await sha256Hex(bytes)
        let themeName: string | null = null
        let contentIssue: Msg | null = null
        if (kind === 'theme') try { themeName = themeNameOf(bytes) }
        catch (reason) { contentIssue = reason instanceof ThemeContentError ? reason.msg : { key: 'import.notATheme' } }
        if (!cancelled) setSource({ status: 'ready', sha256, themeName, contentIssue })
      } catch (reason) {
        const message: Msg = errorMsg(reason, { key: 'import.cantRead' })
        if (!cancelled) setSource({ status: 'failed', message })
      }
    })()
    return () => { cancelled = true }
  }, [assets, kind, sourcePath])

  const file = `${stem}${extension}`
  const issue = importIssue(kind, file, installed, source.status === 'ready' ? source.themeName ?? undefined : undefined)
  const nameIssue = issue?.field === 'name' ? issue.message : null
  const contentIssue = source.status === 'ready' ? source.contentIssue ?? (issue?.field === 'content' ? issue.message : null) : null
  const ready = source.status === 'ready' && !issue && !source.contentIssue
  async function add() {
    if (source.status !== 'ready' || !ready || busy) return
    await onAdd({ sourcePath, sourceSha256: source.sha256, file })
  }
  return <Dialog variant="sheet" open title={t(TITLE_KEYS[kind])} onClose={() => { if (!busy) onClose() }}>
    <p className="ws-note">{t(NOTE_KEYS[kind])}</p>
    {preview ? <div className="ws-import-preview">{preview}</div> : null}
    <dl className="ws-import-facts">
      <div><dt>{t('import.source')}</dt><dd className="ws-path">{sourcePath}</dd></div>
      <div><dt>{t('import.destination')}</dt><dd className="ws-path">{directory}</dd></div>
      {source.status === 'ready' && source.themeName ? <div><dt>{t('import.themeName')}</dt><dd>{source.themeName}</dd></div> : null}
    </dl>
    <div className="ws-field">
      <label htmlFor={nameId}>{t('import.fileName')}</label>
      <div className="ws-field-row">
        <input id={nameId} value={stem} onChange={event => setStem(event.target.value)} disabled={busy} maxLength={128} spellCheck={false}
          aria-invalid={!!nameIssue} aria-describedby={nameIssue ? `${nameId}-error` : undefined} />
        <span className="ws-field-suffix">{extension}</span>
      </div>
      {nameIssue ? <p id={`${nameId}-error`} className="pr-error">{msg(nameIssue)}</p> : null}
    </div>
    <p className="ws-note">{t('import.copyNote')}</p>

    {source.status === 'reading' ? <p role="status" className="ws-note">{t('import.reading')}</p> : null}
    {source.status === 'failed' ? <Notice tone="error"><p>{msg(source.message)}</p><p>{t('import.readHint')}</p></Notice> : null}
    {contentIssue ? <Notice tone="error"><p>{msg(contentIssue)}</p></Notice> : null}
    {error && !contentIssue ? <Notice tone="error"><p>{msg(error)}</p></Notice> : null}
    <div className="ki-dialog-actions">
      <Button data-safe-focus disabled={busy} onClick={onClose}>{t('import.cancel')}</Button>
      <Button variant="primary" disabled={busy || !ready} onClick={() => void add()}>{busy ? t('import.adding') : t('import.addToGame')}</Button>
    </div>
  </Dialog>
}
