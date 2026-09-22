# KovaaK Config Manager — 设计文档

- 日期：2026-09-02
- 状态：已确认，待转实现计划
- 范围：桌面端配置管理器（v1）。配套网站为独立子项目，本文档只为其预留数据格式。

---

## 1. 背景与目标

KovaaK（FPSAimTrainer）的观感配置散落在三个互不相邻的磁盘位置，社区流传的配置包（如本仓库的 `KVK Settings 2025`）通常是一个带 readme 的文件夹，需要用户手工把文件拷到正确目录、再进游戏逐项点选。换一次背景要经历「改文件 → 重启游戏 → 看一眼 → 不满意 → 再改 → 再重启」的循环。

本项目要消灭这个循环：

1. 把三类素材（背景 / 音效 / 准星）统一管理起来
2. **背景和音效支持一键切换**，且切换前能在软件内看到／听到效果
3. 支持整包导入社区配置，逐项勾选
4. 全程不破坏用户的手感设置，且任何一次写入都可回滚

### 非目标（v1 明确不做）

- 手感设置（sens / DPI / FOV 等）——**永不写入**，见 §5.1
- `Palette.ini` 与 `UI.json` 的细粒度编辑——仅在整包导入时整体覆盖
- 准星的一键切换——准星选择不由这三个配置文件决定，v1 只做素材库管理
- 在线网站——独立子项目，本文档只约束配置档格式使其可复用

---

## 2. 领域知识（实测结论）

以下全部基于对 `KVK Settings 2025` 的实际解析，不是推测。

### 2.1 三类素材的磁盘位置

以 Steam 默认安装为例（盘符可变，需自动探测 + 手动兜底）：

| 类别 | 路径 |
|---|---|
| 准星 | `<Steam>\steamapps\common\FPSAimTrainer\FPSAimTrainer\crosshairs\` |
| 音效 | `<Steam>\steamapps\common\FPSAimTrainer\FPSAimTrainer\sounds\` |
| 背景 | `<Steam>\steamapps\common\FPSAimTrainer\FPSAimTrainer\Saved\SaveGames\Themes\` |

另有两个配置文件位置：

| 文件 | 路径 |
|---|---|
| `PrimaryUserSettings.json`、`UI.json` | `...\FPSAimTrainer\FPSAimTrainer\Saved\SaveGames\` |
| `Palette.ini` | `%LOCALAPPDATA%\FPSAimTrainer\Saved\Config\WindowsNoEditor\` |

### 2.2 关键认知：素材目录 ≠ 生效

把文件放进上述目录，只让它**可被选择**，不等于**正在使用**。「当前用的是哪个」记在别处，而且三类各不相同：

| 类别 | 「当前选中」存哪 | 一键切换 |
|---|---|---|
| 音效 | `PrimaryUserSettings.json` → `KillConfirmedSound` / `SpawnSound` / `MBS*Sound` | ✅ 机制确定 |
| 背景 | `PrimaryUserSettings.json` → `CurrentThemeName` + 展开的材质／颜色／天空字段 | ✅ 机制确定 |
| 准星 | **不在这三个配置文件中**（已全文搜索 `cross`/`hair`/`reticle`/`sight`，零命中） | ❌ v1 不做 |

因此「换音效」不是拷 `.ogg` 文件，而是改一个字符串字段；「换背景」不是拷 `.json` 文件，而是把 theme 的字段值展开写入 `PrimaryUserSettings.json`。

### 2.3 Theme 文件实测统计（139 个样本）

**材质是一个小的闭集——只有 24 种，前 8 种覆盖约 90%：**

```
111  MARBLE POLISHED            9  GRID 8                     3  WOOD PARQUET
 61  WHITE WOOD BOARD           9  CONCRETE POURED            3  GRID 16
 35  PURE COLOR                 6  BIANCA CARRARA MARBLE TILES 2  METAL STEEL
 28  BRICK CLAY BEVELED         4  BRICK DARK                 2  METAL SHEET
 23  GREY WOOD BOARD            4  BRICK CLAY NEW             2  BLACK MARBLE TILES
 22  CONCRETE TILES             3  WOOD PLANK CLEAN           1  SCIFI WALL / ROCK SLATE
 18  DRYWALL                                                  1  CONCRETE BASIC / CHECKERBOARD 8
 15  BRICK GREY
