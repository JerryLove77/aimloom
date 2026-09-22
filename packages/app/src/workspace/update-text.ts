import type { MessageKey } from '../i18n'
import type { UpdateCheck } from '../installer/contracts'

/**
 * Which i18n key names an offered update's line -- the sentence names the line it belongs to
 * (design doc's example: "Beta 0.1.5-beta.1 is available"), shared by the sidebar's update dot
 * and the Settings popover so the two never drift apart.
 */
export function updateAvailableKey(update: Pick<UpdateCheck, 'channel'>): MessageKey {
  return update.channel === 'beta' ? 'settings.updates.available.beta' : 'settings.updates.available'
}
