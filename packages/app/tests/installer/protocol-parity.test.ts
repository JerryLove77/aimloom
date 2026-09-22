import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The wire contract lives in four places that must change in lockstep. Each layer fails in
// its own way when one is forgotten: Rust answers "unsupported installer read operation", the
// service "Unknown operation", and a missing response arm leaves a plan that cannot execute
// (PLAN_MISSING). This reads the four sources and checks that they name the same operations.
const root = resolve(__dirname, '../../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()

const schemaOps: string[] = JSON.parse(read('scripts/installer/gui/protocol.schema.json')).properties.op.enum
const service = read('scripts/installer/gui/kvk-gui-service.ps1')
const allowList = /\$op -cnotin @\(([^)]*)\)/.exec(service)?.[1] ?? ''
const serviceOps = [...allowList.matchAll(/'([^']+)'/g)].map(match => match[1]!)
const armsIn = (source: string, signature: string) => {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`missing ${signature}`)
  const body = source.slice(start)
  const end = body.indexOf('_ => Err(')
  return [...body.slice(0, end).matchAll(/^\s+((?:"[A-Za-z]+"\s*\|?\s*)+)=>/gm)].flatMap(match => [...match[1]!.matchAll(/"([A-Za-z]+)"/g)].map(name => name[1]!))
}
const rustRequestOps = armsIn(read('packages/app/src-tauri/src/installer/protocol.rs'), 'pub fn validate_read(')
const rustResponseOps = armsIn(read('packages/app/src-tauri/src/installer/commands.rs'), 'fn validate_read_response(')
const bridgeOps = [...read('packages/app/src/installer/bridge.ts').matchAll(/read\('([A-Za-z]+)'/g)].map(match => match[1]!)
const profileOps = schemaOps.filter(op => op.startsWith('profile'))

describe('wire contract parity', () => {
  it('the schema and the worker service allow the same operations', () => {
    expect(sorted(serviceOps)).toEqual(sorted(schemaOps))
  })

  it('Rust validates a request and a response for every read operation', () => {
    const readOps = sorted(schemaOps.filter(op => op !== 'execute' && !profileOps.includes(op)))
    expect(sorted(rustRequestOps)).toEqual(readOps)
    expect(sorted(rustResponseOps)).toEqual(readOps)
  })

  it('the native bridge calls exactly the read operations Rust accepts', () => {
    expect(sorted(bridgeOps)).toEqual(sorted(rustRequestOps))
  })

  it('knows the import operation in every layer', () => {
    for (const ops of [schemaOps, serviceOps, rustRequestOps, rustResponseOps, bridgeOps]) expect(ops).toContain('planFileAdd')
  })
})