```

- `skyPresetId`：0–13，共 14 档
- `cloudCoverId`：0–5，共 6 档

**Schema 是演进的**，老 theme 缺新字段（138 个成功解析的样本中）：

| 字段组 | 出现数 |
|---|---|
| 核心 24 字段（`themeName`、`wall*`、`floor*`、`enemy*Color`、`sky*`） | 138（全部） |
| `teamGlowUp*` / `enemyGlowUp*` | 130 |
| `*TextureScale`、`*ColorOnHit`、`*ColorOnLookAt`、`changeEnemyColorOn*` | 117 |
| `ceiling*` / `ramp*` | 110 |

**编码不统一**：`Smári-ctrl.json` 为 UTF-16（首字节 `0xFF`），标准 UTF-8 解析直接抛错。

### 2.4 素材规模

| 类别 | 数量 | 体积 |
|---|---|---|
| 音效 `.ogg` | 482 | 8.3 MB |
| 准星 `.png` | 73（+1 个 `.png~` 备份） | 2.2 MB |
| 背景 `.json` | 139 | 560 KB |

---

## 3. 架构

```
┌─ UI 层 ─────────────────────────────────────────────┐
│  配置档栏 · 背景 / 音效 / 准星 三个页                 │
│  实时 3D 预览（Three.js）· 音效试听                   │
├─ 领域层（纯 TypeScript，纯函数，可单测）─────────────┤
│  ThemeParser     容错解码 + 缺省字段填充              │
│  ThemeApplier    theme → PrimaryUserSettings 映射     │
│  SoundBinder     音效绑定与音量／音调                 │
│  ProfileStore    配置档（存引用，不拷文件）           │
│  FieldPolicy     白名单 + 黑名单双保险                │
│  PackImporter    整包导入                             │
├─ 安全层 ────────────────────────────────────────────┤
│  GameProcessGuard  游戏在跑则拒写                     │
│  BackupManager     pristine 快照 + 增量备份 + 回滚    │
│  AtomicWriter      tmp → fsync → rename               │
├─ 平台层（PlatformAdapter 接口）─────────────────────┤
│  GameLocator       Steam / 独立安装 / 手动指定        │
│  TauriAdapter · MockAdapter                           │
└──────────────────────────────────────────────────────┘
```

### 3.1 技术栈：Tauri（Rust 尽可能薄）

选 Tauri 的理由：本软件本质是「大量文件操作 + 一个 3D 预览」，Rust 侧管前者稳，WebView 管后者现成；成品 8–15 MB，对面向玩家分发的工具很重要。

**开发者不熟 Rust，因此架构上把 Rust 压到最小。** Tauri 官方 `fs` / `dialog` / `opener` 插件在 TypeScript 侧即可完成读写、重命名、目录选择，所以领域逻辑一行 Rust 都不需要。真正需要下沉的只有两项：

```rust
// 1. 游戏进程检测（sysinfo，约 15 行）——安全层的地基
#[tauri::command]
fn is_game_running() -> bool { /* processes_by_name("FPSAimTrainer") */ }

// 2. 从注册表读 Steam 安装路径（winreg，约 20 行）
//    v1 可先跳过：试常见路径 → 失败则弹目录选择框
```

v1 的 Rust 总量预计 30–50 行。

### 3.2 PlatformAdapter：技术栈可逆 + Mac 可开发

```ts
interface PlatformAdapter {
  isGameRunning(): Promise<boolean>
  locateGameDir(): Promise<string | null>
  readFile(p: string): Promise<Uint8Array>
  writeFileAtomic(p: string, data: Uint8Array): Promise<void>
  listDir(p: string): Promise<string[]>
  stat(p: string): Promise<{ size: number; mtime: number }>
}
```

三个实现：`TauriAdapter`（生产）、`ElectronAdapter`（退路）、`MockAdapter`（测试与 Mac 开发，指向本地 `KVK Settings 2025` 仿真目录）。

这带来三个性质：

1. **技术栈可逆**——领域逻辑 100% 在 TS，改投 Electron 只需重写 adapter（几十行），UI 与领域代码不动
2. **Mac 上可跑完整流程**——开发机为 macOS，Windows 真机只做验收
3. **领域逻辑可在 Node 里单测**——不需要起 GUI

---

## 4. 数据模型

### 4.1 Theme（解析后的规范形态）

解析器输出**字段齐全**的规范对象，缺失字段由默认值表补齐，下游不需要判空。

```ts
type Surface = {
  material: string          // 24 种之一
  tint: Vec3                // 0–1
  roughness: number
  metallic: number
  fullBright: number        // 0 = 正常受光，1 = 完全自发光
  textureScale: number      // 缺省 1
}

