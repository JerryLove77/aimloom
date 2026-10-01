import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FavoritesStore } from '../section/favorites'
import { Button } from '../ui/Button'
import { WorkspaceShell } from '../workspace/WorkspaceShell'
import type { WorkspaceSection } from '../workspace/WorkspaceShell'
import { Dialog } from '../ui/Dialog'
import { Notice } from '../ui/Notice'
import { TargetMark } from '../ui/Icon'
import { createProfileEditor, type ProfileComponent, type ProfileEditor } from './editor'
import type { ProfileBridge } from '../bridge/profiles'
import type { ProfileAssetBridge } from '../bridge/assets'
import { ResourceSheet } from './ResourceSheet'
import { AudioSheet } from './AudioSheet'
import { ApplyDialog } from './ApplyDialog'
import { createApplyController, type ApplyBridge } from './apply-controller'
import { Tag, Toast, useToast } from '../ui/status'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { gameAssetFolder, resolveGameRoot, type GameRootStorage } from '../section/game-root'
import type { TileChoice } from '../ui/Tiles'
import { AUDIO_EVENTS, type AudioList, type SchemeList } from '../bridge/contracts'
import { browserStorage } from '../i18n'
import { plural, useLang, useMsg, useT, type Lang, type MessageKey } from '../i18n'
import { resolveProfileAssetPath, type ProfileAudio, type ProfileFileReference, type TrainingProfile } from './model'
import { profileInUse, readCurrentGame, snapshotFromGame, type CurrentGame } from './current-game'
import { describeAudio, describeEvent, describeTheme, eventLabel } from './describe'
import { AssetPreview } from './AssetPreview'
import { addFileToGame, type FileAddOutcome, type FileImportInput } from '../section/file-import'
import type { FileAddKind, PlanFileAddRequest } from '../bridge/contracts'
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

const labelKeys: Record<ProfileComponent, MessageKey> = { theme: 'profile.label.scheme', audio: 'profile.label.audio' }
const subtitleKeys: Record<ProfileComponent, MessageKey> = { theme: 'profile.subtitle.scheme', audio: 'audio.title' }
// The same nouns lowercased, for the sentence in profile.slot.unchosenDetail.
const nounKeys: Record<ProfileComponent, MessageKey> = { theme: 'profile.subtitle.schemeNoun', audio: 'audio.noun' }
const components: ProfileComponent[] = ['theme', 'audio']
/** A component as the player reads it: the recorded names, or 「未选择」 in an unfinished draft. */
function summary(profile: TrainingProfile, kind: ProfileComponent, t: ReturnType<typeof useT>) {
  return kind === 'audio' ? describeAudio(profile.audio, t) : describeTheme(profile.theme, t)
}
/** Whether a draft still lacks this part: no theme, or a sound event not chosen yet. */
function unchosen(profile: TrainingProfile, kind: ProfileComponent): boolean {
  return kind === 'theme' ? profile.theme === null : AUDIO_EVENTS.some(event => profile.audio[event] === undefined)
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
  launchGame: async () => { throw new Error('no game bridge') },
}

