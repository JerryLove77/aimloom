import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { Toast, useToast } from '../ui/status'
import { SettingsState, WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { LocatePanel } from '../section/LocatePanel'
import { plural, useLang, useMsg, useT, type Lang, type MessageKey } from '../i18n'
import type { FileRow, Preview, SkipReason } from '../bridge/contracts'
import type { GameRootStorage } from '../section/game-root'
import { addedRows, createImportController, settingsRows, skippedRows, type ImportBridge, type ImportController, type ImportState } from './import-controller'
import './explore.css'

const KINDS = ['theme', 'sound', 'crosshair'] as const
/** Bar heights, in px, of the Sounds thumbnail's waveform. */
const WAVE = [10, 22, 34, 18, 28, 12, 24]
const REASONS: Record<SkipReason, MessageKey> = {
  'exists-same': 'quick.reason.existsSame', 'exists-different': 'quick.reason.existsDifferent', 'theme-name-taken': 'quick.reason.themeNameTaken',
  'sound-stem-taken': 'quick.reason.soundStemTaken', invalid: 'quick.reason.invalid', 'duplicate-in-drop': 'quick.reason.duplicate', 'settings-not-included': 'quick.reason.settingsNotIncluded',
}
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const SETTINGS = new Set(['ui', 'palette', 'primary'])

/** "12 themes, 30 sounds and 1 crosshair" — only the kinds the rows hold, in the page language. */
function countList(t: ReturnType<typeof useT>, lang: Lang, rows: FileRow[]): string {
  const count = (test: (row: FileRow) => boolean) => rows.filter(test).length
  const parts: [number, MessageKey][] = ([['themes', 'quick.count.themes'], ['sounds', 'quick.count.sounds'], ['crosshairs', 'quick.count.crosshairs']] as const)
    .map(([category, key]) => [count(r => r.category === category), key])
  parts.push([count(r => SETTINGS.has(r.category)), 'quick.count.settings'])
  const words = parts.filter(([n]) => n > 0).map(([n, key]) => t(plural(n, key), { count: n }))
  if (lang === 'zh') return words.join(t('quick.listSep'))
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? ''
}

/**
 * Explore (APP-NAV, v0.1.6; beta2): what a player gets from elsewhere. Quick import takes
 * whatever is dropped anywhere on this page, or picked with its two buttons, and shows one
 * summary of what will be added before 加进游戏. The website's explorer opens in the browser, and
 * 备份与恢复 opens the restore page.
 */
export function ExplorePage({ bridge, storage, isDemo = false, isActive = true, section, onSelect, onOpenRestore, fileDrops = noFileDrops }: {
  bridge: ImportBridge
  storage: GameRootStorage
  isDemo?: boolean
  isActive?: boolean
  section: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  /** Opens the backup and restore page. */
  onOpenRestore: () => void
  /** Files dragged in from outside the app: every drop on this page goes to Quick import. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const { lang } = useLang()
  const { openExplore } = useContext(SettingsState)
  const { toast, tone, hide, show } = useToast(null)
  // One controller for the page's life: it holds the lock on an unresolved add, which a cache
  // (useMemo) may not keep. The storage is read when it is made.
  const [controller] = useState(() => createImportController(bridge, storage))
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const locked = state.phase === 'adding' || state.unresolved
  const heading = useRef<HTMLHeadingElement>(null)
  const importing = state.phase !== 'idle'
  useEffect(() => { if (isActive) heading.current?.focus({ preventScroll: true }) }, [importing, isActive])
  const dropHint = useFileDrop(fileDrops, {
    section: 'explore', active: isActive, busy: locked, onRefused: show,
    onFile: path => void controller.choose([path]), onFiles: paths => void controller.choose(paths),
  })
  if (!isActive) return null
  const shell = { overlays: <Toast message={toast} tone={tone} onDone={hide} />, dropHint, active: section, onSelect, isDemo, headingRef: heading }
  if (!importing) return <WorkspaceShell {...shell} eyebrow={t('explore.eyebrow')} title={t('explore.title')} scope={t('explore.scope')}>
    <div className="ws-explore">
      <section className="ws-explore-card ws-explore-wide" aria-labelledby="ws-explore-quick">
        <h2 id="ws-explore-quick">{t('explore.quick.title')}</h2>
        <div className="ws-explore-art ws-explore-drop">
          <span className="ws-explore-files" aria-hidden="true"><span /><span /></span>
          <strong>{t('explore.quick.drop')}</strong>
          <span className="ws-explore-drop-note">{t('explore.quick.body')}</span>
          <div className="ws-explore-picks">
            <Button onClick={() => void controller.pick('files', lang)}>{t('explore.quick.pickFiles')}</Button>
            <Button onClick={() => void controller.pick('folder', lang)}>{t('explore.quick.pickFolder')}</Button>
          </div>
          <span className="ws-explore-drop-note">{t('explore.quick.unzip')}</span>
        </div>
      </section>
      <section className="ws-explore-card" aria-labelledby="ws-explore-web">
        <div className="ws-explore-art ws-explore-kinds" aria-hidden="true">
          {KINDS.map(kind => <span key={kind} className={`ws-explore-kind ws-explore-kind-${kind}`}>
            <i>{kind === 'sound' ? WAVE.map((height, index) => <b key={index} style={{ height }} />) : null}</i>
            <span>{t(`explore.web.kind.${kind}`)}</span>
          </span>)}
        </div>
        <h2 id="ws-explore-web">{t('explore.web.title')} <span className="ws-explore-host">aimloom.dev ↗</span></h2>
        <p>{t('explore.web.body')}</p>
        {/* Opening a browser is best effort, as for the explore links under each section's list. */}
        <div><Button onClick={() => { openExplore(lang, 'theme').catch(() => {}) }}>{t('explore.web.open')}</Button></div>
      </section>
      <section className="ws-explore-card" aria-labelledby="ws-explore-restore">
        <h2 id="ws-explore-restore">{t('explore.restore.title')}</h2>
        <p>{t('explore.restore.body')}</p>
        <div><Button onClick={onOpenRestore}>{t('explore.restore.open')}</Button></div>
      </section>
    </div>
  </WorkspaceShell>
  return <WorkspaceShell {...shell} eyebrow={t('quick.eyebrow')} title={t('quick.title')} scope={t('quick.scope')}
    titleExtra={<Button variant="ghost" disabled={locked} onClick={() => controller.reset()}>{t('quick.back')}</Button>}
    actions={<ImportActions state={state} controller={controller} />} actionNote={actionNote(state, t)}>
    <ImportView state={state} controller={controller} onSelect={onSelect} onOpenRestore={onOpenRestore} />
  </WorkspaceShell>
}

function actionNote(state: ImportState, t: ReturnType<typeof useT>): string {
  if (state.phase === 'ready' && addedRows(state.preview).length) return t('quick.note.backup')
  if (state.phase === 'done' && state.outcome?.batchId) return t('quick.note.undo')
  return ''
}

function ImportActions({ state, controller }: { state: ImportState; controller: ImportController }) {
  const t = useT()
  if (state.phase === 'done' && !state.unresolved) return <>
    <Button variant="ghost" onClick={() => controller.reset()}>{t('quick.more')}</Button>
    <Button variant="primary" onClick={() => controller.reset()}>{t('quick.finish')}</Button>
  </>
  const ready = state.phase === 'ready' && addedRows(state.preview).length > 0
  return <Button variant="primary" disabled={!ready} onClick={() => void controller.add()}>{t(state.phase === 'adding' ? 'quick.adding' : 'quick.add')}</Button>
}

function ImportView({ state, controller, onSelect, onOpenRestore }: { state: ImportState; controller: ImportController; onSelect: (section: WorkspaceSection) => void; onOpenRestore: () => void }) {
  const t = useT()
  const msg = useMsg()
  const { lang } = useLang()
  const names = state.paths.map(fileName)
  const sources = <p className="ws-quick-sources">
    {t(plural(state.paths.length, 'quick.sources'), { count: state.paths.length, names: names.slice(0, 3).join(t('quick.listSep')) + (names.length > 3 ? t('quick.sources.more') : '') })}
    {' '}<button type="button" className="ws-quick-link" disabled={state.phase === 'adding' || state.unresolved} onClick={() => void controller.pick('files', lang)}>{t('quick.chooseAgain')}</button>
  </p>
  const issue = state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null
  const message = state.message ? <Notice tone="success"><p>{msg(state.message)}</p></Notice> : null
  switch (state.phase) {
    case 'locating': case 'planning': return <div className="ws-quick">
      {sources}
      <section className="ws-quick-card" aria-busy="true"><h2 role="status">{t('quick.reading')}</h2><progress aria-label={t('quick.reading')} /><p>{t('quick.readOnly')}</p></section>
    </div>
    case 'needs-location': return <div className="ws-quick">
      {sources}{issue}
      <section className="ws-quick-card"><h2>{t('quick.locate.title')}</h2>
        <LocatePanel section="quick" phase="needs-location" candidates={state.candidates} locked={false}
          controller={{ chooseGameRoot: root => controller.chooseGameRoot(root), chooseFolder: lang => controller.chooseGameFolder(lang) }} /></section>
    </div>
    case 'blocked': return <div className="ws-quick">
      {sources}
      {state.blocked === 'game-running'
        ? <Notice tone="warning" title={t('quick.running.title')}><p>{t('quick.running.body')}</p><Button onClick={() => void controller.recheck()}>{t('quick.running.recheck')}</Button></Notice>
        : <Notice tone="error" title={t('quick.recovery.title')}><p>{t('quick.recovery.body')}</p><Button onClick={onOpenRestore}>{t('quick.recovery.open')}</Button></Notice>}
    </div>
    case 'error': return <div className="ws-quick">{sources}{issue}<div><Button onClick={() => void controller.recheck()}>{t('quick.retry')}</Button></div></div>
    case 'adding': return <div className="ws-quick">
      <section className="ws-quick-card" aria-busy="true">
        <h2 role="status">{state.progress?.completed != null && state.progress.total ? t('quick.progress', { completed: state.progress.completed, total: state.progress.total }) : t('quick.adding')}</h2>
        {state.progress?.completed != null && state.progress.total ? <progress max={state.progress.total} value={state.progress.completed} aria-label={t('quick.adding')} /> : <progress aria-label={t('quick.adding')} />}
        {state.progress?.currentFile ? <code>{state.progress.currentFile}</code> : null}
        <p>{t('quick.addingNote')}</p>
      </section>
    </div>
    case 'done': return <div className="ws-quick">
      {issue}{message}
      {state.unresolved ? <Notice tone="warning" title={t('quick.unresolved.title')}><p>{t('quick.unresolved.body')}</p><Button onClick={() => void controller.reconcile()}>{t('quick.checkResult')}</Button></Notice> : null}
      {state.outcome ? <Notice tone="success" title={t(plural(state.outcome.added.length, 'quick.done.title'), { count: state.outcome.added.length })}>
        <p>{t('quick.done.body', { list: countList(t, lang, state.outcome.added) })}</p>
      </Notice> : null}
      {state.outcome ? <div className="ws-quick-links">
        {(['theme', 'audio', 'crosshair'] as const).map(section => <button type="button" key={section} className="ws-quick-link" onClick={() => onSelect(section)}>{t(`quick.goto.${section}`)}</button>)}
      </div> : null}
      {state.preview ? <SkippedList preview={state.preview} open={false} /> : null}
    </div>
    case 'ready': return <ImportSummary state={state} controller={controller} sources={sources} issue={issue} />
    default: return null
  }
}

function ImportSummary({ state, controller, sources, issue }: { state: ImportState; controller: ImportController; sources: ReactNode; issue: ReactNode }) {
  const t = useT()
  const { lang } = useLang()
  const preview = state.preview!
  const added = addedRows(preview)
  const settings = settingsRows(preview)
  const [advanced, setAdvanced] = useState(state.includeSettings)
  return <div className="ws-quick">
    {sources}
    <p className="ws-quick-game">{t('quick.game', { path: preview.location.gameRoot })}</p>
    {issue}
    <section className="ws-quick-card" aria-labelledby="ws-quick-summary">
      <h2 id="ws-quick-summary">{added.length ? t('quick.summary.add', { list: countList(t, lang, added) }) : t('quick.summary.nothing')}</h2>
      {added.length ? null : <p>{t('quick.summary.nothingBody')}</p>}
      <SkippedList preview={preview} open={added.length === 0} />
    </section>
    {settings.length ? <section className="ws-quick-card ws-quick-advanced">
      <button type="button" className="ws-quick-toggle" aria-expanded={advanced} aria-controls="ws-quick-advanced" onClick={() => setAdvanced(!advanced)}>
        <span aria-hidden="true">{advanced ? '▾' : '▸'}</span><strong>{t('quick.advanced.title')}</strong>
        <span className="ws-muted">{t(plural(settings.length, 'quick.advanced.carries'), { count: settings.length })}</span>
      </button>
      {advanced ? <div id="ws-quick-advanced" className="ws-quick-advanced-body">
        <label className="ws-quick-check">
          <input type="checkbox" checked={state.includeSettings} onChange={e => void controller.setIncludeSettings(e.target.checked)} />
          {t('quick.advanced.include', { files: [...new Set(settings.map(r => fileName(r.key)))].join(t('quick.listSep')) })}
        </label>
        <Notice tone="warning" title={t('quick.advanced.warnTitle')}><p>{t('quick.advanced.warnBody')}</p></Notice>
      </div> : null}
    </section> : null}
  </div>
}

function SkippedList({ preview, open }: { preview: Preview; open: boolean }) {
  const t = useT()
  const msg = useMsg()
  const skipped = skippedRows(preview)
  const unrecognised = preview.skipped
  return <>
    {skipped.length ? <details className="ws-quick-list" open={open}>
      <summary>{t('quick.skipped')} <span className="ws-quick-count">{skipped.length}</span></summary>
      <ul>{skipped.map((row, index) => <li key={`${row.key}-${index}`}>
        <strong>{fileName(row.key)}</strong>
        <span>{row.reason === 'invalid' && row.detail ? msg({ zh: row.detail.message, en: row.detail.messageEn }) : row.reason ? t(REASONS[row.reason]) : ''}</span>
      </li>)}</ul>
    </details> : null}
    {unrecognised.length ? <details className="ws-quick-list">
      <summary>{t('quick.unrecognised')} <span className="ws-quick-count">{unrecognised.length}</span></summary>
      <ul>{unrecognised.map((path, index) => <li key={`${path}-${index}`}>
        <strong>{fileName(path)}</strong>
        <span>{t(/\.zip$/i.test(path) ? 'quick.unrecognised.zip' : 'quick.unrecognised.other')}</span>
      </li>)}</ul>
    </details> : null}
  </>
}
