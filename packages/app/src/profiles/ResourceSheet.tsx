import { useEffect, useRef, useState } from 'react'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { Tag } from '../workspace/ui'
import { plural, useLang, useMsg, useT, type Lang, type Msg } from '../i18n'
import { errorMsg } from '../workspace/issue-text'
import { AssetPreview } from './AssetPreview'
import { Tiles, type TileChoice } from '../workspace/Tiles'
import { resolveProfileAssetPath, type ProfileFileReference } from './model'
import type { ProfileAssetBridge } from './assets'
import { ImportSheet } from '../workspace/ImportSheet'
import { importFileName } from '../workspace/import-check'
import type { FileAddOutcome, FileImportInput } from '../workspace/file-import'

type SingleKind = 'scheme'
// The lowercase noun, not the section's title: it stands mid-sentence ("does not change the current theme").
const NOUN_KEY: Record<SingleKind, 'scheme.noun'> = { scheme: 'scheme.noun' }
const KEEP = '__keep__'
const GENERIC: Msg = { key: 'profile.sheet.error.generic' }
/** A row in the listing is one asset file, so a failure there is about that file — not the Profile. */
const FILE_FALLBACK: Msg = { key: 'import.cantRead' }

/**
 * Choose one file for a Profile component. The choice inside the sheet is temporary: only
 * 用于此组合 hands it back, and even that writes the draft alone — nothing is saved to the
 * Profile's JSON and nothing is applied to the game.
 */
