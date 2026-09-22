import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '../installer/components/Button'
import { WorkspaceShell } from '../workspace/WorkspaceShell'
import type { WorkspaceSection } from '../workspace/WorkspaceShell'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { TargetMark } from '../installer/components/Icon'
import { createProfileEditor, type ProfileComponent, type ProfileEditor } from './editor'
import type { ProfileBridge } from './bridge'
import type { ProfileAssetBridge } from './assets'
import { ResourceSheet } from './ResourceSheet'
import { AudioSheet } from './AudioSheet'
import { ApplyDialog } from './ApplyDialog'
import { createApplyController, type ApplyBridge } from './apply-controller'
import { Tag, Toast, useToast } from '../workspace/ui'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { gameAssetFolder, resolveGameRoot, type GameRootStorage } from '../workspace/game-root'
import type { TileChoice } from '../workspace/Tiles'
import type { AudioList, SchemeList } from '../installer/contracts'
import { browserStorage } from '../i18n'
import { plural, useLang, useMsg, useT, type Lang, type MessageKey } from '../i18n'
import { resolveProfileAssetPath, type ProfileFileReference, type TrainingProfile } from './model'
import { readCurrentGame, type CurrentGame } from './current-game'
import { describeAudio, describeFile } from './describe'
import { addFileToGame, type FileAddOutcome, type FileImportInput } from '../workspace/file-import'
import type { FileAddKind, PlanFileAddRequest } from '../installer/contracts'
import './profiles.css'

/** Just enough of the installer bridge for Profile to show what the game already has, plus what applying a saved combination needs. */
export interface ProfileGameBridge extends ApplyBridge {
  schemeList(gameRoot: string): Promise<SchemeList>
  audioList(gameRoot: string): Promise<AudioList>
  /** The same byte-exact add-a-file plan the Theme and Sounds pages use, reused unchanged from inside a Profile sheet. */
  planFileAdd(input: PlanFileAddRequest): Promise<{ planId: string }>
  pickFile(kind: FileAddKind, lang: Lang): Promise<string | null>
}
/** A tile before the sheet marks which one is staged. */
export type InstalledChoice = Omit<TileChoice, 'pending'>

const labelKeys: Record<ProfileComponent, MessageKey> = { scheme: 'profile.label.scheme', audio: 'profile.label.audio' }
const subtitleKeys: Record<ProfileComponent, MessageKey> = { scheme: 'profile.subtitle.scheme', audio: 'audio.title' }
// The same nouns lowercased, for the sentence in profile.slot.noRecordDetail.
const nounKeys: Record<ProfileComponent, MessageKey> = { scheme: 'profile.subtitle.schemeNoun', audio: 'audio.noun' }
const components: ProfileComponent[] = ['scheme', 'audio']
/** A component as the player reads it: the recorded names, or what 「保持当前」 keeps right now. */
function summary(profile: TrainingProfile, kind: ProfileComponent, current: CurrentGame | null, t: ReturnType<typeof useT>) {
  return kind === 'audio' ? describeAudio(profile.audio, current, t) : describeFile(kind, profile[kind], current, t)
}
/**
 * Ruling (2026-09-21): scheme kept and every audio list empty or absent means there is
 * nothing for `planProfileApply` to write, so the UI disables 应用 rather than round-tripping to
 * the engine for a refusal it can already see.
 */
function nothingToApply(profile: TrainingProfile): boolean {
  if (profile.scheme !== null) return false
  if (!profile.audio) return true
  return Object.values(profile.audio).every(files => !files || files.length === 0)
}
/** Stands in for `locate` when the caller has none, so Apply always has a bridge to call into
 * even though its button stays disabled in that case (no game folder was ever wired in). */
const unavailableApplyBridge: ApplyBridge = {
  discover: async () => ({ candidates: [] }),
  locate: async () => { throw new Error('no game bridge') },
  pickFolder: async () => null,
  planProfileApply: async () => { throw new Error('no game bridge') },
  execute: async () => { throw new Error('no game bridge') },
  job: async () => { throw new Error('no game bridge') },
  reconcile: async () => { throw new Error('no game bridge') },
}

