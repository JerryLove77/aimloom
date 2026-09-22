# KovaaK Config Manager 外壳（计划 B1）— 设计文档

> **Historical prototype design — alignment note, 2026-09-15:** new product navigation,
> Profile data and save/cancel behavior follow the [shared five-section workspace](2026-09-13-aimloom-training-profiles-design.md).
> Preserve the historical implementation/evidence below and applicable file-safety/recovery
> constraints; do not reintroduce its older Profile bar, embedded settings or product shell.

- 日期：2026-09-03
- 状态：已确认，待转实现计划
- 范围：桌面端外壳的第一阶段。内核见计划 A（已完成），3D 预览与整包导入向导见计划 B2。
- 上游 spec：`docs/superpowers/specs/2026-09-02-kovaak-config-manager-design.md`

---

## 0. 为什么切成 B1 / B2

原 spec §12 把「计划 B — 外壳」写成一个计划：Tauri 壳 + TauriAdapter + 三个 UI 页 + Three.js 预览 + 24 套贴图 + 整包导入向导 + Windows 真机验收。这比计划 A（15 个任务、纯函数内核）还大，塞进一个计划会失控。

因此拆开：

- **B1（本文档）**：能定位游戏、三个 UI 页、配置档栏、备份回滚、音效试听、Windows 验收通过的**可用软件**。背景预览用文本摘要占位。
- **B2**：Three.js 3D 预览与 24 套贴图、整包导入向导、`Profile.extras` 填充。

切分理由：B1 结束即有可交付价值；3D 预览是最容易超时的部分，不该挡住主流程上线。

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 壳 | Tauri v2 |
| UI | React + Vite + TypeScript(strict) + Tailwind |
| 状态 | `useReducer` + Context（零额外依赖） |
| 测试 | Vitest（两个 project：node / jsdom）+ React Testing Library |
| Rust | 三个 command，约 50 行 |

选 React 的理由：`@react-three/fiber` 让 B2 的预览写起来最顺；网站子项目（spec §11）若同为 React，预览组件与 theme 卡片可直接复用。

内核 `packages/core` 保持零运行时依赖，不受此选择影响。

## 2. 仓库结构与模块边界

```
packages/
  core/                    ← 计划 A 产物
  app/                     ← 新增
    src/
      platform/
        tauri-adapter.ts   PlatformAdapter over plugin-fs + 3 个 Rust command
        memory-adapter.ts  纯内存实现（测试 + dev:web）
        locate.ts          游戏目录探测与校验
        errors.ts          io-error 二次分类（spec §5.4 C8）
      state/
        reducer.ts         纯函数
        store.tsx          useReducer + Context
      commands/            唯一 import @kvk/core 函数的地方
      pages/               ThemesPage / SoundsPage / CrosshairsPage
      components/          ProfileBar / BackupList / GuardBanner / SoundSlot ...
    tests/
    src-tauri/             Rust + tauri.conf.json + capabilities
```

三条边界规则，全部服务于「页级测试写得动」和「将来换壳不动 UI」：

1. **UI 组件只从 core import 类型，不 import 函数。** 要调内核一律经 `commands/`。
2. **`commands/*` 把 `adapter` 当参数收**，不从模块作用域抓——测试注入 `MemoryAdapter` 即可，不需要 mock 模块。
3. **`reducer.ts` 是纯函数**，不碰 adapter、不发异步。命令跑完 dispatch 结果事件，reducer 只做状态变换。

## 3. 平台层

### 3.1 TauriAdapter

`PlatformAdapter` 的十个方法，八个直接落在 `plugin-fs` 的 JS API 上，两个走 Rust：

| PlatformAdapter | 实现 |
|---|---|
| `readFile` | `fs.readFile` |
| `exists` | `fs.exists` |
| `listDir` | `fs.readDir` |
| `stat` | `fs.stat` |
| `mkdirp` | `fs.mkdir({ recursive: true })` |
| `copyFile` | `fs.copyFile` |
| `removeFile` | `fs.remove` |
| `removeDir` | `fs.remove({ recursive: true })` |
| `writeFileAtomic` | `invoke("write_atomic")` |
| `isGameRunning` | `invoke("is_game_running")` |

`plugin-fs` 也提供 `writeFile` 与 `rename`，但本项目不用——原子写整条链路（含 `fsync`）在 Rust 侧完成，见 §3.2。

### 3.2 Rust 侧（约 50 行）

