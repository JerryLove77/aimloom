import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider, plural, t, type MessageKey } from '../../../src/i18n'
import { zh } from '../../../src/i18n/zh'
import { en } from '../../../src/i18n/en'
import { SchemePage } from '../../../src/scheme/SchemePage'
import { ProfilesApp } from '../../../src/profiles/ProfilesApp'
import { BackupList } from '../../../src/installer/components/BackupList'
import type { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import { createTrainingProfile } from '../../../src/profiles/model'
import type { ProfileBridge } from '../../../src/profiles/bridge'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:plurals'), revokeObjectURL: vi.fn() }))

/**
 * Spec §4.1: English has no plural library, so every sentence that carries a count has two keys,
 * `<key>` (plural) and `<key>.one` (singular), and `plural(count, key)` picks between them. The
 * Chinese halves are identical, so Chinese output cannot change. List headings that merely append
 * a number ("Game sounds folder · 1", "Per-file results (1)") have no twin, by design.
 */
const PAIRS: readonly MessageKey[] = [
  'scheme.pagination.count', 'profile.pagination.count',
  'profile.summary.audioFiles', 'profile.resource.fileErrorsSummary', 'profile.listErrors.summary',
  'profile.audioSheet.filesHeading', 'installer.fileCount', 'installer.category.aria',
  'installer.restore.recordCount', 'installer.review.skipped', 'installer.selection.skipped',
]

describe('every counted sentence has a singular twin', () => {
  for (const key of PAIRS) {
    const one = `${key}.one` as MessageKey
    it(`${key}: the twin exists and Chinese is byte-identical`, () => {
      expect(en[one]).toBeTypeOf('string')
      expect(zh[one]).toBe(zh[key])
    })
  }
  it('plural() picks the singular only at 1', () => {
    expect(plural(1, 'installer.fileCount')).toBe('installer.fileCount.one')
    expect(plural(0, 'installer.fileCount')).toBe('installer.fileCount')
    expect(plural(2, 'installer.fileCount')).toBe('installer.fileCount')
  })
  it('no English singular says "1 <plural>"', () => {
    const ENGLISH_SINGULARS: Record<string, string> = {
      'scheme.pagination.count': '1 theme',
      'profile.pagination.count': '1 Profile',
      'profile.summary.audioFiles': '1 audio file',
      'profile.resource.fileErrorsSummary': "1 file couldn't be used",
      'profile.listErrors.summary': "1 file couldn't be read; other Profiles still work.",
      'profile.audioSheet.filesHeading': 'Kill sound: 1 file',
      'installer.fileCount': '1 file',
      'installer.category.aria': 'Themes, 1 file',
      'installer.restore.recordCount': '1 record',
      'installer.review.skipped': '1 unrecognized item skipped',
      'installer.selection.skipped': '1 unrecognized file will be skipped',
    }
    for (const key of PAIRS) {
      const params = { count: 1, name: 'Themes', event: 'Kill sound' }
      expect(t('en', plural(1, key), params)).toBe(ENGLISH_SINGULARS[key])
    }
  })
})

const inEnglish = (node: React.ReactElement) =>
  render(<LangProvider storage={null} languages={['en-US']}>{node}</LangProvider>)

const located = {
  discover: async () => ({ candidates: ['D:/Game'] }),
  locate: async (root: string) => ({ gameRoot: root }),
  pickFolder: async () => null,
  execute: async () => ({ operationId: 'op-1' }),
  job: async () => ({ state: 'finished', result: { status: 'completed' } }),
  planFileAdd: async () => ({ planId: 'plan-add' }),
  pickFile: async () => null,
  reconcile: async () => ({}),
}
const assets: ProfileAssetBridge = {
  chooseDirectory: async () => null,
  list: async () => ({ directory: 'D:/Game/Themes', files: [], errors: [] }),
  read: async () => new TextEncoder().encode(JSON.stringify({ themeName: 'Night', wallTint: { x: 0, y: 0, z: 0 }, enemyBodyColor: { x: 1, y: 0, z: 0 }, overrideEnemyBodyColor: true })),
}
function profileBridge(): ProfileBridge {
  const stored = createTrainingProfile('profile1', 'Daily')
  return {
    list: async () => ({ directory: '/profiles', profiles: [stored], errors: [] }),
    read: async () => ({ filePath: '/profiles/profile1.json', profile: structuredClone(stored) }),
    save: async () => ({ filePath: '/profiles/profile1.json', profile: stored }),
    delete: async () => ({ deleted: true }),
  }
}

/** One rendered surface per area, so a call site that forgot `plural()` fails here. */
describe('a count of 1 reads correctly on the page', () => {
  it('Theme pagination: "1 theme"', async () => {
    const bridge = { ...located, schemeList: async () => ({ directory: 'D:/Game/Themes', current: 'Night', themes: [{ name: 'Night', file: 'Night.json', path: 'D:/Game/Themes/Night.json', readable: true, duplicateName: false }] }), planScheme: async () => ({ planId: 'p' }) }
    inEnglish(<SchemePage bridge={bridge} assets={assets} section={'scheme' as WorkspaceSection} onSelect={() => {}} />)
    expect(await screen.findByText('1 theme')).toBeVisible()
  })

  it('Profile library: "1 Profile"', async () => {
    inEnglish(<ProfilesApp bridge={profileBridge()} assets={assets} />)
    expect(await screen.findByText('1 Profile')).toBeVisible()
  })

  it('Quick import backup list: "1 file"', () => {
    inEnglish(<BackupList records={[{ id: 'b1234567890abc', kind: 'install', status: 'completed', createdAt: '2026-09-19T00:00:00Z', fileCount: 1, categories: ['themes'] }]} selectedId={null} busy={false} onSelect={() => {}} />)
    expect(screen.getByText(/^1 file · /)).toBeVisible()
  })
})
