import type { ReactNode } from 'react'
import { Button } from '../installer/components/Button'
import { Tag } from './ui'
import { plural, useT } from '../i18n'

/**
 * The grid of previewed choices a section shows: a thumbnail, the tags that say what a choice
 * already is, and the name under it.
 *
 * It lives here because Profile shows the same grid. A combination is built by looking at the
 * same things the section shows, so a player recognises them; the only difference is what a
 * click means. On a section page it stages a change to the game. Inside Profile it records a
 * reference and changes nothing until the Profile is applied.
 */
export interface TileChoice {
  /** Identifies the tile and survives a refresh: the file name, not the display name. */
  file: string
  /** What the player reads. */
  label: string
  /** The line under the label — usually the file name, or why the file could not be read. */
  detail: string
  path: string
  selectable: boolean
  /** Shown when the tile cannot be chosen, explaining why. */
  reason?: string | undefined
  /** Already in use in the game. */
  current?: boolean
  /** Staged, or recorded in the draft. */
  pending?: boolean
  /** Its display name collides with another file's. */
  duplicate?: boolean
}

export function Tiles({ choices, page, pageSize, ariaLabel, thumb, onPage, onChoose, disabled = false, countKey, empty }: {
  choices: TileChoice[]
  page: number
  pageSize: number
  /** How one tile names itself to a screen reader, e.g. `label => t('scheme.tile.previewLabel', { label })`. */
  ariaLabel: (choice: TileChoice) => string
  /** The thumbnail for a readable choice; an unreadable one gets its `detail` instead. */
  thumb: (choice: TileChoice) => ReactNode
  onPage: (page: number) => void
  onChoose: (choice: TileChoice) => void
  disabled?: boolean
  /** A plural message key for "N items", counted over every choice, not just this page. */
  countKey: Parameters<ReturnType<typeof useT>>[0]
  empty?: ReactNode
}) {
  const t = useT()
  const lastPage = Math.max(0, Math.ceil(choices.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  return <>
    <div className="ws-grid">
      {choices.slice(current * pageSize, current * pageSize + pageSize).map(choice =>
        <button type="button" className="ws-tile" key={choice.file} aria-pressed={choice.pending ?? false}
          aria-label={ariaLabel(choice)} disabled={disabled || !choice.selectable} title={choice.reason}
          onClick={() => onChoose(choice)}>
          {thumb(choice)}
          <span className="ws-tile-tags">
            {choice.current ? <Tag kind="current" /> : null}
            {choice.pending ? <Tag kind="pending" /> : null}
            {choice.duplicate ? <Tag kind="duplicate" /> : null}
          </span>
          <span className="ws-tile-copy"><strong>{choice.label}</strong><small>{choice.detail}</small></span>
        </button>)}
    </div>
    {!choices.length && empty ? empty : null}
    <div className="pr-pagination">
      <span>{t(plural(choices.length, countKey), { count: choices.length })}</span>
      {lastPage > 0 ? <div>
        <Button disabled={current === 0} onClick={() => onPage(current - 1)}>{t('scheme.pagination.prev')}</Button>
        <span>{current + 1} / {lastPage + 1}</span>
        <Button disabled={current === lastPage} onClick={() => onPage(current + 1)}>{t('scheme.pagination.next')}</Button>
      </div> : null}
    </div>
  </>
}
