import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Notice } from '../ui/Notice'
import { Tag } from '../ui/status'
import { plural, useLang, useMsg, useT, type Lang, type Msg } from '../i18n'
import { errorMsg } from '../section/issue-text'
import { AssetPreview } from './AssetPreview'
import { Tiles, type TileChoice } from '../ui/Tiles'
import { resolveProfileAssetPath, type ProfileFileReference } from './model'
import type { ProfileAssetBridge } from '../bridge/assets'
import { ImportSheet } from '../section/ImportSheet'
import { SearchBox } from '../ui/SearchBox'
import { importFileName } from '../section/import-check'
import type { FileAddOutcome, FileImportInput } from '../section/file-import'
import { useSheetImport } from './sheet-import'
import { useFavorites, type FavoritesStore } from '../section/favorites'

type SingleKind = 'scheme'
// The lowercase noun, not the section's title: it stands mid-sentence ("does not change the current theme").
const NOUN_KEY: Record<SingleKind, 'scheme.noun'> = { scheme: 'scheme.noun' }
/** No file staged yet: only a new draft whose theme the game could not name starts here. */
const NONE = ''
const GENERIC: Msg = { key: 'profile.sheet.error.generic' }
/** A row in the listing is one asset file, so a failure there is about that file — not the Profile. */
const FILE_FALLBACK: Msg = { key: 'import.cantRead' }

/**
 * Choose one file for a Profile component. The choice inside the sheet is temporary: only
 * 用于此组合 hands it back, and even that writes the draft alone — nothing is saved to the
 * Profile's JSON and nothing is applied to the game.
 */
