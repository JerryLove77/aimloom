// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const installer = fileURLToPath(new URL('../../../../scripts/installer', import.meta.url))
const level = (text: string) => [...text.matchAll(/^\s*Set-StrictMode\s+-Version\s+(\S+)/gim)].map(match => match[1]!)
const scripts = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? scripts(path) : name.endsWith('.ps1') ? [path] : []
})

describe('PowerShell strict mode', () => {
  const worker = level(readFileSync(join(installer, 'gui/kvk-gui-worker.ps1'), 'utf8'))

  it('the worker declares exactly one level', () => { expect(worker).toEqual(['3.0']) })

  it('no suite or dot-sourced helper runs below the worker level', () => {
    // A lower level hides errors only the real app hits: indexing an array by an event name was
    // a silent null at 2.0 and a thrown Int32 conversion at the worker's 3.0, so every Audio
    // apply failed on Windows while the fixture suites stayed green. A dot-sourced helper counts
    // too — its Set-StrictMode lowers the whole suite that loads it.
    const low = scripts(join(installer, 'tests')).flatMap(path =>
      level(readFileSync(path, 'utf8')).filter(value => value !== 'Latest' && Number(value) < Number(worker[0])).map(value => `${path.slice(installer.length + 1)} → ${value}`))
    expect(low).toEqual([])
  })
})
