import type { ReactNode } from 'react'
import { Button } from './Button'
import { Tag } from './status'
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

/**
 * A star beside each tile (Theme and Profile's theme sheet). It is its own button, laid over the
 * tile's corner as a sibling (never a button inside a button), and never changes the selection.
 */
export interface TileFavorites {
  isFavorite(choice: TileChoice): boolean
  onToggle(choice: TileChoice): void
  /** The star's accessible name for one tile, e.g. `收藏「Clean Dark」`. */
  label(choice: TileChoice): string
}

export function Tiles({ choices, page, pageSize, ariaLabel, thumb, onPage, onChoose, disabled = false, countKey, empty, favorites }: {
  choices: TileChoice[]
  page: number
  pageSize: number
  /** How one tile names itself to a screen reader, e.g. `label => t('theme.tile.previewLabel', { label })`. */
  ariaLabel: (choice: TileChoice) => string
  /** The thumbnail for a readable choice; an unreadable one gets its `detail` instead. */
  thumb: (choice: TileChoice) => ReactNode
  onPage: (page: number) => void
  onChoose: (choice: TileChoice) => void
  disabled?: boolean
  /** A plural message key for "N items", counted over every choice, not just this page. */
  countKey: Parameters<ReturnType<typeof useT>>[0]
  empty?: ReactNode
  favorites?: TileFavorites | undefined
}) {
  const t = useT()
  const lastPage = Math.max(0, Math.ceil(choices.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  return <>
    <div className="ws-grid">
      {choices.slice(current * pageSize, current * pageSize + pageSize).map(choice => {
        const tile = <button type="button" className="ws-tile" key={choice.file} aria-pressed={choice.pending ?? false}
          aria-label={ariaLabel(choice)} disabled={disabled || !choice.selectable} title={choice.reason}
          onClick={() => onChoose(choice)}>
          {thumb(choice)}
          <span className="ws-tile-tags">
            {choice.current ? <Tag kind="current" /> : null}
            {choice.pending ? <Tag kind="pending" /> : null}
            {choice.duplicate ? <Tag kind="duplicate" /> : null}
          </span>
          <span className="ws-tile-copy"><strong>{choice.label}</strong><small>{choice.detail}</small></span>
        </button>
        // A file the game cannot read is nothing to come back to, so it gets no star.
        if (!favorites || !(choice.selectable || choice.duplicate)) return tile
        const on = favorites.isFavorite(choice)
        return <div className="ws-tile-wrap" key={choice.file}>
          {tile}
          <FavoriteStar on={on} label={favorites.label(choice)} onToggle={() => favorites.onToggle(choice)} className="ws-tile-star" />
        </div>
      })}
    </div>
    {!choices.length && empty ? empty : null}
    <div className="pr-pagination">
      <span>{t(plural(choices.length, countKey), { count: choices.length })}</span>
      {lastPage > 0 ? <div>
        <Button disabled={current === 0} onClick={() => onPage(current - 1)}>{t('theme.pagination.prev')}</Button>
        <span>{current + 1} / {lastPage + 1}</span>
        <Button disabled={current === lastPage} onClick={() => onPage(current + 1)}>{t('theme.pagination.next')}</Button>
      </div> : null}
    </div>
  </>
}

/** The star itself: `aria-pressed` says whether the file is a favourite. Shared by tiles and rows. */
export function FavoriteStar({ on, label, onToggle, className = '' }: { on: boolean; label: string; onToggle: () => void; className?: string }) {
  return <button type="button" className={`ws-star ${className}`} aria-pressed={on} aria-label={label} title={label} onClick={onToggle}>
    <span aria-hidden="true">{on ? '★' : '☆'}</span>
  </button>
}