export function ProfilesApp({ bridge, assets, favorites, isDemo = false, isActive = true, onSelectSection, onDirtyChange, fileDrops = noFileDrops, locate, storage = browserStorage() }: {
  bridge: ProfileBridge; assets: ProfileAssetBridge; isDemo?: boolean; isActive?: boolean; onSelectSection?: ((section: WorkspaceSection) => void) | undefined; onDirtyChange?: ((dirty: boolean) => void) | undefined
  /**
   * Reads what is installed in the game, so a sheet shows the same previewed choices the
   * section shows. Profile records a reference and writes nothing; the switch happens when the
   * Profile is applied.
   */
  locate?: ProfileGameBridge | undefined
  storage?: GameRootStorage
  /** The starred themes and sounds, listed first in the theme and sound sheets. */
  favorites?: FavoritesStore | undefined
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
  /** Which of the apply dialog's two buttons is running, so only that one shows a working label. */
  const [applyIntent, setApplyIntent] = useState<'apply' | 'launch' | null>(null)
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
  // What the game has now, read each time the page is shown and after an apply, since the other
  // four pages change it: a new Profile starts from it and 当前使用 compares against it.
  const [currentGame, setCurrentGame] = useState<CurrentGame | null>(null)
  const [currentStamp, setCurrentStamp] = useState(0)
  useEffect(() => {
    if (!isActive || !gameRoot || !locate) return
    let live = true
    void readCurrentGame(locate, gameRoot).then(found => { if (live) setCurrentGame(found) }).catch(() => {})
    return () => { live = false }
  }, [isActive, gameRoot, locate, currentStamp])
  useEffect(() => {
    const kind = sheet === 'theme' ? 'scheme' as const : null
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
  // `unknown` is never success: the operationId of an unresolved add is kept here so 核对结果
  // can reconcile the very same operation, exactly as `installer_reconcile` requires. Only one
  // Profile sheet is ever open at a time, so one slot is enough.
  const pendingImportOp = useRef<string | null>(null)
  // A sheet's own unresolved add locks the whole Profile page -- navigation, save and further
  // adds -- until reconciled, the same as an unresolved section page locks itself.
  const [importUnresolved, setImportUnresolved] = useState(false)
  async function addFile(kind: FileAddKind, input: FileImportInput): Promise<FileAddOutcome> {
    if (!locate || !gameRoot) return { kind: 'refused', message: { key: 'profile.sheet.error.generic' } }
    const operationId = crypto.randomUUID()
    const outcome = await addFileToGame(locate, operationId, { gameRoot, kind, ...input, revision: ++fileImportRevision.current })
    if (outcome.kind === 'unknown') { pendingImportOp.current = operationId; return outcome }
    // The game's own installed list (`installed`) is fetched once per sheet opening and cached;
    // forcing it back to null makes the existing effect re-read it, same as a fresh open would.
    if (kind === 'theme' && outcome.kind === 'added') setInstalled(null)
    return outcome
  }
  /** Reconciles the pending add's own operationId -- the only exit from `unknown`. */
  async function reconcileImport(): Promise<void> {
    if (!locate || !pendingImportOp.current) return
    await locate.reconcile(pendingImportOp.current)
    pendingImportOp.current = null
  }
  const { toast, tone, hide, show } = useToast(null)
  const dropHint = useFileDrop(fileDrops, { section: 'profile', active: isActive && sheet === null && deleting === null, busy: false, onFile: () => {}, onRefused: show })
  // Decision D: quitting with a draft exits with no save and no prompt, so there is no
  // beforeunload guard here.
  const matches = state.library.filter(p => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const lastPage = Math.max(0, Math.ceil(matches.length / 12) - 1)
  const activePage = Math.min(page, lastPage)
  const applyLocked = applyState.phase === 'applying' || applyState.phase === 'unresolved'
  const locked = state.saving || state.reading || state.busyId !== null || applyLocked || importUnresolved
  const basePath = state.filePath ?? `${state.directory ?? '/profiles'}/${state.draft?.id ?? 'draft'}.json`
  if (!isActive) return null
  async function save() {
    const name = state.draft?.name ?? t('profile.draft.fallbackName')
    if (await editor.save()) { setNotice(t('profile.saved.notice', { name })); setSheet(null) }
    else if (editor.getState().nameError) nameInput.current?.focus()
  }
  async function applyConfirm() {
    const name = applyState.profile?.name ?? t('profile.draft.fallbackName')
    setApplyIntent('apply')
    const outcome = await applyController.confirm(false)
    setApplyIntent(null)
    if (outcome === 'completed' || outcome === 'no-change') { setNotice(t('profile.apply.done', { name })); setCurrentStamp(n => n + 1) }
  }
  /**
   * Runs the identical apply -- `confirm(true)` asks the controller to launch the game only
   * once that apply itself finished with `completed`/`no-change`. A failed or refused apply
   * launches nothing and shows the same error path `applyConfirm` shows.
   */
  async function applyConfirmAndLaunch() {
    const name = applyState.profile?.name ?? t('profile.draft.fallbackName')
    setApplyIntent('launch')
    const outcome = await applyController.confirm(true)
    setApplyIntent(null)
    if (outcome === 'completed' || outcome === 'no-change') { setNotice(t('profile.apply.doneAndLaunching', { name })); setCurrentStamp(n => n + 1) }
  }
  async function applyReconcile() {
    if (await applyController.reconcile()) setNotice(t('profile.apply.reconciled'))
  }
  return (<WorkspaceShell dropHint={dropHint} overlays={<>
    <Toast message={toast} tone={tone} onDone={hide} />
    <Dialog open={deleting !== null} title={t('profile.delete.title')} onClose={() => { if (!state.busyId) setDeleting(null) }}><p>{t('profile.delete.confirm', { name: deleting?.name ?? '' })}</p>{state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}<div className="ki-dialog-actions"><Button data-safe-focus disabled={!!state.busyId} onClick={() => setDeleting(null)}>{t('import.cancel')}</Button><Button variant="danger" disabled={!!state.busyId} onClick={() => { if (deleting) void editor.deleteProfile(deleting.id).then(ok => { if (ok) { setDeleting(null); setNotice(t('profile.delete.done')) } }) }}>{state.busyId ? t('profile.delete.working') : t('profile.delete.button')}</Button></div></Dialog>
    {state.draft && sheet === 'audio' ? <AudioSheet open profileName={state.draft.name || t('profile.draft.fallbackName')} profilePath={basePath}
      value={state.draft.audio} assets={assets} isDemo={isDemo} defaultDirectory={gameRoot ? gameAssetFolder('audio', gameRoot) : null} favorites={favorites}
      onAddFile={locate && gameRoot ? input => addFile('sound', input) : undefined}
      onPickFile={locate ? lang => locate.pickFile('sound', lang) : undefined}
      onReconcile={locate ? reconcileImport : undefined}
      onUnresolvedChange={setImportUnresolved}
      onConfirm={value => { if (editor.setComponent('audio', value)) setSheet(null) }} onCancel={() => setSheet(null)} /> : null}
    {state.draft && sheet === 'theme' ? <ResourceSheet kind="scheme" open profileName={state.draft.name || t('profile.draft.fallbackName')} profilePath={basePath}
      value={state.draft.theme} assets={assets} isDemo={isDemo} defaultDirectory={gameRoot ? gameAssetFolder('scheme', gameRoot) : null} favorites={favorites}
      installed={!installedError && installed?.kind === 'scheme' ? installed.choices : null}
      onAddFile={locate && gameRoot ? input => addFile('theme', input) : undefined}
      onPickFile={locate ? lang => locate.pickFile('theme', lang) : undefined}
      onReconcile={locate ? reconcileImport : undefined}
      onUnresolvedChange={setImportUnresolved}
      onAdded={() => setInstalled(null)}
      onConfirm={value => { if (editor.setComponent('theme', value)) setSheet(null) }} onCancel={() => setSheet(null)} /> : null}
    <ApplyDialog state={applyState} current={currentGame} launching={applyIntent === 'launch'}
      onChooseGameRoot={root => void applyController.chooseGameRoot(root)}
      onChooseFolder={() => void applyController.chooseFolder(lang)}
      onConfirm={() => void applyConfirm()}
      onConfirmAndLaunch={() => void applyConfirmAndLaunch()}
      onCancel={() => applyController.close()}
      onReconcile={() => void applyReconcile()} />
    </>} active="profile" onSelect={onSelectSection ?? (() => setSheet(null))} isDemo={isDemo}
      eyebrow={t(state.draft ? 'profile.eyebrow.edit' : 'profile.eyebrow.library')}
      title={t(state.draft ? 'profile.title.edit' : 'profile.title.library')}
      scope={t(state.draft ? 'profile.scope.edit' : 'profile.scope.library')}
      headingRef={heading} demoNote={t('profile.demoNote')}
      titleExtra={state.draft && state.dirty ? <Tag kind="unsaved" /> : null}
      actions={state.draft ? <>
        <Button disabled={state.saving || importUnresolved} onClick={() => { editor.cancel(); setNotice(t('profile.cancelled.notice')) }}>{t('profile.cancelEdit')}</Button>
        <Button variant="primary" disabled={state.saving || importUnresolved || !state.dirty} onClick={() => void save()}>{state.saving ? t('profile.save.saving') : t('profile.save.button')}</Button></> : undefined}
      actionNote={state.draft ? (state.dirty ? t('profile.save.note', { file: basePath.split(/[\\/]/).pop() ?? '' }) : t('profile.save.disabledNote')) : undefined}>
        {notice && !state.draft ? <p role="status" className="pr-status">{notice}</p> : null}
        {state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}
        {state.reading ? <p role="status">{t('profile.reading')}</p> : null}
        {state.draft ? <form noValidate onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} onSubmit={event => { event.preventDefault(); if (state.dirty) void save() }}>
          <div className="pr-info">
            <div className="pr-name-field"><label htmlFor="profile-name">{t('profile.name.label')}</label><input ref={nameInput} id="profile-name" value={state.draft.name} onChange={e => editor.setName(e.target.value)} disabled={state.saving} aria-invalid={!!state.nameError} aria-describedby={state.nameError ? 'profile-name-error' : undefined} maxLength={128} />{state.nameError ? <p id="profile-name-error" className="pr-error">{msg(state.nameError)}</p> : null}</div>
            <div className="pr-json"><span className="ws-muted">{t('profile.savePath.label')}</span><span className="ws-path">{basePath}</span></div>
          </div>
          <h2 className="pr-section-title">{t('profile.contents.heading')}</h2>
          <div className="pr-slots">{components.map(kind => <Slot key={kind} kind={kind} profile={state.draft!} profilePath={basePath} assets={assets} onOpen={() => setSheet(kind)} />)}</div>
          <p className="ws-note">{t('profile.draft.persistNote')}</p>
        </form> : <>
          <div className="pr-library-toolbar"><div className="pr-search"><label className="pr-sr-only" htmlFor="profile-search">{t('profile.search.label')}</label><input id="profile-search" ref={searchInput} type="search" placeholder={t('profile.search.label')} value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />{search ? <Button variant="ghost" aria-label={t('crosshair.clearSearch')} onClick={() => { setSearch(''); setPage(0); searchInput.current?.focus() }}>×</Button> : null}</div><Button onClick={() => void editor.load()} disabled={locked || state.loading}>{t('scheme.refresh')}</Button><Button variant="primary" disabled={locked || state.loading} onClick={() => { setNotice(''); editor.create(t('profile.editor.defaultName'), snapshotFromGame(currentGame)) }}>{t('profile.new')}</Button></div>
          {state.listErrors.length ? <Notice tone="warning"><p>{t(plural(state.listErrors.length, 'profile.listErrors.summary'), { count: state.listErrors.length })}</p><details><summary>{t('profile.listErrors.viewFiles')}</summary>{state.listErrors.map((e, i) => <p key={i}>{t('profile.listErrors.item', { file: e.fileName, message: msg(e.message) })}</p>)}</details></Notice> : null}
          {state.loading ? <p role="status">{t('profile.library.loading')}</p> : null}
          <div className="pr-library" aria-busy={state.loading}>{matches.slice(activePage * 12, activePage * 12 + 12).map(profile => {
            const inUse = profileInUse(profile, currentGame)
            return <article className={`pr-profile-row${inUse ? ' pr-profile-row-current' : ''}`} key={profile.id}><div className="pr-profile-emblem" aria-hidden="true">◎</div><button className="pr-profile-title" type="button" disabled={locked} onClick={() => void editor.edit(profile.id)} aria-label={t('profile.edit.aria', { name: profile.name })}><div className="pr-profile-name"><strong>{profile.name}</strong>{inUse ? <Tag kind="current" /> : null}</div><span>{components.map(kind => t('profile.row.component', { label: t(labelKeys[kind]), summary: summary(profile, kind, t) })).join(t('profile.componentJoin'))}</span></button><div className="pr-row-actions">
              {/* The user (test 0.1.6-test.1): grey means in use, bright means it can be applied. */}
              <Button variant="ghost" disabled={locked || inUse} aria-label={inUse ? t('profile.apply.inUseAria', { name: profile.name }) : t('profile.apply.aria', { name: profile.name })} onClick={() => void applyController.open(profile)}>{inUse ? t('profile.apply.inUse') : t('profile.apply.button')}</Button><Button variant="ghost" disabled={locked} aria-label={t('profile.duplicate.aria', { name: profile.name })} onClick={() => void editor.duplicate(profile.id, name => t('profile.editor.copyName', { name }))}>{t('profile.duplicate.button')}</Button><Button variant="ghost" disabled={locked} aria-label={t('profile.delete.aria', { name: profile.name })} onClick={() => setDeleting(profile)}>{t('profile.delete.button')}</Button></div></article>
          })}{!state.loading && matches.length === 0 ? <div className="pr-empty"><span aria-hidden="true">◎</span><h2>{search ? t('profile.empty.title.search') : t('profile.empty.title.default')}</h2><p>{search ? t('profile.empty.body.search') : t('profile.empty.body.default')}</p></div> : null}</div>
          <div className="pr-pagination"><span>{t(plural(matches.length, 'profile.pagination.count'), { count: matches.length })}</span>{lastPage > 0 ? <div><Button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>{t('scheme.pagination.prev')}</Button><span>{activePage + 1} / {lastPage + 1}</span><Button disabled={activePage === lastPage} onClick={() => setPage(activePage + 1)}>{t('scheme.pagination.next')}</Button></div> : null}</div>
        </>}
    </WorkspaceShell>
  )
}

/**
 * One component of the draft, as a card that opens its chooser: a corner chip naming the card, a
 * preview filling the body, and the name on a bottom line. An orange outline (`pr-slot-recorded`)
 * marks a complete card; a part a new draft could not take from the game reads 「未选择」 in its
 * own text and tag, never by the outline colour alone.
 */
function Slot({ kind, profile, profilePath, assets, onOpen }: {
  kind: ProfileComponent; profile: TrainingProfile; profilePath: string; assets: ProfileAssetBridge; onOpen: () => void
}) {
  const t = useT()
  const theme = kind === 'theme' ? profile.theme : null
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    setMissing(false)
    if (!theme) return
    assets.read('scheme', resolveProfileAssetPath(profilePath, theme.path)).catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [theme, profilePath, assets])
  const open = unchosen(profile, kind)
  const noun = t(subtitleKeys[kind])
  const label = t(labelKeys[kind])
  // English section names already say what the subtitle says (Sounds / Sounds); show the label alone then.
  const subtitle = noun.toLocaleLowerCase().startsWith(label.toLocaleLowerCase()) ? null : noun
  const name = summary(profile, kind, t)
  const emptyBody = t('profile.slot.unchosenDetail', { noun: t(nounKeys[kind]) })
  return <button type="button" className={`pr-slot${open ? '' : ' pr-slot-recorded'}${missing ? ' pr-slot-missing' : ''}`} aria-label={subtitle ? t('profile.slot.aria', { label, noun: subtitle, detail: name }) : t('profile.slot.ariaLabelOnly', { label, detail: name })} onClick={onOpen}>
    <span className="pr-slot-head"><span className="pr-slot-kind">{label.toUpperCase()}</span><span className="pr-slot-tags">{open ? <Tag kind="missing">{t('profile.unchosen')}</Tag> : null}{missing ? <Tag kind="missing" /> : null}</span></span>
    <span className="pr-slot-body">{kind === 'theme'
      ? <AssetPreview kind="scheme" reference={theme} profilePath={profilePath} assets={assets} emptyLabel={emptyBody} />
      : <ul className="pr-slot-audio-list">{AUDIO_EVENTS.map(event => <li key={event}>{t('profile.eventSounds', { event: eventLabel(event, t), names: describeEvent(event, profile.audio, t) })}</li>)}</ul>}</span>
    <span className="pr-slot-foot"><strong>{name}</strong><span className="pr-slot-action" aria-hidden="true">{t('profile.slot.change')}</span></span>
  </button>
}