export function ResourceSheet({ kind, profileName, profilePath, value, assets, isDemo, open, defaultDirectory = null, installed = null, favorites, onAddFile, onPickFile, onReconcile, onUnresolvedChange, onAdded, onConfirm, onCancel }: {
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
  /** The starred themes: the game's own grid lists them first, with the same star as Theme. */
  favorites?: FavoritesStore | undefined
  /**
   * Adds an outside file to the game through the existing byte-exact plan path (`planFileAdd`).
   * Absent means the caller has no game bridge wired in, so the button is not offered -- the
   * same best-effort fallback every other Profile game read already uses.
   */
  onAddFile?: ((input: FileImportInput) => Promise<FileAddOutcome>) | undefined
  /** Opens the native file picker for this kind, already filtered by the caller. */
  onPickFile?: ((lang: Lang) => Promise<string | null>) | undefined
  /**
   * Reconciles an add whose result came back `unknown` -- the only exit, per
   * `installer_reconcile`. Absent has the same meaning as `onAddFile` absent.
   */
  onReconcile?: (() => Promise<void>) | undefined
  /** Lifts "an add here is unresolved" so the caller can lock the whole Profile page too. */
  onUnresolvedChange?: ((unresolved: boolean) => void) | undefined
  /** Called after a successful add, so the caller can refresh what the game has installed. */
  onAdded?: () => void
  onConfirm: (value: ProfileFileReference) => void
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
  const [choice, setChoice] = useState<string>(value?.path ?? NONE)
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState(0)
  const request = useRef(0)
  const fav = useFavorites(favorites, 'theme', open)
  const importer = useSheetImport({
    onAddFile, onPickFile, onReconcile, onUnresolvedChange, setError,
    keys: { generic: GENERIC, unknown: 'scheme.error.importUnknown', reconcileFailed: 'scheme.error.reconcileFailed' },
    afterAdd: () => onAdded?.(),
    afterReconcile: () => onAdded?.(),
  })
  const { importPath, importing, importError, unresolved, reconciling } = importer
  useEffect(() => { if (open) { setChoice(value?.path ?? NONE); setSearch(''); setError(null); importer.reset() } }, [open, value])
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
  // Everything selectable, by path: the folder listing, the game's own list when there is one,
  // and the Profile's existing reference even when its folder is not on screen.
  // A reference names the FILE, not the theme's display name: `file`, never `label`.
  const byPath = new Map([...files, ...(installed ?? []).map(item => ({ name: item.file, path: item.path }))].map(file => [file.path, file]))
  // The profile's own reference stays selectable even when its folder is not listed.
  if (value && !byPath.has(value.path)) byPath.set(value.path, value)
  // The same rule as the Theme page: trimmed, case-insensitive, on the display name or the file.
  const needle = search.trim().toLocaleLowerCase()
  const listed = [...byPath.values()].filter(file => file.name.toLocaleLowerCase().includes(needle))
  const chosen = byPath.get(choice) ?? null
  const unchanged = choice === (value?.path ?? NONE)
  // Browsing a folder, the preview is the only evidence the file is usable, so confirming waits
  // for it. A tile from the game's own list needs no such wait: the engine already reported it
  // readable, and a preview that fails to render is not a reason to refuse the choice.
  const fromGame = (installed ?? []).some(item => item.path === choice)
  const confirmable = !unchanged && chosen !== null && (ready || fromGame)
  const noun = t(NOUN_KEY[kind])
  // The grid's own shape: the sheet only adds which tile is staged right now.
  // Filtering narrows the grid only; the staged choice survives a search that hides its tile.
  const tiles: TileChoice[] = fav.sort(installed ?? [], item => item.file)
    .filter(item => !needle || item.label.toLocaleLowerCase().includes(needle) || item.file.toLocaleLowerCase().includes(needle))
    .map(item => ({ ...item, pending: choice === item.path }))
  return <Dialog variant="sheet" open={open} title={t('profile.sheet.title', { name: profileName, noun })} onClose={() => { if (!unresolved) onCancel() }}>
    <p className="ws-note">{t('profile.sheet.note', { name: profileName, noun })}</p>
    <div className="pr-sheet-preview">{chosen
      ? <AssetPreview key={chosen.path} kind={kind} reference={chosen} profilePath={profilePath} assets={assets} onStatus={status => setReady(status === 'ready')} />
      : <div className="ws-preview-large">{t('profile.resource.chooseHint', { noun })}</div>}</div>
    {installed ? null : <div className="cx-picker-source"><span className="ws-path">{directory || t('profile.resource.dirPlaceholder')}</span><Button variant="ghost" disabled={loading || unresolved} onClick={() => void browse()}>{isDemo ? t('profile.sheet.browseDemo') : t('audio.locate.chooseFolder')}</Button></div>}
    {onPickFile ? <div className="cx-picker-source"><Button variant="ghost" disabled={loading || importing || unresolved} onClick={() => void importer.pick(lang)}>{t('scheme.addTheme')}</Button></div> : null}
    {importPath ? <ImportSheet key={importPath} kind="theme" sourcePath={importPath} directory={directory || defaultDirectory || t('profile.resource.dirPlaceholder')}
      installed={(installed ?? []).map(item => ({ name: item.label === item.file ? null : item.label, file: item.file }))} assets={assets} busy={importing} error={importError}
      preview={<AssetPreview kind={kind} reference={{ name: importFileName(importPath), path: importPath }} profilePath={profilePath} assets={assets} />}
      onAdd={importer.add} onClose={importer.closeImport} /> : null}
    {unresolved ? <Notice tone="warning"><p>{msg(error ?? { key: 'scheme.error.importUnknown' })}</p>
      <p><Button variant="primary" disabled={reconciling || !onReconcile} onClick={() => void importer.reconcile()}>{reconciling ? t('scheme.status.loading') : t('scheme.reconcile')}</Button></p></Notice> : <>
    <SearchBox id={`sheet-search-${kind}`} label={t('scheme.search.label')} placeholder={t('scheme.search.placeholder')}
      clearLabel={t('scheme.clearSearch')} value={search} onChange={next => { setSearch(next); setPage(0) }} />
    {loading ? <p role="status">{t('profile.resource.loading')}</p> : null}
    {error ? <Notice tone="error"><p>{msg(error)}</p></Notice> : null}
    {fileErrors.length ? <Notice tone="warning"><details><summary>{t(plural(fileErrors.length, 'profile.resource.fileErrorsSummary'), { count: fileErrors.length })}</summary>{fileErrors.map((item, index) => <p key={index}>{t('profile.listErrors.item', { file: item.fileName, message: msg(item.message) })}</p>)}</details></Notice> : null}
    <div className="pr-sheet-list" role="radiogroup" aria-label={t('profile.resource.filesAria', { noun })}>
      {installed ? null : listed.map(file => <label className="pr-sheet-row" key={file.path}><input type="radio" name={`sheet-${kind}`} checked={choice === file.path} disabled={unresolved} onChange={() => { setReady(false); setChoice(file.path) }} />
        <span><strong>{file.name}</strong><small>{file.path}</small></span>
        {value?.path === file.path ? <Tag kind="saved">{t('profile.resource.currentRefTag')}</Tag> : null}{choice === file.path && value?.path !== file.path ? <Tag kind="temporary" /> : null}</label>)}
    </div>
    {installed ? <Tiles choices={tiles} page={page} pageSize={6} countKey="scheme.pagination.count" disabled={unresolved}
      ariaLabel={item => t('scheme.tile.previewLabel', { label: item.label })}
      thumb={item => <AssetPreview key={item.path} kind={kind} reference={{ name: item.label, path: item.path }} profilePath={profilePath} assets={assets} />}
      onPage={setPage}
      favorites={fav.enabled ? {
        isFavorite: item => fav.isFavorite(item.file),
        label: item => t('favorites.star', { label: item.label }),
        onToggle: item => { void fav.toggle(item.file, (installed ?? []).map(entry => entry.file)).then(failure => { if (failure) setError(failure) }) },
      } : undefined}
      onChoose={item => { setReady(true); setChoice(item.path) }} /> : null}
    {installed?.length && needle && !tiles.length ? <p className="ws-note">{t('scheme.search.noMatch', { query: search.trim() })}</p> : null}
    </>}
    <div className="ki-dialog-actions"><span className="ws-note">{unchanged ? t('profile.sheet.unchanged') : chosen ? t('profile.resource.tempChosen', { name: chosen.name }) : t('profile.resource.chooseHint', { noun })}</span>
      <Button data-safe-focus disabled={unresolved} onClick={onCancel}>{t('import.cancel')}</Button>
      <Button variant="primary" disabled={!confirmable || unresolved} onClick={() => { if (chosen) onConfirm(chosen) }}>{t('profile.sheet.confirm')}</Button></div>
  </Dialog>
}
