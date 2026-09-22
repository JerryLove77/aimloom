import { useEffect, useRef, useState } from 'react'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { Tag } from '../workspace/ui'
import { plural, useLang, useMsg, useT, type Msg } from '../i18n'
import { errorMsg } from '../workspace/issue-text'
import { AssetPreview } from './AssetPreview'
import { AUDIO_EVENTS, MAX_AUDIO_FILES, type AudioEvent } from './audio/model'
import type { ProfileAudio, ProfileFileReference } from './model'
import type { ProfileAssetBridge } from './assets'

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
export function AudioSheet({ profileName, profilePath, value, assets, isDemo, open, defaultDirectory = null, onConfirm, onCancel }: {
  profileName: string
  profilePath: string
  value: ProfileAudio | null
  assets: ProfileAssetBridge
  isDemo: boolean
  open: boolean
  /** The game's own sounds folder, so the sheet opens on what is installed instead of empty. */
  defaultDirectory?: string | null
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
  useEffect(() => { if (open) { setTemp(structuredClone(value)); setEvent('kill'); setListen(null); setError(null); setFileErrors([]) } }, [open, value])
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
  return <Dialog variant="sheet" open={open} title={t('profile.sheet.title', { name: profileName, noun: t('audio.noun') })} onClose={onCancel}>
    <p className="ws-note">{t('profile.sheet.note', { name: profileName, noun: t('audio.noun') })}</p>
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
    <div className="cx-picker-source"><span className="ws-path">{directory || t('profile.audioSheet.dirPlaceholder')}</span><Button variant="ghost" onClick={() => void browse()}>{isDemo ? t('profile.sheet.browseDemo') : t('audio.locate.chooseFolder')}</Button></div>
    {error ? <Notice tone="error"><p>{msg(error)}</p></Notice> : null}
    {fileErrors.length ? <Notice tone="warning"><details><summary>{t(plural(fileErrors.length, 'profile.resource.fileErrorsSummary'), { count: fileErrors.length })}</summary>{fileErrors.map((item, index) => <p key={index}>{t('profile.listErrors.item', { file: item.fileName, message: msg(item.message) })}</p>)}</details></Notice> : null}
    <div className="pr-sheet-list">{files.map(file => <div className="pr-sheet-row" key={file.path}><span><strong>{file.name}</strong><small>{file.path}</small></span>
      {eventFiles?.some(item => item.path === file.path) ? <Tag kind="temporary">{t('audio.advanced.inList')}</Tag> : null}
      <Button aria-label={t('profile.audioSheet.addAria', { name: file.name })} disabled={(eventFiles?.length ?? 0) >= MAX_AUDIO_FILES} onClick={() => setEventFiles([...(eventFiles ?? []), file])}>{t('profile.audioSheet.add')}</Button></div>)}</div>
    <div className="ki-dialog-actions"><span className="ws-note">{changed ? t('common.tag.changed') : t('profile.sheet.unchanged')}</span>
      <Button data-safe-focus onClick={onCancel}>{t('import.cancel')}</Button>
      <Button variant="primary" disabled={!changed} onClick={() => onConfirm(temp)}>{t('profile.sheet.confirm')}</Button></div>
  </Dialog>
}
