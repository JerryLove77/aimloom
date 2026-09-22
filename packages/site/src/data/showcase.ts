import { existsSync } from 'node:fs'
import { join } from 'node:path'
import raw from './showcase.json'
import type { Localized } from './releases'

export interface ShowcaseItem { file: string; alt: Localized; caption: Localized; inPackage: boolean }

function fail(m: string): never { throw new Error(`showcase.json: ${m}`) }
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v) }
function localized(v: unknown, name: string): Localized {
  if (!isRecord(v) || typeof v.zh !== 'string' || typeof v.en !== 'string' || !v.zh || !v.en) fail(`${name} must be {zh, en}`)
  return { zh: v.zh, en: v.en }
}

/** `exists` receives the path relative to public/ so tests can stub the filesystem. */
export function parseShowcase(input: unknown, exists: (publicPath: string) => boolean): ShowcaseItem[] {
  if (!Array.isArray(input)) fail('root must be a list')
  return input.map((v, i) => {
    if (!isRecord(v)) fail(`[${i}] must be an object`)
    if (typeof v.file !== 'string' || !/^media\/[A-Za-z0-9._-]+\.(png|jpg|webp)$/.test(v.file)) fail(`[${i}].file must be a file under public/media/`)
    if (!exists(v.file)) fail(`[${i}].file ${v.file} does not exist under public/ — real screenshots only`)
    if (typeof v.inPackage !== 'boolean') fail(`[${i}].inPackage must be a boolean`)
    return { file: v.file, alt: localized(v.alt, `[${i}].alt`), caption: localized(v.caption, `[${i}].caption`), inPackage: v.inPackage }
  })
}

const publicDir = join(import.meta.dirname, '..', '..', 'public')
export const showcase: ShowcaseItem[] = parseShowcase(raw, p => existsSync(join(publicDir, p)))
