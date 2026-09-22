import { nonempty, object, parseScheme } from "./document.js"
import type { SchemeDocument, SchemeFileReader, SchemeSelection } from "./types.js"

export function validateSchemeSelection(value: unknown): SchemeSelection {
  if (value === null) return null
  const selected = object(value, "scheme selection")
  if (Object.keys(selected).length !== 2 || !("name" in selected) || !("path" in selected)) throw new Error("scheme 只保存文件名和地址")
  nonempty(selected.path, "scheme.path")
  nonempty(selected.name, "scheme.name")
  if (selected.name.length > 4096 || /[\u0000\r\n]/.test(selected.name) || selected.path.length > 4096 || /[\u0000\r\n]/.test(selected.path) || !/\.json$/i.test(selected.path)
    || /^[\\/]{2}[?.][\\/]/.test(selected.path)
    || (/^[a-z][a-z0-9+.-]*:/i.test(selected.path) && !/^[a-z]:[\\/]/i.test(selected.path))) throw new Error("请选择本地 scheme JSON 文件")
  return { name: selected.name, path: selected.path }
}

export function replaceScheme<T extends { scheme: unknown }>(profile: T, selection: SchemeSelection): Omit<T, "scheme"> & { scheme: SchemeSelection } {
  return { ...profile, scheme: validateSchemeSelection(selection) }
}

/** Reader resolves paths from the Profile directory; no cache or implicit asset copy. */
export async function resolveScheme(selection: SchemeSelection, readFile: SchemeFileReader): Promise<SchemeDocument | null> {
  const selected = validateSchemeSelection(selection)
  if (selected === null) return null
  try {
    return parseScheme(await readFile(selected.path))
  } catch (error) {
    throw new Error(`无法读取 scheme「${selected.path}」: ${error instanceof Error ? error.message : String(error)}`)
  }
}