type Theme = {
  name: string
  wall: Surface; floor: Surface
  ceiling: Surface; ramp: Surface      // 缺失时回退到 wall/floor 的值
  enemy: {
    headColor: Vec3; bodyColor: Vec3
    headColorOnHit: Vec3; bodyColorOnHit: Vec3
    headColorOnLookAt: Vec3; bodyColorOnLookAt: Vec3
    roughness: number; metallic: number; fullBright: number
    overrideHead: boolean; overrideBody: boolean
    changeOnHit: boolean; changeOnLookAt: boolean
    bodyColorAsAttackColor: boolean
    glowUp: { head, body, headOnHit, bodyOnHit, headOnLookAt, bodyOnLookAt: number }
  }
  team: { glowUpHead: number; glowUpBody: number }
  sky: {
    presetId: number        // 0–13
    cloudCoverId: number    // 0–5
    solid: boolean
    sunVisible: boolean
    color: Rgba             // b,g,r,a 各 0–255
  }
  _source: { path: string; encoding: string; missingFields: string[] }
}
```

`_source.missingFields` 保留原始缺字段列表，供 UI 提示「此 theme 较旧，天花板／斜坡将沿用墙面设置」。

### 4.2 Profile（配置档）

配置档**存引用不存文件**——482 个音效 8.3 MB，每档拷一份不可接受。

```ts
type Profile = {
  id: string
  name: string
  createdAt: string
  source?: { kind: "import" | "local" | "web"; author?: string; url?: string }

  theme: { name: string; hash: string } | null   // hash 检测引用文件是否被改动
  sounds: {
    killConfirmed: string | null                 // 文件名，不含扩展名
    spawn: string | null
    mbsGood: string | null; mbsOkay: string | null
    mbsBad: string | null;  mbsChangeNow: string | null
  }
  audio: { hitVolume: number; hitPitch: number; critVolume: number; critPitch: number }

  extras?: { paletteIni?: string; uiJson?: string }  // 仅整包导入时携带原文
}
```

`hash` 的作用：还原配置档时，若引用的 theme 文件已与当初不同，明确告知用户而不是默默套上改动过的版本。

此结构同时是**网站的下载格式**——`source.kind: "web"` 已预留。

---

## 5. 写入策略

### 5.1 白名单 + 黑名单双保险

`PrimaryUserSettings.json` 有 150+ 个键。原则：**默认一个都不写**，只写白名单内的键。

**`THEME_KEYS`（应用背景时写入）**

- `stringSettings`：`CurrentThemeName`、`WallMaterial`、`FloorMaterial`、`CeilingMaterial`、`RampMaterial`
- `integerSettings`：`SkyPreset`、`CloudCover`、`WallMat`、`FloorMat`（后两者**待 §10.1 验证后才启用**；在验证完成前不写入）
- `floatSettings`：`{Wall,Floor,Ceiling,Ramp}{Roughness,Metallic,FullBright,TextureScale}`、`Enemy{Roughness,Metalic,FullBright}`、`Team{Roughness,Metallic,FullBright}`、`{Enemy,Team}GlowUp*`、`OnHitColorFade{In,Out}`、`OnLookAtColorFade{In,Out}`
- `vectorSettings`：`{Wall,Floor,Ceiling,Ramp}Color`、`Enemy{Head,Body}Color{,OnHit,OnLookAt}`、`Team{Head,Body}Color`
- `colorSettings`：`SkyColor`
- `booleanSettings`：`OverrideEnemy{Head,Body}Color`、`ChangeEnemyColorOn{Hit,LookAt}`、`EnemyAttacksColoredByBody`、`SolidSkyColor`、`ShowSunInSkybox`

**`SOUND_KEYS`（应用音效时写入）**

> 2026-09-03 修订：实测 `PrimaryUserSettings.json` 后补入下列加粗项，理由见 `2026-09-03-kovaak-shell-b1-design.md` §8。补入的键均不影响瞄准手感，安全上无风险。

- `stringSettings`：`KillConfirmedSound`、`SpawnSound`、`MBSGoodSound`、`MBSOkaySound`、`MBSBadSound`、`MBSChangeNowSound`
- `floatSettings`：`HitVolume`、`HitPitch`、`CritVolume`、`CritPitch`、**`MasterVolume`**、**`SFXVolume`**、**`MissVolume`**、**`EnemyVolume`**、**`EnemyPitch`**、**`MusicVolume`**、**`MiscVolume`**、**`FootstepVolume`**、**`PlayerVolume`**、**`PlayerPitch`**、**`TeammateVolume`**、**`TeammatePitch`**
- `integerSettings`：**`PitchHitModifier`**
- `booleanSettings`：**`OverrideMBSChangeNowSound`**（**待 §10.4 验证后才启用**；在验证完成前不写入）

补入原因有二。其一，实测该布尔为 `False` 而 `MBSChangeNowSound` 却设了 `spawn05`，键名直白地表示「覆盖 MBS ChangeNow 音效」，若 `False` 意味着绑定不生效，则用户选了 MBS 音效却听不到变化，会归咎于软件。其二，实测社区包刻意调过 `MissVolume: 0`（关 miss 音）、`FootstepVolume: 0`（关脚步声）、`MusicVolume: 0`、`EnemyVolume: 0.75`——只收四个音量键会让「复刻这套音效」漏掉明显属于该配置的部分。

**`NEVER_WRITE`（黑名单，第二道闸）**

`XSens`、`YSens`、`DPI`、`FOV`、`FOVScaleString`、`SensScaleString`、`CustomYaw`、`CustomFOVYawMult`、`FOVScalarTargetEnum`、`SensitivityScaleTargetEnum`、`FILMSCustomFOV`、`FILMSCustomAspectX`、`FILMSCustomAspectY`。

写入前无条件从 patch 中剔除这些键，**与白名单相互独立**——两者同时失效才会误改手感。

其余所有键：不读不写，原样保留。

### 5.2 Theme → PrimaryUserSettings 映射表

**这张表必须逐条人工核对并在真机验证，不能靠命名规则推导**，因为游戏本身命名不一致。已确认的不规则项：

| Theme 字段 | PrimaryUserSettings 键 | 不规则之处 |
|---|---|---|
| `wallTint` | `EVectorSettingId::WallColor` | Tint → Color |
| `floorTint` | `EVectorSettingId::FloorColor` | 同上 |
| `ceilingTint` | `EVectorSettingId::CeilingColor` | 同上 |
| `rampTint` | `EVectorSettingId::RampColor` | 同上 |
| `enemyColorFullBright` | `EFloatSettingId::EnemyFullBright` | 丢掉 `Color` |
| `enemyColorRoughness` | `EFloatSettingId::EnemyRoughness` | 丢掉 `Color` |
| `enemyColorMetallic` | `EFloatSettingId::EnemyMetalic` | **游戏拼写错误，少一个 `l`** |
| `sunVisible` | `EBooleanSettingId::ShowSunInSkybox` | 完全换名 |
| `skyPresetId` | `EIntegerSettingId::SkyPreset` | 去掉 `Id` |
| `cloudCoverId` | `EIntegerSettingId::CloudCover` | 去掉 `Id` |
| `setEnemyBodyColorAsAttackColor` | `EBooleanSettingId::EnemyAttacksColoredByBody` | 完全换名（**待验证**） |

其余字段为直译（`wallRoughness` → `WallRoughness` 等）。

### 5.3 缺失字段的回退规则

| 缺失字段 | 回退 |
|---|---|
| `ceiling*` | 沿用 `wall*` 对应值 |
| `ramp*` | 沿用 `floor*` 对应值 |
| `*TextureScale` | `1` |
| `*GlowUp*` | `1` |
| `*ColorOnHit` / `*ColorOnLookAt` | 沿用对应的基础颜色 |
| `changeEnemyColorOn*` | `false` |

回退发生时记入 `_source.missingFields` 并在 UI 提示。

### 5.4 文件替换的兼容性契约

这一节约束**安装一个来源不明的 theme / 音效 / 准星文件**时的行为。网站上线后，文件来自任意上传者，文件名与内容都不可信；桌面端 v1 的整包导入同样面对这个问题。以下是硬性契约。

**C1 — 身份对齐。** 安装 theme 时，文件名 stem 与文件内部 `themeName` 必须相等。实测样本中 137 个可解析 theme 有 28 个不满足此条。安装流程须选定一个规范名 `N`，同时写入文件名 `N.json` 与内容中的 `themeName: N`。这使 `CurrentThemeName` 无论被游戏按哪种方式读取都得到同一个值（§10.0）。

**C2 — 文件名净化。** 规范名 `N` 由展示名净化得到，规则固定且可测：
- 替换 Windows 非法字符 `< > : " / \ | ? *` 与所有控制字符（U+0000–U+001F）为 `_`
- 去除首尾空白，去除结尾的 `.` 与空格（Windows 会静默丢弃它们，导致文件名与预期不符）
- 空结果或纯 `.` 组成的结果回退为 `unnamed`
- Windows 保留名（`CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9`，不区分大小写，含带扩展名形式）追加 `_`
- 截断到 100 字符（为路径长度留余量），截断后若与已有文件冲突，追加 `-2`、`-3`
- 非 ASCII 字符保留（样本中已有 `Smári-ctrl.json`，游戏可正常读取）

