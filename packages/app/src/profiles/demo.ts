import type { ProfileBridge } from './bridge'
import type { AssetKind, ProfileAssetBridge } from './assets'
import { createTrainingProfile, parseTrainingProfile, type TrainingProfile } from './model'
import { referenceFromPath } from './file-reference'
import { InstallerFailure } from '../installer/contracts'
import { t, type MessageKey } from '../i18n'
// Demo content (sample Profile names, demo theme and enemy names) is data, not UI text.
import data from './demo-data.json'

/** A demo failure in both languages, thrown the way the native bridges throw theirs. */
const failure = (key: MessageKey) => new InstallerFailure({ code: 'ENGINE_ERROR', message: t('zh', key), messageEn: t('en', key), path: null })

const DIRECTORY = '/demo/profiles'
const KEY = 'aimloom.profile-page-demo.v1'
const ref = (kind: AssetKind, name: string) => referenceFromPath(`/demo/${kind}/${name}`, kind === 'crosshair' ? ['.png'] : kind === 'audio' ? ['.wav'] : ['.json'])
function presets(): TrainingProfile[] {
  return [{ ...createTrainingProfile('daily', data.profiles.daily), scheme: ref('scheme', 'Blue-room.json'), audio: { kill: [ref('audio', 'Soft-hit.wav')] } }, { ...createTrainingProfile('focus', data.profiles.focus), scheme: ref('scheme', 'Warm-room.json') }]
}
/** Explicit browser demo; this store never reads or changes the game's current settings. */
export function createDemoProfileBridge(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ProfileBridge {
  const readAll = (): TrainingProfile[] => {
    const raw = storage.getItem(KEY)
    if (raw === null) return presets()
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw failure('profile.demo.storageUnreadable') }
    if (!Array.isArray(parsed)) throw failure('profile.demo.storageInvalid')
    return parsed.map(parseTrainingProfile)
  }
  return {
    async list() { return { directory: DIRECTORY, profiles: readAll(), errors: [] } },
    async read(id) { return { filePath: `${DIRECTORY}/${id}.json`, profile: readAll().find(p => p.id === id) ?? null } },
    async save(profile) {
      const validated = parseTrainingProfile(profile)
      storage.setItem(KEY, JSON.stringify([...readAll().filter(p => p.id !== profile.id), validated]))
      return { filePath: `${DIRECTORY}/${profile.id}.json`, profile: validated }
    },
    async delete(id) {
      const profiles = readAll(); const next = profiles.filter(p => p.id !== id)
      if (next.length === profiles.length) return { deleted: false }
      storage.setItem(KEY, JSON.stringify(next)); return { deleted: true }
    },
  }
}
function scheme(name: string, wall: {x:number;y:number;z:number}, floor: {x:number;y:number;z:number}) {
  const surface = (tint: typeof wall) => ({ material: 'DRYWALL', tint, roughness: .8, metallic: 0, fullBright: .2, textureScale: 1 })
  return { schemaVersion: 1, name, environment: { wall: surface(wall), floor: surface(floor), ceiling: surface(wall), ramp: surface(floor), sky: { presetId: 0, cloudCoverId: 0, solid: true, sunVisible: false, color: {r:28,g:35,b:46,a:255} } }, provenance: {kind:'local'}, warnings: [] }
}
function tone(frequency: number): Uint8Array {
  const samples = 6000, rate = 24000, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, i) => { bytes[offset+i] = char.charCodeAt(0) })
  text(0,'RIFF');view.setUint32(4,36+samples*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true)
  for(let i=0;i<samples;i++) view.setInt16(44+i*2,Math.sin(i/rate*frequency*Math.PI*2)*2200*(1-i/samples),true)
  return bytes
}

const pngs = ["iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABg0lEQVR4Ae3BwWncAAAF0RFML2rGRakoNbPVKOwhB4MDznXnvyeTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyZdF99dBEnZw4u3g5MomTQpOziJk7KHL94ObqJk0mTSZNJk0mTSpOzgJk4+y8XvXXx38XsXH0I+zcOLt4OThy9+cnDzk4cvfnJw8/Di7eDkg8ikyac5OPnr4OZ/HNz8y8HJB5LPcvF7F99dBEnZwxdvBzdRMmkyaTJpMmkyaVJ2cBMnZQ8v3g5OomTSpOzgJE66LgaZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJm0P49aGnUQCOEYAAAAAElFTkSuQmCC", "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABjklEQVR4Ae3BsW0bUQAFwf3A9sJmVNQVxWZYzRkMHAiQATnlvhmZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTSZNJk0mTTpuvjuIkjK7vvF2zkPomTSpOycB3FSdt9fvJ3zJEomTSZNJk0mTSZNys55Eief5eL3Lr67+L2LDyGf5r5fvJ3z4L6/+Mk5T35y31/85Jwn9/3i7ZwHH0QmTT7NOQ/+OufJ/zjnyb+c8+ADyWe5+L2L7y6CpOy+v3g750mUTJpMmkyaTJpMmpSd8yROyu77xds5D6Jk0qTsnAdx0nUxyKTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpMmkyaTJpP0B0lAifa77GogAAAAASUVORK5CYII="]
/**
 * The Scheme, Audio, Crosshair and Enemy pages read files from the demo game directory
 * that the demo installer bridge reports. Synthesize a stable sample per file name so the
 * browser demo shows real previews there too. Nothing is ever read from or written to disk.
 */
