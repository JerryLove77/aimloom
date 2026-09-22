import { useEffect, useRef, useState } from 'react'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { Tag } from '../workspace/ui'
import { plural, useLang, useMsg, useT, type Lang, type Msg } from '../i18n'
import { errorMsg } from '../workspace/issue-text'
import { AssetPreview } from './AssetPreview'
import { AUDIO_EVENTS, MAX_AUDIO_FILES, type AudioEvent } from './audio/model'
import type { ProfileAudio, ProfileFileReference } from './model'
import type { ProfileAssetBridge } from './assets'
import { ImportSheet } from '../workspace/ImportSheet'
import { importFileName } from '../workspace/import-check'
import type { FileAddOutcome, FileImportInput } from '../workspace/file-import'

type Mode = 'keep' | 'none' | 'files'
const modeOf = (files: ProfileFileReference[] | undefined): Mode => (files === undefined ? 'keep' : files.length ? 'files' : 'none')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const GENERIC: Msg = { key: 'profile.sheet.error.generic' }
/** A row in the listing is one sound file, so a failure there is about that file — not the Profile. */
const FILE_FALLBACK: Msg = { key: 'import.cantRead' }

/**
 * Per-event audio for one Profile. Everything here is temporary until 用于此组合, which
 * writes the draft alone — nothing is saved to JSON, applied to the game, or auto-played.
 */