**C3 — 大小写冲突。** Windows 与 macOS 默认文件系统不区分大小写。安装前须按小写形式检测冲突，避免 `Dark.json` 静默覆盖 `dark.json`。

**C4 — 引用完整性。** 写入 `KillConfirmedSound` 等音效字段前，必须确认 `sounds/` 下存在同名文件；写入 `CurrentThemeName` 前，必须确认对应 theme 文件存在。绑定一个不存在的资源会让游戏静音或回退到默认，且用户无从得知原因。校验失败时拒绝写入并明确报告缺失的资源名。

**C5 — 未知键策略。** 游戏版本更新可能重命名或删除设置键（`EnemyMetalic` 这个拼写错误随时可能被修正）。写入时对目标文件中**不存在**的键采取「跳过并记录」而非「新增」——新增一个游戏不认识的键是无害的死数据，但它会掩盖"我们的映射表已经过时"这一事实。跳过并在 UI 报告「本次有 N 个设置项未能写入，可能是游戏版本变化」，使问题可见。

**C6 — 幂等性。** 同一个 theme 连续应用两次，第二次产生的文件内容必须与第一次逐键相等。这是回归测试的固定断言。

**C7 — 批量操作的部分失败。** 整包安装 50 个文件时若第 30 个失败，已拷贝的 29 个保留、失败项记入报告、流程继续处理剩余文件。素材文件互相独立，不需要事务语义；但 `PrimaryUserSettings.json` 的写入是单文件原子操作，不受此条约束。

