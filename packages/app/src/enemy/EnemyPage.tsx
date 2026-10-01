import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useReloadOnChange } from '../section/use-reload-on-change'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { StatusStrip, Tag, Toast, useToast } from '../ui/status'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import type { EnemySkin, EnemySkinChoice } from '../bridge/contracts'
import { useMsg, useT } from '../i18n'
import { createEnemyController, ENEMY_SHAPES, ENEMY_SHAPE_KEYS, type EnemyBridge } from './controller'
import { LocatePanel } from '../section/LocatePanel'
import { TabRow } from '../ui/TabRow'
import './enemy.css'

function choiceLabel(choice: EnemySkinChoice, skins: EnemySkin[]): string {
  const row = skins.find(skin => skin.model === choice.model && skin.skin === choice.skin)
  return row ? row.label : `${choice.model} · ${choice.skin}`
}

export function EnemyPage({ bridge, isDemo = false, isActive = true, section, onSelect, fileDrops = noFileDrops, changeStamp = 0 }: {
  bridge: EnemyBridge
  isDemo?: boolean
  isActive?: boolean
  /** Bumped by the workspace when Quick import or a restore changed the game; the list is read again when this page is next shown. */
  changeStamp?: number
  section: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  /** Files dragged in from outside the app. The Enemy section never accepts one. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const msg = useMsg()
  const controller = useMemo(() => createEnemyController(bridge), [bridge])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const { toast, tone, hide, show } = useToast(state.message ? msg(state.message) : null)
  useEffect(() => { if (isActive && state.phase === 'idle') void controller.load() }, [isActive, controller, state.phase])
  useReloadOnChange(changeStamp, isActive, state, controller.load)
  const locked = state.applying || state.unresolved || state.phase === 'locating' || state.phase === 'loading'
  const dropHint = useFileDrop(fileDrops, { section: 'enemy', active: isActive, busy: locked, onRefused: show, onFile: () => show(t('enemy.dropRefused')) })
  if (!isActive) return null
  const ready = state.phase === 'ready'
  const currentChoice = state.current[state.shape]
  const pendingChoice = state.selected[state.shape] ?? null
  const pendingDiffers = pendingChoice !== null
  const workingChoice = pendingChoice ?? currentChoice
  const shapeSkins = state.skins.filter(skin => skin.shapes.includes(state.shape))
  const shapeLabel = t(ENEMY_SHAPE_KEYS[state.shape])
  const others = controller.pendingShapes().filter(shape => shape !== state.shape)
  const overlays = <Toast message={toast} tone={tone} onDone={hide} />
  const actions = !ready ? undefined : state.unresolved
    ? <><Button disabled>{t('enemy.discard')}</Button><Button variant="primary" onClick={() => void controller.reconcile()}>{t('enemy.reconcile')}</Button></>
    : <><Button disabled={!pendingDiffers || state.applying} onClick={() => controller.close()}>{t('enemy.discard')}</Button>
      <Button variant="primary" disabled={!pendingDiffers || state.applying} onClick={() => void controller.apply()}>{state.applying ? t('enemy.applying') : t('enemy.apply')}</Button></>
  const actionNote = state.applying ? t('enemy.note.applying')
    : state.unresolved ? t('enemy.note.unresolved')
    : others.length ? t('enemy.note.withOthers', { label: shapeLabel, others: others.map(shape => t(ENEMY_SHAPE_KEYS[shape])).join(t('enemy.listSeparator')) })
    : pendingDiffers ? t('enemy.note.pending', { label: shapeLabel })
    : t('enemy.note.default', { label: shapeLabel })
  return (
    <WorkspaceShell overlays={overlays} dropHint={dropHint} active={section} onSelect={onSelect} isDemo={isDemo}
      eyebrow={t('enemy.eyebrow')} title={t('enemy.title')} scope={t('enemy.scope')}
      actions={actions} actionNote={ready ? actionNote : undefined}>
      {state.unresolved ? <Notice tone="warning"><p>{state.error ? msg(state.error) : t('enemy.notice.unresolvedFallback')}</p></Notice>
        : state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}

      {state.phase === 'locating' ? <p role="status">{t('enemy.status.locating')}</p> : null}
      {state.phase === 'loading' ? <p role="status">{t('enemy.status.loading')}</p> : null}
      <LocatePanel section="enemy" phase={state.phase} candidates={state.candidates} locked={locked} controller={controller} />

      {ready ? <>
        {/* One row of shape tabs; the selected shape's equipped pair is in the strip below.
            Each tab keeps its value and any pending pick in its accessible name, plus a dot. */}
        <TabRow prefix="em" label={t('enemy.tabs.ariaLabel')} selected={state.shape} locked={locked} onSelect={shape => controller.selectShape(shape)} tabs={ENEMY_SHAPES.map(shape => {
          const shapeCurrent = state.current[shape]
          const value = shapeCurrent === null ? t('enemy.tab.noBlock') : choiceLabel(shapeCurrent, state.skins)
          const pending = state.selected[shape] !== undefined
          return { key: shape, text: t(ENEMY_SHAPE_KEYS[shape]), pending,
            accessibleName: t('enemy.tab.status', { label: t(ENEMY_SHAPE_KEYS[shape]), value }) + (pending ? t('enemy.tab.pendingSuffix') : '') }
        })} />

        {currentChoice === null
          ? <Notice tone="warning"><p>{t('enemy.notice.missingBlock')}</p></Notice>
          : <>
            <StatusStrip current={choiceLabel(currentChoice, state.skins)}
              pending={pendingChoice ? choiceLabel(pendingChoice, state.skins) : null}
              aside={<><span>{t('enemy.backedUpFirst')}</span><Button variant="ghost" onClick={() => void controller.load()} disabled={locked}>{t('enemy.refresh')}</Button></>} />
            <ul className="em-skins" aria-label={t('enemy.list.ariaLabel')}>
              {shapeSkins.map(skin => {
                const isCurrent = currentChoice.model === skin.model && currentChoice.skin === skin.skin
                const isPressed = workingChoice !== null && workingChoice.model === skin.model && workingChoice.skin === skin.skin
                return <li key={`${skin.model}/${skin.skin}`}>
                  <button type="button" className="em-pick" aria-pressed={isPressed} disabled={locked}
                    onClick={() => controller.open(skin)}>
                    <span>{skin.label}</span>
                    {isCurrent ? <Tag kind="current" /> : isPressed ? <Tag kind="pending" /> : null}
                  </button>
                </li>
              })}
              {!shapeSkins.length ? <li className="ws-note">{t('enemy.empty.body')}</li> : null}
            </ul>
            {!state.skins.some(skin => skin.model === currentChoice.model && skin.skin === currentChoice.skin)
              ? <p className="ws-note">{t('enemy.status.unknownCurrent', { label: choiceLabel(currentChoice, state.skins) })}</p> : null}
          </>}
      </> : null}
    </WorkspaceShell>
  )
}
