import { useEffect, useRef } from 'react'
import type { SectionState } from './controller'

/**
 * Quick import and a restore change what is in the game while a section's list is already on
 * screen. `stamp` is the workspace's change counter; the next time the section is active with a
 * newer stamp, the list is read again. A reload never starts over a write or an unknown result
 * (the page stays locked until it is checked, and that check lists again itself), never over a
 * load that is still running, and keeps the pending choice: `load()` only re-reads the listing.
 * A section that has not loaded yet reads fresh anyway, so it just notes the stamp.
 */
export function useReloadOnChange(stamp: number, isActive: boolean, state: Pick<SectionState, 'phase' | 'applying' | 'unresolved'> & { reading?: boolean }, load: () => Promise<void>): void {
  const seen = useRef(stamp)
  useEffect(() => {
    if (!isActive || stamp === seen.current) return
    if (state.applying || state.unresolved || state.reading) return
    if (state.phase === 'locating' || state.phase === 'loading') return
    seen.current = stamp
    if (state.phase !== 'idle') void load()
  }, [stamp, isActive, state.phase, state.applying, state.unresolved, state.reading, load])
}
