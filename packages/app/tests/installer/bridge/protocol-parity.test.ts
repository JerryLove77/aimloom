import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The wire contract lives in three places that must change in lockstep: the TS bridge, the
// native validators (protocol.rs and commands.rs for reads, installer/profiles.rs for the Profile
// store) and the engine's session (session.rs). Each layer fails in its own way when one is
// forgotten: Rust answers "unsupported installer read operation", the engine "Unknown operation",
// and a missing response arm leaves a plan that cannot execute (PLAN_MISSING). This reads the
// sources and checks that they name the same operations.
const root = resolve(__dirname, '../../../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()

const session = read('packages/app/src-tauri/src/engine/session.rs')
const constList = (name: string) => {
  const body = new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`).exec(session)?.[1]
  if (body === undefined) throw new Error(`missing ${name}`)
  return [...body.matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]!)
}
const engineOps = constList('OPERATIONS')
const engineProfileOps = constList('PROFILE_OPERATIONS')
const armsIn = (source: string, signature: string) => {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`missing ${signature}`)
  const body = source.slice(start)
  const end = body.indexOf('_ => Err(')
  return [...body.slice(0, end).matchAll(/^\s+((?:"[A-Za-z]+"\s*\|?\s*)+)=>/gm)].flatMap(match => [...match[1]!.matchAll(/"([A-Za-z]+)"/g)].map(name => name[1]!))
}
const rustRequestOps = armsIn(read('packages/app/src-tauri/src/installer/protocol.rs'), 'pub fn validate_read(')
const rustResponseOps = armsIn(read('packages/app/src-tauri/src/installer/commands.rs'), 'fn validate_read_response(')
const bridgeOps = [...read('packages/app/src/bridge/native.ts').matchAll(/read\('([A-Za-z]+)'/g)].map(match => match[1]!)
const profileValidator = read('packages/app/src-tauri/src/installer/profiles.rs')
const profileBridge = read('packages/app/src/bridge/profiles.ts') + read('packages/app/src/bridge/assets.ts')

describe('wire contract parity', () => {
  it('Rust validates a request and a response for every read operation the engine knows', () => {
    const readOps = sorted(engineOps.filter(op => op !== 'execute' && !engineProfileOps.includes(op)))
    expect(sorted(rustRequestOps)).toEqual(readOps)
    expect(sorted(rustResponseOps)).toEqual(readOps)
  })

  it('the native bridge calls exactly the read operations Rust accepts', () => {
    expect(sorted(bridgeOps)).toEqual(sorted(rustRequestOps))
  })

  it('every Profile store operation is an engine operation, validated in Rust and called by the bridge', () => {
    expect(engineProfileOps.every(op => engineOps.includes(op))).toBe(true)
    expect(engineOps.filter(op => op.startsWith('profile'))).toEqual(engineProfileOps)
    for (const op of engineProfileOps) {
      expect(profileValidator, op).toContain(`"${op}"`)
      expect(profileBridge, op).toContain(`'${op}'`)
    }
  })

  it('knows the import operation in every layer', () => {
    for (const ops of [engineOps, rustRequestOps, rustResponseOps, bridgeOps]) expect(ops).toContain('planFileAdd')
  })
})
