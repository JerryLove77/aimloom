import { InstallerFailure } from '../installer/contracts'
import { t } from '../i18n'

export interface ProfileFileReference { name: string; path: string }

export function parseFileReference(value: unknown, extensions: readonly string[]): ProfileFileReference {
  const fail = (): never => { throw new InstallerFailure({ code: 'INVALID_PATH', message: t('zh', 'profile.fileReference.invalid'), messageEn: t('en', 'profile.fileReference.invalid'), path: null }) }
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail()
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 2 || keys.some(key => key !== 'name' && key !== 'path')) fail()
  for (const key of keys) { const field = Object.getOwnPropertyDescriptor(value, key)!; if (!field.enumerable || !('value' in field)) fail() }
  const { name, path } = value as ProfileFileReference
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\0\r\n]/.test(path)) fail()
  if (typeof name !== 'string' || !name.trim() || name.length > 4096 || /[\0\r\n]/.test(name)) fail()
  if (/^[\\/]{2}[?.][\\/]/.test(path) || (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))) fail()
  const extension = /\.[^./\\]+$/.exec(path.split(/[\\/]/).pop()!)?.[0].toLowerCase()
  if (!extension || !extensions.includes(extension)) fail()
  return { name, path }
}

export function referenceFromPath(path: string, extensions: readonly string[]): ProfileFileReference {
  return parseFileReference({ name: typeof path === 'string' ? path.split(/[\\/]/).pop() : null, path }, extensions)
}
