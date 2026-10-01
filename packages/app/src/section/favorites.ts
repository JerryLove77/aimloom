import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { Favorites, ProfileBridge } from '../bridge/profiles'
import type { Msg } from '../i18n'
import { createStore } from './controller'
import { errorMsg } from './issue-text'

/** Which list a star belongs to: Theme's theme files, or Sounds' sound files. */
export type FavoriteKind = keyof Favorites
export type FavoritesBridge = Pick<ProfileBridge, 'favoritesRead' | 'favoritesSave'>

interface FavoritesState { favorites: Favorites; loaded: boolean; error: Msg | null }

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/**
 * Favourites first, then the rest, each group in the order it came in (the engine's order).
 * `key` is the file name a favourite is kept under.
 */
export function sortFavoritesFirst<T>(items: readonly T[], key: (item: T) => string, favorites: readonly string[]): T[] {
  if (!favorites.length) return [...items]
  const starred = (item: T) => favorites.some(name => same(name, key(item)))
  return [...items.filter(starred), ...items.filter(item => !starred(item))]
}

/**
 * The starred Theme and Sounds files, shared by Theme, Sounds and the Profile sheets. Kept in
 * the data folder through the engine (`profileFavoritesRead` / `profileFavoritesSave`), so an
 * uninstall does not lose them. A star changes at once and is put back if the save fails.
 */
export function createFavoritesStore(bridge: FavoritesBridge) {
  const store = createStore<FavoritesState>({ favorites: { theme: [], audio: [] }, loaded: false, error: null })
  const { getState, publish } = store
  let saving: Promise<unknown> = Promise.resolve()
  /** What the file holds, as last read or saved. */
  let confirmed: Favorites = { theme: [], audio: [] }
  let latest = 0
  return {
    ...store,
    /** Reads the file again; a page calls this when it becomes active. */
    async load(): Promise<void> {
      try { confirmed = await bridge.favoritesRead(); publish({ favorites: confirmed, loaded: true, error: null }) }
      catch (error) { publish({ loaded: true, error: errorMsg(error, { key: 'favorites.error.read' }) }) }
    },
    isFavorite: (kind: FavoriteKind, file: string) => getState().favorites[kind].some(name => same(name, file)),
    /**
     * Stars or unstars `file`. `present` is every file of that kind the game has now: a
     * favourite whose file is gone is dropped from the list as it is saved. Returns the failure
     * to show, or null.
     */
    toggle(kind: FavoriteKind, file: string, present: readonly string[]): Promise<Msg | null> {
      const list = getState().favorites[kind].filter(name => present.some(p => same(p, name)))
      const next = list.some(name => same(name, file)) ? list.filter(name => !same(name, file)) : [...list, file]
      const favorites = { ...getState().favorites, [kind]: next }
      publish({ favorites, error: null })
      const mine = ++latest
      // One save at a time, in order, so a quick second click cannot be overtaken by the first.
      const run = saving.then(async () => {
        try {
          confirmed = await bridge.favoritesSave(favorites)
          // A newer click is already on screen; its own save will answer for it.
          if (mine === latest) publish({ favorites: confirmed })
          return null
        } catch (error) {
          const message = errorMsg(error, { key: 'favorites.error.save' })
          // Back to what the file holds, then to what newer clicks still ask for.
          if (mine === latest) publish({ favorites: confirmed, error: message })
          else publish({ error: message })
          return message
        }
      })
      saving = run
      return run
    },
  }
}
export type FavoritesStore = ReturnType<typeof createFavoritesStore>

/** A page's view of one list: loaded when the page becomes active. Absent store: no stars. */
export function useFavorites(store: FavoritesStore | null | undefined, kind: FavoriteKind, active: boolean) {
  const state = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getState ?? noState, store?.getState ?? noState)
  useEffect(() => { if (active) void store?.load() }, [store, active])
  const names = state?.favorites[kind] ?? EMPTY
  const isFavorite = useCallback((file: string) => names.some(name => same(name, file)), [names])
  return {
    enabled: Boolean(store),
    names,
    isFavorite,
    toggle: (file: string, present: readonly string[]) => store ? store.toggle(kind, file, present) : Promise.resolve(null),
    sort: <T,>(items: readonly T[], key: (item: T) => string) => sortFavoritesFirst(items, key, names),
  }
}
const EMPTY: string[] = []
const noSubscribe = () => () => {}
const noState = () => null
