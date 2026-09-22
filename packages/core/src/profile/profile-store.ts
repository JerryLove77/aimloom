import { createHash, randomUUID } from "node:crypto"
import type { PlatformAdapter } from "../platform/adapter.js"
import type { Profile } from "../types.js"
import { parseSettings, readKey } from "../settings/settings-doc.js"
import { readAudioLevels, readSoundBinding } from "../settings/sound-binder.js"

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

const joinPath = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, "")}/${name}`

export type CaptureOptions = {
  name: string
  settingsPath: string
  themesDir: string
  source?: Profile["source"]
}

export class ProfileStore {
  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly profilesPath: string,
  ) {}

  async list(): Promise<Profile[]> {
    if (!(await this.adapter.exists(this.profilesPath))) return []
    try {
      const bytes = await this.adapter.readFile(this.profilesPath)
      const parsed = JSON.parse(new TextDecoder().decode(bytes))
      return Array.isArray(parsed) ? (parsed as Profile[]) : []
    } catch {
      // 损坏的配置档索引不应导致整个应用起不来
      return []
    }
  }

  async save(profile: Profile): Promise<void> {
    const all = await this.list()
    const index = all.findIndex((p) => p.id === profile.id)
    if (index >= 0) all[index] = profile
    else all.push(profile)
    await this.write(all)
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((p) => p.id !== id))
  }

  private async write(all: Profile[]): Promise<void> {
    await this.adapter.writeFileAtomic(
      this.profilesPath,
      new TextEncoder().encode(JSON.stringify(all, null, 2) + "\n"),
    )
  }

  /** 从当前存档快照出一个配置档 */
  async captureCurrent(opts: CaptureOptions): Promise<Profile> {
    const doc = parseSettings(await this.adapter.readFile(opts.settingsPath))
    const themeName = readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")

    let theme: Profile["theme"] = null
    if (typeof themeName === "string" && themeName.length > 0) {
      const path = joinPath(opts.themesDir, `${themeName}.json`)
      // theme 文件可能已不在（用户删了），此时只记名字不记 hash
      const hash = (await this.adapter.exists(path))
        ? hashBytes(await this.adapter.readFile(path))
        : ""
      theme = { name: themeName, hash }
    }

    const profile: Profile = {
      id: randomUUID(),
      name: opts.name,
      createdAt: new Date().toISOString(),
      theme,
      sounds: readSoundBinding(doc),
      audio: readAudioLevels(doc),
    }
    if (opts.source) profile.source = opts.source
    return profile
  }

  /**
   * 检查配置档引用的 theme 文件是否仍与当初一致。
   * 还原时若返回 changed，应提示用户而不是默默套上改动过的版本。
   */
  async checkThemeDrift(profile: Profile, themesDir: string): Promise<"ok" | "missing" | "changed"> {
    if (!profile.theme) return "ok"
    const path = joinPath(themesDir, `${profile.theme.name}.json`)
    if (!(await this.adapter.exists(path))) return "missing"
    if (profile.theme.hash === "") return "ok" // 当初就没记录 hash，无从比较
    const hash = hashBytes(await this.adapter.readFile(path))
    return hash === profile.theme.hash ? "ok" : "changed"
  }
}
