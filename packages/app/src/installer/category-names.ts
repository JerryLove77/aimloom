import type { Category } from '../bridge/contracts'
import type { MessageKey } from '../i18n'

/** A backup's categories, as the restore page names them. */
export const categoryNames: Record<Category, MessageKey> = { themes: 'installer.category.themes', sounds: 'installer.category.sounds', crosshairs: 'installer.category.crosshairs', ui: 'installer.category.ui', palette: 'installer.category.palette', primary: 'installer.category.primary' }