```rust
#[tauri::command] fn is_game_running() -> bool
// sysinfo，进程名 FPSAimTrainer

#[tauri::command] fn grant_game_dir(app: AppHandle, dir: String) -> Result<(), String>
// app.fs_scope().allow_directory(&dir, true)
// app.asset_protocol_scope().allow_directory(&dir, true)

#[tauri::command] fn write_atomic(path: String, data: Vec<u8>) -> Result<(), String>
// 写 <path>.kvk-tmp → file.sync_all() → fs::rename
```

比原 spec §3.1 估的「30–50 行」略多，多出的两项都不可省：

**`grant_game_dir` 不可省。** Tauri v2 的文件权限是编译期静态配置的，而游戏目录由用户在运行时选定。官方文档原话：「Permissions alone do not grant a scope」——只开 `fs:allow-read-file` 不授予任何路径的访问权。必须在运行时调 `fs_scope().allow_directory()`。音效试听走 asset protocol，因此 `asset_protocol_scope()` 也要同步授权。

**`write_atomic` 不可省。** `fsync` 没有 JS API，纯 JS 只能做到 `write → rename`。spec §6.4 要求 `.tmp → fsync → rename`；省掉 fsync 会在安全承诺上缺一角，而本软件的全部卖点就是安全。

插件三个：`plugin-fs`、`plugin-dialog`、`plugin-persisted-scope`。**`persisted-scope` 必须注册在 `fs` 之后**，否则授权不会跨重启保留且静默失效（官方文档明确警告）。

### 3.3 游戏目录探测（locate.ts）

1. 试 `C:\Program Files (x86)\Steam\steamapps\common\FPSAimTrainer`
2. 扫 `D:`–`Z:` 的 `SteamLibrary\steamapps\common\FPSAimTrainer`
3. 全不中 → `plugin-dialog` 选目录

**校验方式是看内容而非路径长相**：目录下必须同时存在 `FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json` 与 `FPSAimTrainer/sounds`。选定后立即 `invoke("grant_game_dir")`，再存入 appdata。

不做 Steam 注册表探测（原 spec §3.1 本就允许 v1 跳过），省掉一块只能在真机调的 Rust。

### 3.4 MemoryAdapter

`Map<string, Uint8Array>` 实现全部十个方法，`isGameRunning` 由测试直接摆布。可从语料 dump 预载，`dev:web` 靠它在浏览器里跑——**不需要 Rust 工具链就能做 UI**。

## 4. 状态层与命令层

```ts
type AppState = {
  phase: "locating" | "ready" | "fatal"
  gameDir: string | null
  paths: GamePaths | null          // 由 gameDir 派生
  themes: Theme[]
  themeFailures: ScanFailure[]
  currentThemeName: string | null
  sounds: string[]
  binding: SoundBinding | null
  audio: AudioLevels | null
  draft: { binding: SoundBinding; audio: AudioLevels } | null
  crosshairs: string[]
  profiles: Profile[]
  backups: BackupEntry[]
  gameRunning: boolean
  busy: { label: string } | null
  toast: { kind: "ok" | "warn" | "error"; message: string } | null
}
```

命令一律形如 `(deps, args) => Promise<Event>`，`deps = { adapter, backup, profiles, paths }`：

| 命令 | 内核调用 |
|---|---|
| `bootstrap` | `locate` → `grant_game_dir` → `backup.ensurePristine` → `refreshAll` |
| `refreshAll` | `scanThemes` / `listSounds` / `readSoundBinding` / `readAudioLevels` / `readKey(CurrentThemeName)` / `backup.list` / `profiles.list` |
| `applyTheme` | `themeToPatch` → `applySettingsPatch(allow: THEME_KEYS)` |
| `applySounds` | `soundsToPatch` → `applySettingsPatch(allow: SOUND_KEYS)` |
| `applyProfile` | `checkThemeDrift` → 合并两个 patch **一次写**，`allow: THEME_KEYS ∪ SOUND_KEYS` |
| `saveProfile` | `captureCurrent` → `save` |
| `rollback` / `restorePristine` | `backup.restore(id)` → `refreshAll` |
| `installAssets` | `installTheme` / `sanitizeFileName` + `copyFile` |

「应用配置档」是壳层职责——内核只提供 `captureCurrent` / `list` / `save` / `remove` / `checkThemeDrift`，不含把一档套回去的函数。

`applyProfile` 合并成一次写是有意的：`SettingsPatch` 是 `Partial<Record<Section, Record<string, JsonValue>>>`，浅合并即可；写两次会产生两条备份记录，回滚时用户要点两次才回得到原位。

**跨页失效只有一条规则**：任何 `ok: true` 的写入，reducer 一律重刷 `currentThemeName` + `binding` + `audio` + `backups` 并清空 `draft`。不做细粒度失效。139 个 theme 的重扫是唯一较慢的操作，只在 `installAssets` 后触发。