const DEMO_GAME_FILE = /[\\/]FPSAimTrainer[\\/](?:Saved[\\/]SaveGames[\\/]Themes|crosshairs|sounds)[\\/]([^\\/]+)$/
function demoHue(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}
function demoTheme(name: string) {
  const hue = demoHue(name)
  const channel = (shift: number) => ((hue >>> shift) % 100) / 100
  const tint = (shift: number, scale: number) => ({ x: channel(shift) * scale, y: channel(shift + 3) * scale, z: channel(shift + 6) * scale })
  const surface = (prefix: string, color: {x:number;y:number;z:number}) => ({ [`${prefix}Material`]: 'DRYWALL', [`${prefix}Roughness`]: .8, [`${prefix}Metallic`]: 0, [`${prefix}FullBright`]: .2, [`${prefix}Tint`]: color, [`${prefix}TextureScale`]: 1 })
  const enemy = tint(9, 1)
  return {
    themeName: name, ...surface('wall', tint(0, .5)), ...surface('floor', tint(2, .3)), ...surface('ceiling', tint(0, .5)), ...surface('ramp', tint(2, .3)),
    overrideEnemyHeadColor: true, overrideEnemyBodyColor: true, setEnemyBodyColorAsAttackColor: false,
    enemyColorRoughness: .6, enemyColorMetallic: 0, enemyColorFullBright: .3,
    enemyHeadColor: enemy, enemyBodyColor: enemy,
    // Older themes lack hit/look-at colours; the demo keeps one such theme to show the note.
    ...(name === 'clover-alternate' ? {} : { enemyHeadColorOnHit: { x: 1, y: 1, z: 1 }, enemyBodyColorOnHit: { x: 1, y: 1, z: 1 }, enemyHeadColorOnLookAt: { x: 1, y: 1, z: 0 }, enemyBodyColorOnLookAt: { x: 1, y: 1, z: 0 }, changeEnemyColorOnHit: true, changeEnemyColorOnLookAt: false }),
    skyPresetId: 0, cloudCoverId: 0, solidSkyColor: true, sunVisible: false, skyColor: { r: 28, g: 35, b: 46, a: 255 },
  }
}

export function createDemoAssetBridge(): ProfileAssetBridge {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const appearance = (bodyColor: string) => ({ schemaVersion:1,kind:'enemy-appearance',name:data.enemy,appearance:{headColor:bodyColor,bodyColor,overrideHead:true,overrideBody:true,changeOnHit:false,changeOnLookAt:false,roughness:.6,metallic:0,fullBright:.3},source:{kind:'builtin'} })
  const files: Record<string, Uint8Array> = {
    '/demo/scheme/Blue-room.json': encode(scheme(data.schemes.blue,{x:.16,y:.25,z:.4},{x:.09,y:.12,z:.18})),
    '/demo/scheme/Warm-room.json': encode(scheme(data.schemes.warm,{x:.4,y:.3,z:.21},{x:.15,y:.12,z:.1})),
    '/demo/enemy/Blue-target.json': encode(appearance('#3298ff')),
    '/demo/enemy/Orange-target.json': encode(appearance('#ff8a2e')),
    '/demo/crosshair/Green-cross.png': Uint8Array.from(atob(pngs[0]!),c=>c.charCodeAt(0)),
    '/demo/crosshair/Cyan-cross.png': Uint8Array.from(atob(pngs[1]!),c=>c.charCodeAt(0)),
    '/demo/audio/Soft-hit.wav': tone(620), '/demo/audio/Clear-hit.wav': tone(960),
  }
  return {
    async chooseDirectory(kind) { return `/demo/${kind}` },
    async list(kind, directory) {
      if (directory !== `/demo/${kind}`) throw failure('profile.demo.assetsOnly')
      return { directory, files: Object.keys(files).filter(path => path.startsWith(`${directory}/`)).map(path => ({ name: path.split('/').pop()!, path })), errors: [] }
    },
    async read(kind, path) {
      const bytes = files[path]
      if (bytes) return bytes.slice()
      // Files 'outside the game' that the demo's file picker and drops point at.
      const outside = /^\/demo\/downloads\/([^/]+)$/.exec(path)
      if (outside && kind !== 'audio' && /\.json$/i.test(outside[1]!)) return encode(demoTheme(outside[1]!.replace(/\.json$/i, '')))
      if (outside && kind === 'audio' && /\.(ogg|wav)$/i.test(outside[1]!)) return tone(700)
      const game = DEMO_GAME_FILE.exec(path)
      if (game) {
        const file = game[1]!
        const stem = file.replace(/\.[^.]+$/, '')
        if ((kind === 'scheme' || kind === 'enemy') && /\.json$/i.test(file) && stem !== 'Broken') return encode(demoTheme(stem))
        if (kind === 'crosshair' && /\.png$/i.test(file)) return Uint8Array.from(atob(pngs[demoHue(stem) % pngs.length]!), c => c.charCodeAt(0))
        if (kind === 'audio' && /\.(ogg|wav)$/i.test(file)) return tone(400 + demoHue(stem) % 800)
      }
      throw failure('profile.demo.assetMissing')
    },
  }
}
