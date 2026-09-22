import { useCallback, useEffect, useRef, useState } from 'react'
import { parseScheme } from '../../../core/src/scheme/document'
import { renderSchemePreview } from '../../../core/src/scheme/preview'
import { parseEnemyDocument } from '../../../core/src/enemy/model'
import { renderEnemySvg } from '../../../core/src/enemy/preview'
import { useLang, useMsg, useT, type Msg } from '../i18n'
import { errorMsg } from '../workspace/issue-text'
import { resolveProfileAssetPath, type ProfileFileReference } from './model'
import { assetMime, type AssetKind, type ProfileAssetBridge } from './assets'

type Status = 'loading' | 'ready' | 'error'
export interface AssetPreviewProps {
  kind: AssetKind
  reference: ProfileFileReference | null
  profilePath: string
  assets: ProfileAssetBridge
  onStatus?: (status: Status) => void
  /** What a reference-less preview says. Defaults to the bare 「保持当前」 tag word; a Profile
   * card passes the fuller sentence naming what stays unrecorded. */
  emptyLabel?: string
}
interface Preview { token: object; url: string; status: Status; message?: Msg | undefined }
export function AssetPreview({ kind, reference, profilePath, assets, onStatus, emptyLabel }: AssetPreviewProps) {
  const { lang } = useLang()
  const t = useT()
  const msg = useMsg()
  const callback = useRef(onStatus)
  callback.current = onStatus
  const current = useRef<object | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const audioSource = preview?.url
  const audioRef = useCallback((node: HTMLAudioElement | null) => {
    if (audio.current && audio.current !== node) {
      audio.current.pause()
      audio.current.removeAttribute('src')
      audio.current.load()
    }
    audio.current = node
    // React StrictMode replays detach/attach on the same DOM node. Detach must
    // unload real playback; attachment must restore the source that it removed.
    if (node && audioSource && node.getAttribute('src') !== audioSource) {
      node.src = audioSource
      node.load()
    }
  }, [audioSource])
  const finish = useRef<(status: Status, message?: Msg) => void>(() => {})
  const path = reference?.path ?? null
  useEffect(() => {
    const token = {}
    current.current = token
    let url: string | undefined
    let player: HTMLAudioElement | null = null
    let failed = false
    const release = () => {
      const media = player ?? audio.current
      if (media) { media.pause(); media.removeAttribute('src'); media.load() }
      if (url) { URL.revokeObjectURL(url); url = undefined }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (status: Status, message?: Msg) => {
      if (current.current !== token || failed) return
      if (status !== 'loading') clearTimeout(timer)
      if (status === 'error') { failed = true; release() }
      setPreview({ token, url: url ?? '', status, message })
      callback.current?.(status)
    }
    finish.current = update
    setPreview(null)
    if (path === null) { callback.current?.('ready'); return () => { current.current = null } }
    update('loading')
    timer = setTimeout(() => update('error', { key: 'profile.preview.error.timeout' }), 15000)
    void (async () => {
      try {
        const resolved = resolveProfileAssetPath(profilePath, path)
        let mime = assetMime(kind, resolved)
        const bytes = await assets.read(kind, resolved)
        if (current.current !== token || failed) return
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) { update('error', { key: 'profile.preview.error.tooLarge' }); return }
        let blob: Blob
        if (kind === 'scheme' || kind === 'enemy') {
          const svg = kind === 'scheme' ? renderSchemePreview(parseScheme(bytes), lang) : renderEnemySvg({}, parseEnemyDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).appearance, {}, lang)
          mime = 'image/svg+xml'
          blob = new Blob([svg], { type: mime })
        } else {
          if (kind === 'crosshair' && ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) { update('error', { key: 'profile.preview.error.invalidPng' }); return }
          blob = new Blob([new Uint8Array(bytes)], { type: mime })
        }
        url = URL.createObjectURL(blob)
        update('loading')
      } catch (reason) { update('error', errorMsg(reason, { key: 'profile.preview.error.generic' })) }
    })()
    return () => { current.current = null; clearTimeout(timer); player = audio.current; release() }
  }, [kind, path, profilePath, assets, lang])
  if (!reference) return <div className="pr-preview pr-preview-empty">{emptyLabel ?? t('common.tag.keep')}</div>
  const valid = preview?.token === current.current
  const status = valid ? preview.status : 'loading'
  const active = (token: object) => current.current === token
  return <div className={`pr-preview pr-preview-${kind}`} aria-busy={status === 'loading'}>
    {status === 'loading' && <p role="status">{t('profile.preview.loading')}</p>}
    {status === 'error' && <p role="alert">{preview?.message ? msg(preview.message) : null}</p>}
    {valid && preview.url && (kind === 'audio'
      ? <audio key={preview.url} ref={audioRef} src={preview.url} controls preload="auto" aria-label={t('profile.preview.audio.aria', { name: reference.name })} onCanPlay={() => { if (active(preview.token)) finish.current('ready') }} onError={() => { if (active(preview.token)) finish.current('error', { key: 'profile.preview.error.audioDecode' }) }} />
      : <img key={preview.url} src={preview.url} alt={t('profile.preview.image.alt', { name: reference.name })} style={kind === 'crosshair' ? { width: 'auto', height: 'auto', maxWidth: '100%', imageRendering: 'pixelated' } : { width: '100%', height: 'auto' }} onLoad={event => {
        if (!active(preview.token)) return
        const image = event.currentTarget
        finish.current(image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth <= 8192 && image.naturalHeight <= 8192 ? 'ready' : 'error', { key: 'profile.preview.error.imageDimensions' })
      }} onError={() => { if (active(preview.token)) finish.current('error', { key: 'profile.preview.error.imageDecode' }) }} />)}
    {(kind === 'scheme' || kind === 'enemy') && <p className="pr-preview-caption">{t(kind === 'scheme' ? 'profile.preview.caption.scheme' : 'profile.preview.caption.enemy')}</p>}
  </div>
}