## 5. 界面行为

### 5.1 背景页

列表 + 搜索 + 当前项高亮。选中项右侧显示材质／颜色／天空的**文本摘要**（B2 在此位置换成 3D 预览）。「应用」为显式按钮。

底部独立分区「无法读取（N）」展开显示 `scan.failures` 的路径与原因——不静默吞掉。

支持从磁盘安装 `.json`，走 `installTheme`（自动文件名净化与 `themeName` 对齐）。

### 5.2 音效页

实测 `PrimaryUserSettings.json` 中的六个音效槽，这份社区包只绑了三个（`KillConfirmedSound: saya_kick_deeper`、`SpawnSound: Bell5`、`MBSChangeNowSound: spawn05`，三个 MBS 槽为 `None`）。因此不做六槽平铺：

1. **击杀确认 / 重生**——两个主槽平铺，覆盖绝大多数使用场景
2. **MBS 四档**——折叠分组，组头即 `OverrideMBSChangeNowSound` 开关
3. **击打音**——`HitVolume` / `HitPitch` / `CritVolume` / `CritPitch` / `PitchHitModifier`，默认折叠
4. **全局音量**——`Master` / `SFX` / `Miss` / `Enemy` / `Music` / `Misc` / `Footstep` / `Player` / `Teammate`，默认折叠

下半是可搜索的音效列表（语料 478 个），每行一个 ▶ 试听。

改动进 `draft`，顶部出现「有未应用的改动」条，点「应用」才写盘。**不做拖完即写**——每拖一次滑块就写一次会产生一条备份，回滚列表会被淹掉。

试听走 `convertFileSrc(path)` 喂 `<audio>`，依赖 §3.2 的 `asset_protocol_scope` 授权。`dev:web` 模式下试听按钮禁用并注明原因：MemoryAdapter 没有真实文件可播，这是刻意降级而非缺陷。

### 5.3 准星页

缩略图网格 + 安装 / 删除。页顶常驻说明：准星的选中状态不在这三个配置文件中（spec §2.2 已全文搜索 `cross`/`hair`/`reticle`/`sight` 确认零命中），此页只管素材库，切换需进游戏点选。

### 5.4 配置档栏

常驻顶部。「存为配置档」抓取当前状态。应用某档前先 `checkThemeDrift`：

- `changed` → 警告「这档引用的 theme 文件已被改动，套上去的不是当初存的那个」，允许继续
- `missing` → 禁止应用，指明缺哪个文件

### 5.5 回滚

备份列表按时间倒序，每条带 label（如「应用背景: 3 AM」）。「恢复出厂快照」独立成键并二次确认。

## 6. 错误处理与边界状态

这七个状态同时就是页级测试的用例表：

| 状态 | 来源 | UI 行为 |
|---|---|---|
| 游戏在跑 | `reason: "game-running"` | 顶部常驻 banner；写入失败时原样显示内核的中文提示（它已解释「游戏退出会覆盖改动」） |
| 目录没找到／选错 | `locate` 校验失败 | `phase: "locating"`，引导重选并说明该选哪一层 |
| 权限不足 | `reason: "io-error"` 且消息含 `os error 5` / `permission denied` | 提示「以管理员身份运行，或把游戏移出 `Program Files`」 |
| 配置档 drift | `checkThemeDrift` | 见 §5.4 |
| 写入失败已回滚 | `ok: false, rolledBack: true` | toast 明说「已回滚，存档未受影响」 |
| 写后校验失败 | `reason: "verify-failed"` | 同上 |
| theme 解析失败 | `scan.failures` | 背景页底部分区逐条显示 |

第三行即原 spec §5.4 的 **C8（权限不可用）**，计划 A 明确留给计划 B。分类逻辑放在 `platform/errors.ts`，是纯函数，可单测——不需要真造出权限错误。

## 7. 测试策略

Vitest 拆两个 project：`node` 环境跑 `packages/core`（现有 170 个测试不动），`jsdom` 环境跑 `packages/app`。

- **纯函数单测**：`reducer`、`locate` 的候选与校验、`errors.ts` 的分类、命令的编排逻辑
- **页级测试**（RTL + MemoryAdapter）：五处 UI，用例表为 §6 七行 + 各页主流程
- **不测**：样式、滚动虚拟化、Three.js（B2）
- **`TauriAdapter` 不单测**——它是一层薄映射，真值靠 Windows 验收

## 8. 对上游 spec 的修订

实测 `PrimaryUserSettings.json` 后发现原 spec §5.1 的 `SOUND_KEYS` 有两处缺口，本计划予以补齐（详见同日对上游 spec 的修订提交）：