export function ResourceSheet({ kind, profileName, profilePath, value, assets, isDemo, open, defaultDirectory = null, installed = null, onAddFile, onPickFile, onAdded, onConfirm, onCancel }: {
  kind: SingleKind
  profileName: string
  profilePath: string
  value: ProfileFileReference | null
  assets: ProfileAssetBridge
  isDemo: boolean
  open: boolean
  /** The game's own folder for this kind, so the sheet opens on what is installed instead of empty. */
  defaultDirectory?: string | null
  /**
   * What the game already has, shown as the same previewed grid the section shows. When this is
   * null the sheet falls back to browsing a folder, which is what it always did.
   */
  installed?: { file: string; label: string; detail: string; path: string; selectable: boolean; reason?: string | undefined; current?: boolean; duplicate?: boolean }[] | null
  /**
   * Adds an outside file to the game through the existing byte-exact plan path (`planFileAdd`).
   * Absent means the caller has no game bridge wired in, so the button is not offered -- the
   * same best-effort fallback every other Profile game read already uses.
   */
  onAddFile?: ((input: FileImportInput) => Promise<FileAddOutcome>) | undefined
  /** Opens the native file picker for this kind, already filtered by the caller. */
  onPickFile?: ((lang: Lang) => Promise<string | null>) | undefined
  /** Called after a successful add, so the caller can refresh what the game has installed. */
  onAdded?: () => void
  onConfirm: (value: ProfileFileReference | null) => void
  onCancel: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const [directory, setDirectory] = useState('')
  const [files, setFiles] = useState<ProfileFileReference[]>([])
  const [fileErrors, setFileErrors] = useState<{ fileName: string; message: Msg }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Msg | null>(null)
  const [search, setSearch] = useState('')
  const [choice, setChoice] = useState<string>(value?.path ?? KEEP)
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState(0)
  const request = useRef(0)
  // The outside file being confirmed in the nested add sheet. Nothing is written until 添加到游戏.
  const [importPath, setImportPath] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<Msg | null>(null)
  useEffect(() => { if (open) { setChoice(value?.path ?? KEEP); setSearch(''); setError(null); setImportPath(null); setImportError(null) } }, [open, value])
  async function load(path: string) {
    const own = ++request.current
    setLoading(true); setError(null); setFiles([]); setFileErrors([])
    try {
      const list = await assets.list(kind, path)
      if (own !== request.current) return
      setDirectory(list.directory); setFiles(list.files)
      setFileErrors(list.errors.map(item => ({ fileName: item.fileName, message: errorMsg({ message: item.message, messageEn: item.messageEn }, FILE_FALLBACK) })))
    } catch (reason) { if (own === request.current) setError(errorMsg(reason, GENERIC)) } finally { if (own === request.current) setLoading(false) }
  }
  // Opening with an existing reference starts in that file's own folder. With no reference the
  // sheet used to open on nothing at all, so the player was asked to find a folder before they
  // could see anything -- and the folder they almost always want is the game's own.
  useEffect(() => {
    if (!open || directory) return
    if (installed) return
    if (!value) { if (defaultDirectory) void load(defaultDirectory); return }
    const resolved = resolveProfileAssetPath(profilePath, value.path).replace(/\\/g, '/')
    const end = resolved.lastIndexOf('/')
    const minimum = /^[a-z]:\//i.test(resolved) ? 3 : resolved.startsWith('/') ? 1 : 0
    void load(resolved.slice(0, Math.max(end, minimum)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opening
  }, [open])
  async function browse() {
    try { const path = await assets.chooseDirectory(kind, lang); if (path) await load(path) } catch (reason) { setError(errorMsg(reason, GENERIC)) }
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
    if (outcome.kind === 'added') { setImportPath(null); onAdded?.(); return true }
    if (outcome.kind === 'unknown') { setImportError({ key: 'profile.sheet.importUnknown' }); return false }
    setImportError(outcome.message)
    return false
  }
  // Everything selectable, by path: the folder listing, the game's own list when there is one,
  // and the Profile's existing reference even when its folder is not on screen.
  // A reference names the FILE, not the theme's display name: `file`, never `label`.
  const byPath = new Map([...files, ...(installed ?? []).map(item => ({ name: item.file, path: item.path }))].map(file => [file.path, file]))
  // The profile's own reference stays selectable even when its folder is not listed.
  if (value && !byPath.has(value.path)) byPath.set(value.path, value)
  const listed = [...byPath.values()].filter(file => file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const chosen = choice === KEEP ? null : byPath.get(choice) ?? null
  const unchanged = choice === (value?.path ?? KEEP)
  // Browsing a folder, the preview is the only evidence the file is usable, so confirming waits
  // for it. A tile from the game's own list needs no such wait: the engine already reported it
  // readable, and a preview that fails to render is not a reason to refuse the choice.
  const fromGame = choice !== KEEP && (installed ?? []).some(item => item.path === choice)
  const confirmable = !unchanged && (choice === KEEP || ready || fromGame)
  const noun = t(NOUN_KEY[kind])
  // The grid's own shape: the sheet only adds which tile is staged right now.
  const tiles: TileChoice[] = (installed ?? []).map(item => ({ ...item, pending: choice === item.path }))
  return <Dialog variant="sheet" open={open} title={t('profile.sheet.title', { name: profileName, noun })} onClose={onCancel}>
    <p className="ws-note">{t('profile.sheet.note', { name: profileName, noun })}</p>
    <div className="pr-sheet-preview">{chosen
      ? <AssetPreview key={chosen.path} kind={kind} reference={chosen} profilePath={profilePath} assets={assets} onStatus={status => setReady(status === 'ready')} />
      : <div className="ws-preview-large">{t('profile.resource.keepHint', { noun })}</div>}</div>
    {installed ? null : <div className="cx-picker-source"><span className="ws-path">{directory || t('profile.resource.dirPlaceholder')}</span><Button variant="ghost" disabled={loading} onClick={() => void browse()}>{isDemo ? t('profile.sheet.browseDemo') : t('audio.locate.chooseFolder')}</Button></div>}
    {onPickFile ? <div className="cx-picker-source"><Button variant="ghost" disabled={loading || importing} onClick={() => void pickAndOpenImport()}>{t('scheme.addTheme')}</Button></div> : null}
    {importPath ? <ImportSheet key={importPath} kind="theme" sourcePath={importPath} directory={directory || defaultDirectory || t('profile.resource.dirPlaceholder')}
      installed={(installed ?? []).map(item => ({ name: item.label === item.file ? null : item.label, file: item.file }))} assets={assets} busy={importing} error={importError}
      preview={<AssetPreview kind={kind} reference={{ name: importFileName(importPath), path: importPath }} profilePath={profilePath} assets={assets} />}
      onAdd={addImport} onClose={() => setImportPath(null)} /> : null}
    {installed ? null : <><label className="pr-sr-only" htmlFor={`sheet-search-${kind}`}>{t('profile.resource.searchLabel')}</label></>}
    {installed ? null : <input id={`sheet-search-${kind}`} className="pr-sheet-search" type="search" placeholder={t('profile.resource.searchLabel')} value={search} onChange={event => setSearch(event.target.value)} />}
    {loading ? <p role="status">{t('profile.resource.loading')}</p> : null}
    {error ? <Notice tone="error"><p>{msg(error)}</p></Notice> : null}
    {fileErrors.length ? <Notice tone="warning"><details><summary>{t(plural(fileErrors.length, 'profile.resource.fileErrorsSummary'), { count: fileErrors.length })}</summary>{fileErrors.map((item, index) => <p key={index}>{t('profile.listErrors.item', { file: item.fileName, message: msg(item.message) })}</p>)}</details></Notice> : null}
    <div className="pr-sheet-list" role="radiogroup" aria-label={t('profile.resource.filesAria', { noun })}>
      <label className="pr-sheet-row"><input type="radio" name={`sheet-${kind}`} checked={choice === KEEP} onChange={() => setChoice(KEEP)} /><span><strong>{t('profile.resource.keepTitle', { noun })}</strong><small>{t('profile.resource.keepHint', { noun })}</small></span>{value === null ? <Tag kind="saved">{t('profile.resource.currentRefTag')}</Tag> : null}{choice === KEEP && value !== null ? <Tag kind="temporary" /> : null}</label>
      {installed ? null : listed.map(file => <label className="pr-sheet-row" key={file.path}><input type="radio" name={`sheet-${kind}`} checked={choice === file.path} onChange={() => { setReady(false); setChoice(file.path) }} />
        <span><strong>{file.name}</strong><small>{file.path}</small></span>
        {value?.path === file.path ? <Tag kind="saved">{t('profile.resource.currentRefTag')}</Tag> : null}{choice === file.path && value?.path !== file.path ? <Tag kind="temporary" /> : null}</label>)}
    </div>
    {installed ? <Tiles choices={tiles} page={page} pageSize={6} countKey="scheme.pagination.count"
      ariaLabel={item => t('scheme.tile.previewLabel', { label: item.label })}
      thumb={item => <AssetPreview key={item.path} kind={kind} reference={{ name: item.label, path: item.path }} profilePath={profilePath} assets={assets} />}
      onPage={setPage}
      onChoose={item => { setReady(true); setChoice(choice === item.path ? KEEP : item.path) }} /> : null}
    <div className="ki-dialog-actions"><span className="ws-note">{unchanged ? t('profile.sheet.unchanged') : chosen ? t('profile.resource.tempChosen', { name: chosen.name }) : t('profile.resource.tempKeep', { noun })}</span>
      <Button data-safe-focus onClick={onCancel}>{t('import.cancel')}</Button>
      <Button variant="primary" disabled={!confirmable} onClick={() => onConfirm(chosen)}>{t('profile.sheet.confirm')}</Button></div>
  </Dialog>
}
