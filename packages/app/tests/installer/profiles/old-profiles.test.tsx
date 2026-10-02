import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProfilesApp } from '../../../src/profiles/ProfilesApp'
import { profileIdOfFile } from '../../../src/profiles/model'
import { createDemoAssetBridge, createDemoProfileBridge } from '../../../src/bridge/profiles-demo'
import type { ProfileBridge } from '../../../src/bridge/profiles'

/** Profiles saved by Aimloom 0.1.5 or earlier (format v1) are listed as unreadable files and must be removable. */
const OLD = { fileName: 'old-tracking.json', message: '不支持此 Profile 版本。', messageEn: 'This Profile version is not supported.' }
const ODD = { fileName: 'My Profile.json', message: '不支持此 Profile 版本。', messageEn: 'This Profile version is not supported.' }

function bridgeWith(errors: typeof OLD[]): { bridge: ProfileBridge; removed: string[] } {
  const base = createDemoProfileBridge(localStorage)
  const removed: string[] = []
  const bridge: ProfileBridge = {
    ...base,
    async list() { const list = await base.list(); return { ...list, errors: errors.filter(e => !removed.includes(e.fileName)) } },
    async delete(id) { removed.push(`${id}.json`); return { deleted: true } },
  }
  return { bridge, removed }
}

describe('profileIdOfFile', () => {
  it('accepts only exactly a valid id plus .json', () => {
    expect(profileIdOfFile('old-tracking.json')).toBe('old-tracking')
    expect(profileIdOfFile('My Profile.json')).toBeNull()
    expect(profileIdOfFile('old.JSON')).toBeNull()
    expect(profileIdOfFile('../x.json')).toBeNull()
    expect(profileIdOfFile('con.json')).toBeNull()
    expect(profileIdOfFile('.json')).toBeNull()
  })
})

describe('an unreadable Profile file in the list', () => {
  it('offers Delete only for a file named like an id, confirms, deletes it and lists again', async () => {
    localStorage.clear()
    const { bridge, removed } = bridgeWith([OLD, ODD])
    const list = vi.spyOn(bridge, 'list')
    render(<ProfilesApp bridge={bridge} assets={createDemoAssetBridge()} />)
    fireEvent.click(await screen.findByText('查看文件'))
    expect(screen.getByText(/old-tracking\.json：不支持此 Profile 版本。/)).toBeVisible()
    expect(screen.getByRole('button', { name: '删除 old-tracking.json' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '删除 My Profile.json' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '删除 old-tracking.json' }))
    const dialog = await screen.findByRole('dialog', { name: '删除 Profile' })
    expect(within(dialog).getByText(/old-tracking\.json/)).toBeVisible()
    // The same focus rule as the Profile delete dialog: Cancel holds focus, nothing is deleted yet.
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    expect(removed).toEqual([])
    const calls = list.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(removed).toEqual(['old-tracking.json']))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(calls))
    await waitFor(() => expect(screen.queryByText(/old-tracking\.json/)).toBeNull())
  })

  it('cancelling the confirmation deletes nothing', async () => {
    localStorage.clear()
    const { bridge, removed } = bridgeWith([OLD])
    render(<ProfilesApp bridge={bridge} assets={createDemoAssetBridge()} />)
    fireEvent.click(await screen.findByText('查看文件'))
    fireEvent.click(screen.getByRole('button', { name: '删除 old-tracking.json' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(removed).toEqual([])
  })
})
