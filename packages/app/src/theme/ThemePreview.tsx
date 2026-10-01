import { useEffect, useState } from 'react'
import { parseThemeDocument, renderThemePreview } from '@kvk/theme'
import type { ProfileAssetBridge } from '../bridge/assets'
import { useLang, useMsg, useT, type Msg } from '../i18n'
import { errorMsg } from '../section/issue-text'

/** Renders one installed theme as an offline SVG. Read-only: it never writes game files. */
export function ThemePreview({ path, name, assets, className }: {
  path: string; name: string; assets: ProfileAssetBridge; className?: string | undefined
}) {
  const { lang } = useLang()
  const t = useT()
  const msg = useMsg()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<Msg | null>(null)
  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    setUrl(null)
    setError(null)
    void (async () => {
      try {
        const bytes = await assets.read('theme', path)
        if (cancelled) return
        // No parse to blame here, so this stays the plain fallback: no appended detail.
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) { setError({ key: 'theme.preview.error' }); return }
        created = URL.createObjectURL(new Blob([renderThemePreview(parseThemeDocument(bytes), lang)], { type: 'image/svg+xml' }))
        setUrl(created)
      } catch (err) {
        // A core validation failure (LocalizedError) carries its own bilingual detail; errorMsg
        // surfaces it instead of the bare fallback, in whichever language the page is showing.
        if (!cancelled) setError(errorMsg(err, { key: 'theme.preview.error' }))
      }
    })()
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created) }
  }, [path, assets, lang])
  if (error) return <p className="sc-preview-error" role="alert">{msg(error)}</p>
  if (!url) return <p className="sc-preview-loading" role="status">{t('theme.preview.loading')}</p>
  return <img className={className} src={url} alt={t('theme.preview.alt', { name })} />
}