**缺口一：`OverrideMBSChangeNowSound` 未纳入白名单。** 实测该布尔为 `False`，而 `MBSChangeNowSound` 却设了 `spawn05`。键名直白地表示「覆盖 MBS ChangeNow 音效」，`False` 很可能意味着该绑定当前不生效。若属实，用户在软件里选了 MBS 音效、点应用、进游戏没反应——差评级别的缺陷，且用户会归咎于软件。

**缺口二：音量键只收了四个。** 实测这份社区包刻意调过 `MissVolume: 0`（关 miss 音）、`FootstepVolume: 0`（关脚步声）、`MusicVolume: 0`、`EnemyVolume: 0.75`。原白名单只有 `HitVolume` / `HitPitch` / `CritVolume` / `CritPitch`，导致「复刻这套音效」会漏掉明显属于该配置的部分，B2 的整包导入也跟着漏。

补入的键：`OverrideMBSChangeNowSound`（boolean）、`MasterVolume` / `SFXVolume` / `MissVolume` / `EnemyVolume` / `EnemyPitch` / `MusicVolume` / `MiscVolume` / `FootstepVolume` / `PlayerVolume` / `PlayerPitch` / `TeammateVolume` / `TeammatePitch`（float）、`PitchHitModifier`（integer）。

这些键均不影响瞄准手感（`NEVER_WRITE` 管的是 sens / DPI / FOV），补入在安全上无风险。

**影响面**：`keys.ts`、`AudioLevels` 类型、`readAudioLevels` / `soundsToPatch`、`ProfileStore.captureCurrent` 及对应测试。`Profile` 是 spec §11 约定的网站下载格式，格式变更有下游影响，因此安排在 B1 最开头做完——紧接在 §9 的验证轮之后，因为 `OverrideMBSChangeNowSound` 怎么写取决于验证轮第 4 项的结论。

## 9. Windows 真机验证

真机接触分两轮，不要混为一谈：

- **验证轮（B1 开头）**——下列五项，全部是「手改配置文件 → 进游戏 → 观察」，不需要软件存在。第 4 项的结论直接决定 §8 白名单怎么补，所以必须排在补白名单之前。
- **验收轮（B1 收尾）**——用做好的软件走完整流程，见本节末尾的清单。

原 spec §10 四项，加本次新增第 4 项：

0. `CurrentThemeName` 认文件名还是内部 `themeName`（28/137 不一致，优先级最高）
1. `WallMat` / `FloorMat` 整数键的作用（决定两个 gated 键能否解禁）
2. `setEnemyBodyColorAsAttackColor` → `EnemyAttacksColoredByBody` 映射是否属实
3. 应用 theme 后是否需要同步 `OverrideAllNewMapMaterials`
4. **`OverrideMBSChangeNowSound` 是否为 MBS 音效的生效前提**（新增）

第 4 项的验证方法：手改该布尔为 `True` / `False` 各进一次游戏，听 MBS 音效是否变化。

验收轮（兼发版前）清单：应用 theme → 开游戏确认观感 → 换音效确认听得到 → 回滚 → **确认 `XSens` / `YSens` / `DPI` / `FOV` 逐字节未变**。

## 10. B1 边界

**交付**：定位游戏目录、三个 UI 页、配置档栏、备份回滚、音效试听、Windows 验收通过的可用软件。

**留给 B2**：3D 预览（背景页右侧已预留位置）、整包导入向导、`Profile.extras` 的 `Palette.ini` / `UI.json` 填充。

**不做**：准星一键切换（机制不存在）、联网、Steam 注册表探测。

## 11. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 计划切分 | B1 / B2 两段 | 原计划 B 比计划 A 还大；3D 预览不该挡住主流程 |
| UI 框架 | React + Vite + Tailwind | B2 的 `@react-three/fiber`；与网站子项目复用组件 |
| 状态层 | 单一 store + 命令层 | 写入是全局副作用，分散到各页必然刷新不同步 |
| UI 测试深度 | 页级全测 | B2 要往背景页里塞 3D 预览，会动到这些页，需要安全网 |
| Rust 用量 | 三个 command 约 50 行 | 权限授权与 fsync 无 JS 替代 |
| Steam 注册表 | 不做 | 原 spec 允许 v1 跳过；省一块只能真机调的 Rust |
| 音效滑块 | 草稿 + 显式应用 | 拖完即写会用备份记录淹掉回滚列表 |
| 音效槽布局 | 两主槽 + 三个折叠组 | 实测六槽中仅三个被绑定，平铺是过度设计 |