**C8 — 权限不可用。** 游戏目录位于 `C:\Program Files (x86)\` 下，写入可能被拒。此类失败必须与"文件损坏"区分开，并给出可操作的提示（以管理员身份运行，或将游戏移出 Program Files），而不是笼统的写入失败。

---

## 6. 安全层

1. **进程守卫**——写入前检查 `FPSAimTrainer` 是否运行，运行中一律拒写并提示先退出游戏。KovaaK 退出时会用内存中的设置回写覆盖磁盘，这是同类工具最典型的失败模式：改动静默丢失，用户以为软件坏了。
2. **pristine 快照**——首次运行强制把三类目录与三个配置文件原样存一份，**永不自动删除**，作为终极还原点。
3. **增量备份**——每次写入前快照受影响文件到 `<appdata>/kvk-config/backups/<timestamp>/`，保留最近 20 次，UI 提供可视化回滚列表。
4. **原子写**——`.tmp` → `fsync` → `rename`，杜绝写到一半的 JSON 损坏存档。
5. **写后校验**——写入完成后重新读取并解析，确认 JSON 合法且黑名单字段值与写入前一致；不一致则自动回滚并报错。

---

## 7. 实时 3D 预览

### 7.1 目的与定位

外部改文件必须重启游戏才生效，因此软件内预览是核心功能而非装饰——它把「改→重启→看→再改→再重启」压缩为「调到满意→写一次→重启一次」。

**定位是高保真近似，不是所见即所得。** UE4 的 tonemapping、用户的 `Gamma`（本样本为 1.8）、bloom、真实 HDR 天空盒、场景灯光布置都无法复刻。预览的职责是**把 139 个候选筛到 3 个**。UI 角落需常驻一行说明，避免用户预期落空。

### 7.2 实现

- Three.js 盒子房间：四面墙 + 地板 + 天花板 + 一段斜坡
- 一个目标体，形状可切换（Cuboid / Spheroid / Cylindrical，对应 `currentlySelectedBoundingBoxType`）
- 材质映射到 `MeshStandardMaterial`：`tint` → `color`，`roughness` → `roughness`，`metallic` → `metalness`，`textureScale` → UV 重复
- `fullBright` 无标准对应，用自定义 shader：`mix(受光结果, tint, fullBright)`
- 天空：14 个 preset 做 14 组近似渐变天空盒，叠加 6 档云量；`solidSkyColor` 为真时直接用 `skyColor` 纯色
- 相机：轨道控制，另提供一个「玩家视角」预设按钮

### 7.3 贴图资源

24 套 CC0 PBR 贴图（ambientCG 等素材库有对应的 marble / wood / brick / concrete / drywall），随软件分发，版权干净。`PURE COLOR` 走纯色不贴图。

**做成可替换资源包**：贴图目录结构与材质名一一对应，将来若改为从用户自己的游戏安装中提取真实贴图，架构不需要改动。

---

## 8. 解析器容错

「导入某个 theme 就闪退」是同类工具最常见的差评来源。要求：

1. **编码嗅探**——按 BOM 与字节分布判定 UTF-8 / UTF-16LE / UTF-16BE，全部转为内部 UTF-8。样本中 `Smári-ctrl.json` 即为 UTF-16。
2. **单文件失败隔离**——一个文件解析失败不影响其余 138 个；失败项进入「无法读取」列表并显示原因，不静默吞掉。
3. **缺失字段按 §5.3 回退**，不抛错。
4. **非法值钳制**——颜色分量钳到 `[0,1]`，`skyPresetId` 越界回退到 0，并记入 `missingFields` 同类的告警列表。

---

## 9. 测试策略

- **领域层单测（Vitest）**——领域逻辑全为纯函数。**以本仓库 139 个真实 theme 文件作为 fixture**，含 UTF-16 的那个。断言：138 个解析成功、字段齐全、回退规则正确、映射表输出与手工核对的期望值一致。
- **写入安全测试**——构造含全部 150+ 键的 `PrimaryUserSettings.json`，应用一个 theme 后断言：白名单外的键**逐字节不变**，黑名单键值不变，JSON 仍合法。
- **集成测试（Mac 可跑）**——`MockAdapter` 指向本地 `KVK Settings 2025` 副本，跑完整「导入 → 应用 → 备份 → 回滚」流程。
- **Windows 真机验收清单**——见 §10。

---

## 10. 待真机验证事项

以下五项在 Windows 上确认后才能定稿对应实现：

0. **`CurrentThemeName` 认文件名还是认文件内部的 `themeName`。** 实测 137 个可解析的 theme 中有 **28 个（约 20%）两者不一致**（如 `Hauntr.json` 内部为 `idk3`、`Snowi BgSteel.json` 内部为 `snowi_bgSteel_17-09-21`）。写错则该 theme 应用后无效。**优先级高于下列各项。**

   验证方法：把 `Hauntr.json` 放入 Themes 目录，游戏内选中它，退出后看 `CurrentThemeName` 的值是 `Hauntr` 还是 `idk3`。

   无论结果如何，实现上都采取**消除歧义**策略而非依赖该结论：安装 theme 时强制令文件名 stem 与内部 `themeName` 相等（见 §5.4），使两种读法得到同一个值。该验证项用于确认对齐时应以哪一侧为准。

1. **`WallMat` / `FloorMat` 整数字段的作用。** `integerSettings` 中存在 `WallMat: 50`、`FloorMat: 0`，与 `stringSettings` 的 `WallMaterial`、`FloorMaterial` 并存，但**没有对应的 `CeilingMat` / `RampMat`**。需确认游戏读的是字符串还是整数索引——若只读整数，仅写字符串将不生效。验证方法：游戏内换墙面材质，退出后 diff `PrimaryUserSettings.json`。
2. **`setEnemyBodyColorAsAttackColor` → `EnemyAttacksColoredByBody` 的映射。** 命名合理但未证实。
3. **应用 theme 后是否需要同步 `OverrideAllNewMapMaterials`。** 该布尔值在样本中为 `true`，可能是材质覆盖生效的开关。
4. **`OverrideMBSChangeNowSound` 是否为 MBS 音效的生效前提。**（2026-09-03 新增）实测该布尔为 `False`，而 `MBSChangeNowSound` 却设了 `spawn05`。若该开关确为前提，则软件写入 MBS 音效时必须同步置 `True`，否则用户听不到任何变化。**应在把它补进 §5.1 白名单之前先验，避免按猜测写代码。** 验证方法：手改该布尔为 `True` / `False` 各进一次游戏，听 MBS 音效是否变化。

验收清单（每次发版前跑一遍）：应用一个 theme → 开游戏确认观感与预览一致 → 换一个音效 → 确认击杀音变化 → 回滚 → **确认 `XSens` / `YSens` / `DPI` / `FOV` 逐字节未变**。

---

## 11. 与网站子项目的接口

网站为独立子项目，独立走设计 → 计划 → 实现循环。本文档为其预留：

- **下载格式即 §4.2 的 `Profile`**，`source.kind: "web"` 已定义
- **Theme 的规范形态（§4.1）即上传时的解析目标**，网站可复用同一个 `ThemeParser`（纯 TS，无平台依赖）
- 桌面端 v1 不含任何联网代码；网站上线后以「导入 URL」形式接入，不改动领域层

---

## 12. 实现计划的切分建议

本设计的体量超出单个实现计划的合理范围（解析器、写入层、安全层、配置档、3D 预览、三个 UI 页、整包导入）。建议切成两个计划顺序执行：

**计划 A — 内核（无 UI）**
`PlatformAdapter` + `MockAdapter` → `ThemeParser`（含容错与回退）→ `FieldPolicy` → `ThemeApplier` 映射表 → `SoundBinder` → 安全层（守卫／备份／原子写／写后校验）→ `ProfileStore`。
全部可在 macOS 上以 139 个真实 theme 为 fixture 做 TDD，产出是一个能跑通「导入→应用→回滚」的命令行验证脚本。

**计划 B — 外壳**
Tauri 壳与 `TauriAdapter`（那 30–50 行 Rust）→ 三个 UI 页 → Three.js 预览与 24 套贴图 → 整包导入向导 → Windows 真机验收（§10）。

这样切的理由：内核是全部风险与全部测试的所在，且完全不依赖 Tauri；外壳做完之前内核就已经可验证。若中途改投 Electron，计划 A 的产出一行不变。

---

## 13. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 先做哪个子系统 | 桌面端 | 网站没有桌面端就没有内容来源；配置档格式需先在桌面端验证 |
| 切换粒度 | 单项快切 + 可存为整套 | 同时满足「今天想换个音效」与「导入大佬整套配置」 |
| 手感设置 | 完全不碰 | 误改 sens 的代价远高于「完整复刻」带来的收益 |
| 预览贴图来源 | CC0 近似贴图随软件分发 | 24 套是一次性有限成本，版权干净；做成资源包保留升级空间 |
| 技术栈 | Tauri，Rust 压到 30–50 行 | 体积小；领域逻辑全在 TS 使决策可逆 |
| 准星 | 只做素材库管理 | 选中状态不在这三个配置文件中；原始需求也只要求背景与音效一键切换 |