export function ProfilesApp({ bridge, assets, isDemo = false, onOpenInstaller, isActive = true, onSelectSection, onDirtyChange, fileDrops = noFileDrops, locate, storage = browserStorage() }: {
  bridge: ProfileBridge; assets: ProfileAssetBridge; isDemo?: boolean; onOpenInstaller?: (() => void) | undefined; isActive?: boolean; onSelectSection?: ((section: WorkspaceSection) => void) | undefined; onDirtyChange?: ((dirty: boolean) => void) | undefined
  /**
   * Reads what is installed in the game, so a sheet shows the same previewed choices the
   * section shows. Profile records a reference and writes nothing; the switch happens when the
   * Profile is applied.
   */
  locate?: ProfileGameBridge | undefined
  storage?: GameRootStorage
  /** Profile adds nothing to the game, so a dropped file only gets told which section takes it. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const msg = useMsg()
  const { lang } = useLang()
  const editor = useMemo(() => createProfileEditor(bridge), [bridge])
  const state = useSyncExternalStore(editor.subscribe, editor.getState, editor.getState)
  const applyController = useMemo(() => createApplyController(locate ?? unavailableApplyBridge, storage), [locate, storage])
  const applyState = useSyncExternalStore(applyController.subscribe, applyController.getState, applyController.getState)
  const [sheet, setSheet] = useState<ProfileComponent | null>(null)
  const [deleting, setDeleting] = useState<TrainingProfile | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { void editor.load() }, [editor])
  useEffect(() => { heading.current?.focus() }, [state.draft?.id])
  useEffect(() => { onDirtyChange?.(state.dirty) }, [state.dirty, onDirtyChange])
  // Decision A: leaving the section closes the sheet, discarding only its temporary choice.
  useEffect(() => { if (!isActive) setSheet(null) }, [isActive])
  // Leaving the section closes the apply dialog the same way -- except while it is applying or
  // unresolved, when `close()` is already a no-op, so an in-flight or unknown outcome keeps
  // locking this page exactly as a section locks itself for its own current-configuration write.
  useEffect(() => { if (!isActive) applyController.close() }, [isActive, applyController])
  // The folder the game keeps its files in, so a sheet opens on what is installed rather than
  // on an empty list with a "choose a folder" prompt. Best effort only: a failure here just
  // means the sheet opens the way it always did, and the player browses.
  const [gameRoot, setGameRoot] = useState<string | null>(null)
  useEffect(() => {
    if (!isActive || gameRoot || !locate) return
    let live = true
    void resolveGameRoot(locate, storage).then(found => { if (live) setGameRoot(found.gameRoot) }).catch(() => {})
    return () => { live = false }
  }, [isActive, gameRoot, locate, storage])
  // What the game already has, for the sheets to show. Best effort: if this cannot be read the
  // sheet falls back to browsing a folder, which is what it always did.
  const [installed, setInstalled] = useState<{ kind: 'scheme'; choices: InstalledChoice[] } | null>(null)
  const [installedError, setInstalledError] = useState(false)
  // What 「保持当前」 keeps, read from the game each time the page is shown and after an apply,
  // since the other four pages change it. Best effort: when it cannot be read the page shows the
  // bare 「保持当前」 it always did.
  const [currentGame, setCurrentGame] = useState<CurrentGame | null>(null)
  const [currentStamp, setCurrentStamp] = useState(0)
  useEffect(() => {
    if (!isActive || !gameRoot || !locate) return
    let live = true
    void readCurrentGame(locate, gameRoot).then(found => { if (live) setCurrentGame(found) }).catch(() => {})
    return () => { live = false }
  }, [isActive, gameRoot, locate, currentStamp])
  useEffect(() => {
    const kind = sheet === 'scheme' ? sheet : null
    if (!kind || !gameRoot || !locate || installed?.kind === kind) return
    let live = true
    setInstalledError(false)
    let read: Promise<InstalledChoice[]>
    try {
      read = locate.schemeList(gameRoot).then(list => list.themes.map((theme): InstalledChoice => ({
        file: theme.file,
        label: theme.name ?? theme.file,
        detail: theme.readable ? theme.file : t('scheme.tile.fileUnreadable'),
        path: theme.path,
        selectable: theme.readable && !theme.duplicateName,
        reason: !theme.readable ? t('scheme.tile.unreadable') : theme.duplicateName ? t('scheme.tile.duplicateTitle') : undefined,
        current: theme.readable && theme.name === list.current,
        duplicate: theme.duplicateName,
      })))
    } catch { setInstalledError(true); return }
    void read.then(choices => { if (live) setInstalled({ kind, choices }) })
      .catch(() => { if (live) setInstalledError(true) })
    return () => { live = false }
  }, [sheet, gameRoot, locate, installed, t])

  // Adding a file from a Profile sheet reuses the section pages' own byte-exact plan path
  // (`planFileAdd`), never a separate write. Each add gets a fresh operationId and a rising
  // revision, exactly like the Scheme and Audio controllers.
  const fileImportRevision = useRef(0)
  async function addFile(kind: FileAddKind, input: FileImportInput): Promise<FileAddOutcome> {
    if (!locate || !gameRoot) return { kind: 'refused', message: { key: 'profile.sheet.error.generic' } }
    const operationId = crypto.randomUUID()
    const outcome = await addFileToGame(locate, operationId, { gameRoot, kind, ...input, revision: ++fileImportRevision.current })
    // The game's own installed list (`installed`) is fetched once per sheet opening and cached;
    // forcing it back to null makes the existing effect re-read it, same as a fresh open would.
    if (kind === 'theme' && (outcome.kind === 'added' || outcome.kind === 'unknown')) setInstalled(null)
    return outcome
  }
  const { toast, tone, hide, show } = useToast(null)
  const dropHint = useFileDrop(fileDrops, { section: 'profile', active: isActive && sheet === null && deleting === null, busy: false, onFile: () => {}, onRefused: show })
  // Decision D: quitting with a draft exits with no save and no prompt, so there is no
  // beforeunload guard here.
  const matches = state.library.filter(p => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const lastPage = Math.max(0, Math.ceil(matches.length / 12) - 1)
  const activePage = Math.min(page, lastPage)
  const applyLocked = applyState.phase === 'applying' || applyState.phase === 'unresolved'
  const locked = state.saving || state.reading || state.busyId !== null || applyLocked
  const basePath = state.filePath ?? `${state.directory ?? '/profiles'}/${state.draft?.id ?? 'draft'}.json`
  if (!isActive) return null
  async function save() {
    const name = state.draft?.name ?? t('profile.draft.fallbackName')
    if (await editor.save()) { setNotice(t('profile.saved.notice', { name })); setSheet(null) }
    else if (editor.getState().nameError) nameInput.current?.focus()
  }
  async function applyConfirm() {
    const name = applyState.profile?.name ?? t('profile.draft.fallbackName')
    const outcome = await applyController.confirm()
    if (outcome === 'completed' || outcome === 'no-change') { setNotice(t('profile.apply.done', { name })); setCurrentStamp(n => n + 1) }
  }
  async function applyReconcile() {
    if (await applyController.reconcile()) setNotice(t('profile.apply.reconciled'))
  }
  return (<WorkspaceShell dropHint={dropHint} overlays={<>
    <Toast message={toast} tone={tone} onDone={hide} />
    <Dialog open={deleting !== null} title={t('profile.delete.title')} onClose={() => { if (!state.busyId) setDeleting(null) }}><p>{t('profile.delete.confirm', { name: deleting?.name ?? '' })}</p>{state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}<div className="ki-dialog-actions"><Button data-safe-focus disabled={!!state.busyId} onClick={() => setDeleting(null)}>{t('import.cancel')}</Button><Button variant="danger" disabled={!!state.busyId} onClick={() => { if (deleting) void editor.deleteProfile(deleting.id).then(ok => { if (ok) { setDeleting(null); setNotice(t('profile.delete.done')) } }) }}>{state.busyId ? t('profile.delete.working') : t('profile.delete.button')}</Button></div></Dialog>
    {state.draft && sheet === 'audio' ? <AudioSheet open profileName={state.draft.name || t('profile.draft.fallbackName')} profilePath={basePath}
      value={state.draft.audio} assets={assets} isDemo={isDemo} defaultDirectory={gameRoot ? gameAssetFolder('audio', gameRoot) : null}
      onAddFile={locate && gameRoot ? input => addFile('sound', input) : undefined}
      onPickFile={locate ? lang => locate.pickFile('sound', lang) : undefined}
      onConfirm={value => { if (editor.setComponent('audio', value)) setSheet(null) }} onCancel={() => setSheet(null)} /> : null}
    {state.draft && sheet && sheet !== 'audio' ? <ResourceSheet kind={sheet} open profileName={state.draft.name || t('profile.draft.fallbackName')} profilePath={basePath}
      value={state.draft[sheet]} assets={assets} isDemo={isDemo} defaultDirectory={gameRoot ? gameAssetFolder(sheet, gameRoot) : null}
      installed={!installedError && installed?.kind === sheet ? installed.choices : null}
      onAddFile={locate && gameRoot ? input => addFile('theme', input) : undefined}
      onPickFile={locate ? lang => locate.pickFile('theme', lang) : undefined}
      onAdded={() => setInstalled(null)}
      onConfirm={value => { if (editor.setComponent(sheet, value)) setSheet(null) }} onCancel={() => setSheet(null)} /> : null}
    <ApplyDialog state={applyState} current={currentGame}
      onChooseGameRoot={root => void applyController.chooseGameRoot(root)}
      onChooseFolder={() => void applyController.chooseFolder(lang)}
      onConfirm={() => void applyConfirm()}
      onCancel={() => applyController.close()}
      onReconcile={() => void applyReconcile()} />
    </>} active="profile" onSelect={onSelectSection ?? (() => setSheet(null))} isDemo={isDemo} locked={locked} onOpenInstaller={onOpenInstaller}
      eyebrow={t(state.draft ? 'profile.eyebrow.edit' : 'profile.eyebrow.library')}
      title={t(state.draft ? 'profile.title.edit' : 'profile.title.library')}
      scope={t(state.draft ? 'profile.scope.edit' : 'profile.scope.library')}
      headingRef={heading} demoNote={t('profile.demoNote')}
      titleExtra={state.draft && state.dirty ? <Tag kind="unsaved" /> : null}
      actions={state.draft ? <>
        <Button disabled={state.saving} onClick={() => { editor.cancel(); setNotice(t('profile.cancelled.notice')) }}>{t('profile.cancelEdit')}</Button>
        <Button variant="primary" disabled={state.saving || !state.dirty} onClick={() => void save()}>{state.saving ? t('profile.save.saving') : t('profile.save.button')}</Button></> : undefined}
      actionNote={state.draft ? (state.dirty ? t('profile.save.note', { file: basePath.split(/[\\/]/).pop() ?? '' }) : t('profile.save.disabledNote')) : undefined}>
        {notice && !state.draft ? <p role="status" className="pr-status">{notice}</p> : null}
        {state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}
        {state.reading ? <p role="status">{t('profile.reading')}</p> : null}
        {state.draft ? <form noValidate onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} onSubmit={event => { event.preventDefault(); if (state.dirty) void save() }}>
          <div className="pr-info">
            <div className="pr-name-field"><label htmlFor="profile-name">{t('profile.name.label')}</label><input ref={nameInput} id="profile-name" value={state.draft.name} onChange={e => editor.setName(e.target.value)} disabled={state.saving} aria-invalid={!!state.nameError} aria-describedby={state.nameError ? 'profile-name-error' : undefined} maxLength={128} />{state.nameError ? <p id="profile-name-error" className="pr-error">{msg(state.nameError)}</p> : null}</div>
            <div className="pr-json"><span className="ws-muted">{t('profile.savePath.label')}</span><span className="ws-path">{basePath}</span></div>
          </div>
          <h2 className="pr-section-title">{t('profile.contents.heading')} <small>{t('profile.contents.hint')}</small></h2>
          <div className="pr-slots">{components.map(kind => <Slot key={kind} kind={kind} profile={state.draft!} current={currentGame} profilePath={basePath} assets={assets} onOpen={() => setSheet(kind)} />)}</div>
          <p className="ws-note">{t('profile.draft.persistNote')}</p>
        </form> : <>
          <div className="pr-library-toolbar"><div className="pr-search"><label className="pr-sr-only" htmlFor="profile-search">{t('profile.search.label')}</label><input id="profile-search" ref={searchInput} type="search" placeholder={t('profile.search.label')} value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />{search ? <Button variant="ghost" aria-label={t('crosshair.clearSearch')} onClick={() => { setSearch(''); setPage(0); searchInput.current?.focus() }}>×</Button> : null}</div><Button onClick={() => void editor.load()} disabled={locked || state.loading}>{t('scheme.refresh')}</Button><Button variant="primary" disabled={locked || state.loading} onClick={() => { setNotice(''); editor.create(t('profile.editor.defaultName')) }}>{t('profile.new')}</Button></div>
          {state.listErrors.length ? <Notice tone="warning"><p>{t(plural(state.listErrors.length, 'profile.listErrors.summary'), { count: state.listErrors.length })}</p><details><summary>{t('profile.listErrors.viewFiles')}</summary>{state.listErrors.map((e, i) => <p key={i}>{t('profile.listErrors.item', { file: e.fileName, message: msg(e.message) })}</p>)}</details></Notice> : null}
          {state.loading ? <p role="status">{t('profile.library.loading')}</p> : null}
          <div className="pr-library" aria-busy={state.loading}>{matches.slice(activePage * 12, activePage * 12 + 12).map(profile => <article className="pr-profile-row" key={profile.id}><div className="pr-profile-emblem" aria-hidden="true">◎</div><button className="pr-profile-title" type="button" disabled={locked} onClick={() => void editor.edit(profile.id)} aria-label={t('profile.edit.aria', { name: profile.name })}><strong>{profile.name}</strong><span>{components.map(kind => t('profile.row.component', { label: t(labelKeys[kind]), summary: summary(profile, kind, currentGame, t) })).join(t('profile.componentJoin'))}</span></button><div className="pr-row-actions"><Button variant="ghost" disabled={locked || nothingToApply(profile)} title={nothingToApply(profile) ? t('profile.apply.disabledTitle') : undefined} aria-label={t('profile.apply.aria', { name: profile.name })} onClick={() => void applyController.open(profile)}>{t('profile.apply.button')}</Button><Button variant="ghost" disabled={locked} aria-label={t('profile.duplicate.aria', { name: profile.name })} onClick={() => void editor.duplicate(profile.id, name => t('profile.editor.copyName', { name }))}>{t('profile.duplicate.button')}</Button><Button variant="ghost" disabled={locked} aria-label={t('profile.delete.aria', { name: profile.name })} onClick={() => setDeleting(profile)}>{t('profile.delete.button')}</Button></div></article>)}{!state.loading && matches.length === 0 ? <div className="pr-empty"><span aria-hidden="true">◎</span><h2>{search ? t('profile.empty.title.search') : t('profile.empty.title.default')}</h2><p>{search ? t('profile.empty.body.search') : t('profile.empty.body.default')}</p></div> : null}</div>
          <div className="pr-pagination"><span>{t(plural(matches.length, 'profile.pagination.count'), { count: matches.length })}</span>{lastPage > 0 ? <div><Button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>{t('scheme.pagination.prev')}</Button><span>{activePage + 1} / {lastPage + 1}</span><Button disabled={activePage === lastPage} onClick={() => setPage(activePage + 1)}>{t('scheme.pagination.next')}</Button></div> : null}</div>
        </>}
    </WorkspaceShell>
  )
}

/** One component of the draft, as a row that opens its chooser. Read-only apart from the click. */
function Slot({ kind, profile, current, profilePath, assets, onOpen }: {
  kind: ProfileComponent; profile: TrainingProfile; current: CurrentGame | null; profilePath: string; assets: ProfileAssetBridge; onOpen: () => void
}) {
  const t = useT()
  const value = profile[kind]
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    setMissing(false)
    if (kind === 'audio' || !value) return
    const reference = value as ProfileFileReference
    assets.read(kind, resolveProfileAssetPath(profilePath, reference.path)).catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [kind, value, profilePath, assets])
  const keep = value === null
  const noun = t(subtitleKeys[kind])
  const label = t(labelKeys[kind])
  // English section names already say what the subtitle says (Sounds / Sounds); show the label alone then.
  const subtitle = noun.toLocaleLowerCase().startsWith(label.toLocaleLowerCase()) ? null : noun
  const file = summary(profile, kind, current, t)
  const detail = keep ? t('profile.slot.noRecordDetail', { noun: t(nounKeys[kind]) }) : kind === 'audio' ? t('profile.slot.audioDetail') : (value as ProfileFileReference).path
  return <button type="button" className={`pr-slot${missing ? ' pr-slot-missing' : ''}`} aria-label={subtitle ? t('profile.slot.aria', { label, noun: subtitle, detail: file }) : t('profile.slot.ariaLabelOnly', { label, detail: file })} onClick={onOpen}>
    <span className="pr-slot-kind">{subtitle ? t('profile.slot.kind', { label: label.toUpperCase(), noun: subtitle }) : label.toUpperCase()}</span>
    <strong>{file}</strong>
    <span className="ws-path">{missing ? t('profile.slot.missingDetail', { detail }) : detail}</span>
    <span className="pr-slot-tags">{keep ? <Tag kind="keep" /> : null}{missing ? <Tag kind="missing" /> : null}</span>
    <span className="pr-slot-action" aria-hidden="true">{t('profile.slot.change')}</span>
  </button>
}
