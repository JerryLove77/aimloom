import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs scripts run by node at release and deploy time; no type declarations
import { hostedReleaseFiles, liveState, verifyLive } from '../scripts/release-upload.mjs'
// @ts-expect-error -- see above
import { checkHosted } from '../scripts/stage-release.mjs'

const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from(' a stand-in for the portable ZIP')])
const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.from(' a stand-in for the Setup')])
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const ZIP_URL = 'https://dl.aimloom.dev/releases/Aimloom-v0.1.6.zip'
const EXE_URL = 'https://dl.aimloom.dev/releases/Aimloom-Setup-v0.1.6.exe'

function setup(release: Record<string, unknown> = {}, files: Record<string, Buffer> = { 'Aimloom-v0.1.6.zip': zip, 'Aimloom-Setup-v0.1.6.exe': exe }) {
  const root = mkdtempSync(join(tmpdir(), 'aimloom-hosted-'))
  const source = join(root, 'release-files'), releasesPath = join(root, 'releases.json')
  mkdirSync(source)
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(source, name), bytes)
  writeFileSync(releasesPath, JSON.stringify({ schemaVersion: 1, recommended: '0.1.6', releases: [{
    version: '0.1.6', status: 'stable', bytes: zip.length, sha256: sha(zip), primaryUrl: ZIP_URL, mirrorUrl: null,
    setup: { url: EXE_URL, bytes: exe.length, sha256: sha(exe) }, ...release,
  }] }))
  return { source, releasesPath }
}

/** A stand-in for the public bucket: HEAD answers the size, GET the bytes. */
function bucket(objects: Record<string, Buffer>) {
  const calls: string[] = []
  const fetchImpl = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const body = objects[url]
    if (body === undefined) return new Response(null, { status: 404 })
    return method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'content-length': String(body.length) } })
      : new Response(new Uint8Array(body), { status: 200 })
  }
  return { fetchImpl, calls }
}

describe('hostedReleaseFiles', () => {
  it('lists the ZIP and the Setup hosted on R2, each checked against its local copy, keyed under releases/', () => {
    const files = hostedReleaseFiles(setup())
    expect(files.map((f: { key: string }) => f.key)).toEqual(['releases/Aimloom-v0.1.6.zip', 'releases/Aimloom-Setup-v0.1.6.exe'])
    expect(files[1]).toMatchObject({ url: EXE_URL, bytes: exe.length, sha256: sha(exe), contentType: 'application/vnd.microsoft.portable-executable',
      disposition: 'attachment; filename="Aimloom-Setup-v0.1.6.exe"' })
    expect(files[0]).toMatchObject({ contentType: 'application/zip' })
  })
  it('refuses a missing local copy, or one whose size or SHA-256 differs', () => {
    expect(() => hostedReleaseFiles(setup({}, { 'Aimloom-v0.1.6.zip': zip }))).toThrow(/Aimloom-Setup-v0\.1\.6\.exe/)
    const wrong = Buffer.from(exe); wrong[wrong.length - 1] = 0x21
    expect(() => hostedReleaseFiles(setup({}, { 'Aimloom-v0.1.6.zip': zip, 'Aimloom-Setup-v0.1.6.exe': wrong }))).toThrow(/SHA-256/)
    expect(() => hostedReleaseFiles(setup({}, { 'Aimloom-v0.1.6.zip': zip, 'Aimloom-Setup-v0.1.6.exe': Buffer.concat([exe, exe]) }))).toThrow(/bytes/)
  })
  it('leaves files served from /files/ or elsewhere, and withdrawn or unreleased releases, alone', () => {
    expect(hostedReleaseFiles(setup({ primaryUrl: '/files/Aimloom-v0.1.6.zip', setup: null }))).toEqual([])
    expect(hostedReleaseFiles(setup({ primaryUrl: 'https://github.com/x/y.zip', setup: null }))).toEqual([])
    expect(hostedReleaseFiles(setup({ status: 'withdrawn' }, {}))).toEqual([])
    expect(hostedReleaseFiles(setup({ status: 'preparing' }, {}))).toEqual([])
  })
})

describe('liveState and verifyLive', () => {
  const [file] = hostedReleaseFiles(setup())
  it('reads a 404 as missing and the described size as live', async () => {
    expect(await liveState(file, bucket({}).fetchImpl)).toBe('missing')
    expect(await liveState(file, bucket({ [ZIP_URL]: zip }).fetchImpl)).toBe('live')
  })
  it('never treats another file under the same name as something to replace', async () => {
    await expect(liveState(file, bucket({ [ZIP_URL]: Buffer.concat([zip, zip]) }).fetchImpl)).rejects.toThrow(/never reused/)
    const failing = async () => new Response(null, { status: 403 })
    await expect(liveState(file, failing)).rejects.toThrow(/403/)
  })
  it('accepts a read-back only when every byte matches', async () => {
    await expect(verifyLive(file, bucket({ [ZIP_URL]: zip }).fetchImpl)).resolves.toBeUndefined()
    const sameSize = Buffer.from(zip); sameSize[sameSize.length - 1] = 0x21
    await expect(verifyLive(file, bucket({ [ZIP_URL]: sameSize }).fetchImpl)).rejects.toThrow(/does not read back/)
  })
})

describe('checkHosted (the deploy step)', () => {
  it('goes on only when every hosted file is live, and names the upload step otherwise', async () => {
    const paths = setup()
    await expect(checkHosted({ ...paths, fetchImpl: bucket({ [ZIP_URL]: zip, [EXE_URL]: exe }).fetchImpl })).resolves.toHaveLength(2)
    await expect(checkHosted({ ...paths, fetchImpl: bucket({ [ZIP_URL]: zip }).fetchImpl })).rejects.toThrow(/release:upload/)
  })
  it('only asks for the size: a deploy never downloads a release', async () => {
    const b = bucket({ [ZIP_URL]: zip, [EXE_URL]: exe })
    await checkHosted({ ...setup(), fetchImpl: b.fetchImpl })
    expect(b.calls).toEqual([`HEAD ${ZIP_URL}`, `HEAD ${EXE_URL}`])
  })
})