export function AudioSheet({ profileName, profilePath, value, assets, isDemo, open, defaultDirectory = null, onAddFile, onPickFile, onReconcile, onUnresolvedChange, onConfirm, onCancel }: {
  profileName: string
  profilePath: string
  value: ProfileAudio | null
  assets: ProfileAssetBridge
  isDemo: boolean
  open: boolean
  /** The game's own sounds folder, so the sheet opens on what is installed instead of empty. */
  defaultDirectory?: string | null
  /**
   * Adds an outside sound to the game through the existing byte-exact plan path
   * (`planFileAdd`). Absent means the caller has no game bridge wired in, so the button is not
   * offered -- the same best-effort fallback every other Profile game read already uses.
   */
  onAddFile?: ((input: FileImportInput) => Promise<FileAddOutcome>) | undefined
  /** Opens the native file picker, already filtered to sound files. */
  onPickFile?: ((lang: Lang) => Promise<string | null>) | undefined
  /**
   * Reconciles an add whose result came back `unknown` -- the only exit, per
   * `installer_reconcile`. Absent has the same meaning as `onAddFile` absent.
   */
  onReconcile?: (() => Promise<void>) | undefined
  /** Lifts "an add here is unresolved" so the caller can lock the whole Profile page too. */
  onUnresolvedChange?: ((unresolved: boolean) => void) | undefined
  onConfirm: (value: ProfileAudio | null) => void
  onCancel: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const EVENTS: Record<AudioEvent, string> = {
    kill: t('profile.audioSheet.event.kill'), spawn: t('profile.audioSheet.event.spawn'),
    mbsGood: t('audio.tab.mbsGood'), mbsOkay: t('audio.tab.mbsOkay'), mbsBad: t('audio.tab.mbsBad'), mbsChangeNow: t('audio.tab.mbsChangeNow'),
  }
  const [temp, setTemp] = useState<ProfileAudio | null>(() => structuredClone(value))
  const [event, setEvent] = useState<AudioEvent>('kill')
  const [listen, setListen] = useState<ProfileFileReference | null>(null)
  const [directory, setDirectory] = useState('')
  const [files, setFiles] = useState<ProfileFileReference[]>([])
  const [fileErrors, setFileErrors] = useState<{ fileName: string; message: Msg }[]>([])
  const [error, setError] = useState<Msg | null>(null)
  const request = useRef(0)
  // The outside file being confirmed in the nested add sheet. Nothing is written until 添加到游戏.
  const [importPath, setImportPath] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<Msg | null>(null)
  // `unknown` is never success: this stays true, locking choosing/confirming/further adds, until
  // 核对结果 reconciles the very operation that came back unresolved.
  const [unresolved, setUnresolved] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  useEffect(() => { if (open) { setTemp(structuredClone(value)); setEvent('kill'); setListen(null); setError(null); setFileErrors([]); setImportPath(null); setImportError(null); setUnresolved(false) } }, [open, value])
  useEffect(() => { onUnresolvedChange?.(unresolved) }, [unresolved, onUnresolvedChange])
  const eventFiles = temp?.[event]
  const mode = modeOf(eventFiles)
  const setEventFiles = (next: ProfileFileReference[] | undefined) => {
    const updated: ProfileAudio = { ...(temp ?? {}) }
    if (next === undefined) delete updated[event]; else updated[event] = next
    // An object with no events left means "this Profile records no audio at all".
    setTemp(Object.keys(updated).length ? updated : null)
  }
  async function load(path: string) {
    try {
      const own = ++request.current
      const list = await assets.list('audio', path)
      if (own !== request.current) return
      setDirectory(list.directory); setFiles(list.files)
      // A sound the engine could not read is named here; dropping it silently hid the file.
      setFileErrors(list.errors.map(item => ({ fileName: item.fileName, message: errorMsg({ message: item.message, messageEn: item.messageEn }, FILE_FALLBACK) })))
    } catch (reason) { setError(errorMsg(reason, GENERIC)) }
  }
  async function browse() {
    try { const path = await assets.chooseDirectory('audio', lang); if (path) await load(path) } catch (reason) { setError(errorMsg(reason, GENERIC)) }
  }
  async function pickAndOpenImport() {
    if (!onPickFile) return
    try { const path = await onPickFile(lang); if (path) { setImportError(null); setImportPath(path) } }
    catch (reason) { setError(errorMsg(reason, GENERIC)) }
  }
  async function addImport(input: FileImportInput): Promise<boolean> {
    if (!onAddFile) return false
    setImporting(true); setImportError(null)
    const outcome = await onAddFile(input)
    setImporting(false)
    if (outcome.kind === 'added') {
      setImportPath(null)
      // The new sound must appear in this sheet's own list, so re-read the folder it landed in.
      if (directory) await load(directory)
      else if (defaultDirectory) await load(defaultDirectory)
      return true
    }
    // The same page-level rule applies here: an unknown result closes this add sheet and locks
    // the Profile sheet behind it until 核对结果, exactly as Theme/Sounds lock their own page.
    if (outcome.kind === 'unknown') { setImportPath(null); setUnresolved(true); setError({ key: 'audio.error.importUnknown' }); return false }
    setImportError(outcome.message)
    return false
  }
  async function reconcileImport() {
    if (!onReconcile) return
    setReconciling(true)
    try {
      await onReconcile()
      setUnresolved(false)
      setError(null)
      if (directory) await load(directory)
      else if (defaultDirectory) await load(defaultDirectory)
    } catch (reason) { setError(errorMsg(reason, { key: 'audio.error.reconcileFailed' })) }
    finally { setReconciling(false) }
  }
  // With no folder chosen the sheet used to open on nothing, so the player had to go find one
  // before they could see any sound. The folder they almost always want is the game's own.
  useEffect(() => {
    if (!open || directory || !defaultDirectory) return
    void load(defaultDirectory)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opening
  }, [open])
  const changed = !same(temp, value)
  const move = (index: number, offset: number) => {
    if (!eventFiles) return
    const next = [...eventFiles]
    const target = index + offset
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setEventFiles(next)
  }
  return <Dialog variant="sheet" open={open} title={t('profile.sheet.title', { name: profileName, noun: t('audio.noun') })} onClose={() => { if (!unresolved) onCancel() }}>
    <p className="ws-note">{t('profile.sheet.note', { name: profileName, noun: t('audio.noun') })}</p>
    {importPath ? <ImportSheet key={importPath} kind="sound" sourcePath={importPath} directory={directory || defaultDirectory || t('profile.audioSheet.dirPlaceholder')}
      installed={files.map(file => ({ name: file.name, file: importFileName(file.path) }))} assets={assets} busy={importing} error={importError}
      preview={<AssetPreview kind="audio" reference={{ name: importFileName(importPath), path: importPath }} profilePath={profilePath} assets={assets} />}
      onAdd={addImport} onClose={() => setImportPath(null)} /> : null}
    {unresolved ? <Notice tone="warning"><p>{msg(error ?? { key: 'audio.error.importUnknown' })}</p>
      <p><Button variant="primary" disabled={reconciling || !onReconcile} onClick={() => void reconcileImport()}>{reconciling ? t('audio.status.loading') : t('audio.reconcile')}</Button></p></Notice> : <>
    <div className="pr-audio-event"><label htmlFor="sheet-audio-event">{t('profile.audioSheet.eventLabel')}</label>
      <select id="sheet-audio-event" value={event} onChange={e => { setEvent(e.target.value as AudioEvent); setListen(null) }}>
        {AUDIO_EVENTS.map(key => <option key={key} value={key}>{EVENTS[key]}{same(temp?.[key], value?.[key]) ? '' : t('profile.audioSheet.changedSuffix')}</option>)}
      </select></div>
    <div role="radiogroup" aria-label={t('profile.audioSheet.settingsAria', { event: EVENTS[event] })} className="pr-sheet-list">
      <label className="pr-sheet-row"><input type="radio" name="sheet-audio-mode" checked={mode === 'keep'} onChange={() => setEventFiles(undefined)} /><span><strong>{t('profile.audioSheet.keep.title')}</strong><small>{t('profile.audioSheet.keep.hint')}</small></span></label>
      <label className="pr-sheet-row"><input type="radio" name="sheet-audio-mode" checked={mode === 'none'} onChange={() => setEventFiles([])} /><span><strong>{t('profile.audioSheet.none.title')}</strong><small>{t('profile.audioSheet.none.hint')}</small></span></label>
      <label className="pr-sheet-row"><input type="radio" name="sheet-audio-mode" checked={mode === 'files'} onChange={() => { if (mode !== 'files') setEventFiles(eventFiles?.length ? eventFiles : []) }} disabled={!files.length && !eventFiles?.length} /><span><strong>{t('profile.audioSheet.files.title')}</strong><small>{t('profile.audioSheet.files.hint', { max: MAX_AUDIO_FILES })}</small></span></label>
    </div>
    {eventFiles?.length ? <div className="pr-sheet-files"><strong>{t(plural(eventFiles.length, 'profile.audioSheet.filesHeading'), { event: EVENTS[event], count: eventFiles.length })}</strong>
    {eventFiles.map((file, index) => <div className="au-draft-row" key={`${index}-${file.path}`}>
      <span>{index + 1}. {file.name}</span>
      <Button variant="ghost" aria-pressed={listen?.path === file.path} aria-label={t(listen?.path === file.path ? 'profile.audioSheet.listenAria.stop' : 'profile.audioSheet.listenAria.play', { name: file.name })} onClick={() => setListen(listen?.path === file.path ? null : file)}>{listen?.path === file.path ? t('audio.stop.button') : t('audio.play.button')}</Button>
      <Button variant="ghost" aria-label={t('profile.audioSheet.moveUp', { index: index + 1 })} disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
      <Button variant="ghost" aria-label={t('profile.audioSheet.moveDown', { index: index + 1 })} disabled={index === eventFiles.length - 1} onClick={() => move(index, 1)}>↓</Button>
      <Button variant="ghost" aria-label={t('profile.audioSheet.removeAria', { index: index + 1 })} onClick={() => setEventFiles(eventFiles.filter((_, i) => i !== index))}>{t('audio.remove')}</Button>
    </div>)}</div> : null}
    {listen ? <AssetPreview key={listen.path} kind="audio" reference={listen} profilePath={profilePath} assets={assets} /> : null}
    <div className="cx-picker-source"><span className="ws-path">{directory || t('profile.audioSheet.dirPlaceholder')}</span><Button variant="ghost" onClick={() => void browse()}>{isDemo ? t('profile.sheet.browseDemo') : t('audio.locate.chooseFolder')}</Button>
      {onPickFile ? <Button variant="ghost" disabled={importing} onClick={() => void pickAndOpenImport()}>{t('audio.addSound')}</Button> : null}</div>
    {error ? <Notice tone="error"><p>{msg(error)}</p></Notice> : null}
    {fileErrors.length ? <Notice tone="warning"><details><summary>{t(plural(fileErrors.length, 'profile.resource.fileErrorsSummary'), { count: fileErrors.length })}</summary>{fileErrors.map((item, index) => <p key={index}>{t('profile.listErrors.item', { file: item.fileName, message: msg(item.message) })}</p>)}</details></Notice> : null}
    <div className="pr-sheet-list">{files.map(file => <div className="pr-sheet-row" key={file.path}><span><strong>{file.name}</strong><small>{file.path}</small></span>
      {eventFiles?.some(item => item.path === file.path) ? <Tag kind="temporary">{t('audio.advanced.inList')}</Tag> : null}
      <Button aria-label={t('profile.audioSheet.addAria', { name: file.name })} disabled={(eventFiles?.length ?? 0) >= MAX_AUDIO_FILES} onClick={() => setEventFiles([...(eventFiles ?? []), file])}>{t('profile.audioSheet.add')}</Button></div>)}</div>
    </>}
    <div className="ki-dialog-actions"><span className="ws-note">{changed ? t('common.tag.changed') : t('profile.sheet.unchanged')}</span>
      <Button data-safe-focus disabled={unresolved} onClick={onCancel}>{t('import.cancel')}</Button>
      <Button variant="primary" disabled={!changed || unresolved} onClick={() => onConfirm(temp)}>{t('profile.sheet.confirm')}</Button></div>
  </Dialog>
}
