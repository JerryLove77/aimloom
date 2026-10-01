<div align="center">

# Aimloom

[![CI](https://github.com/JerryLove77/aimloom/actions/workflows/ci.yml/badge.svg)](https://github.com/JerryLove77/aimloom/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/JerryLove77/aimloom?label=release)](https://github.com/JerryLove77/aimloom/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)](https://aimloom.dev)

> 给 [KovaaK's](https://store.steampowered.com/app/824270/) 玩家的 Windows 工具：把 CS2 / VALORANT 准星代码放进游戏，
> 集中管理主题、音效、准星和敌人皮肤，把喜欢的组合存成 Profile。官网的「探索」页里，玩家可以下载别人分享的
> 背景、音效和准星，也可以上传自己做的。免费，中英双语。

[**下载**](https://aimloom.dev/zh/download/) · [**探索**](https://aimloom.dev/zh/explore/) · [**功能**](#功能) · [**运行要求**](#运行要求) · [**开发**](#开发) · [**路线图**](ROADMAP.md)

简体中文 | [English](docs/README_EN.md)

</div>

## 下载

到 [aimloom.dev](https://aimloom.dev/zh/download/) 下载安装程序，页面上有它的 SHA-256。
安装程序和免安装的便携版 ZIP 都挂在 [GitHub Releases](https://github.com/JerryLove77/aimloom/releases/latest)。当前版本是 **v0.1.6**。

## 功能

- **准星（Crosshair）**：粘贴 CS2 或 VALORANT 的准星代码，微调长度、粗细、间隙、描边、颜色、中心点和透明度，生成 PNG 准星放进游戏文件夹；也可以添加自己的 PNG。用哪个准星在游戏设置里选。
- **背景、音效（Theme、Sounds）**：列出游戏里已有的主题和音效，预览后应用；从电脑选择或直接拖入文件，就能添加新的。
- **敌人（Enemy）**：和游戏自带的「皮肤浏览器」一样，给人形、方块、球三种形状各选一个游戏自带的皮肤。
- **Profile**：把一套背景和音效存成一个命名的组合，之后一步应用，也可以应用后直接通过 Steam 启动游戏。
- **快速导入（Quick import）**：在「探索」页一次拖入配置包、文件夹或单个文件，先看会加入什么，再加进游戏；已经在游戏里的不会被覆盖，个人设置只有勾选「高级」才导入（0.1.6-beta.2 起；0.1.5 里叫「一键拖入」，按类别整包安装）。

每次写入前都会先备份，随时可以撤销。Aimloom 不会改你的灵敏度、DPI 和 FOV（除非你在快速导入里勾选「高级」导入别人的个人设置，替换前同样会备份），而且只在游戏关闭时修改：KovaaK 退出时会重写它的设置文件，游戏开着时改的会被覆盖掉。

## 官网 aimloom.dev

- **[探索](https://aimloom.dev/zh/explore/)**：浏览、试听、下载别人分享的背景、音效和准星。下载的就是原文件，拖进 Aimloom 对应的页面就能用。
  - **上传**：用 Steam 登录（只拿 SteamID，不碰密码），起一个署名，选文件就能传；每次上传还有一道 Cloudflare Turnstile 真人验证。
  - 上传的文件会被严格检查：只收主题 `.json`、音效 `.wav` / `.ogg`、准星 `.png`，每个字节都要对得上格式，准星图片会重新编码。新作者的上传先经审核再公开；作者可以随时下架自己的文件。
- **反馈**：每个页面右下角的「反馈」可以直接提交工单，不用注册；留个邮箱就能收到回复。
- **[准星代码工具](https://aimloom.dev/zh/crosshair/)**：不用安装 App，在浏览器里粘贴 CS2 / VALORANT 准星代码，预览、微调、下载 PNG，全程不上传任何东西。

## 运行要求

- Windows 10 或 11，64 位。
- **WebView2**：Windows 11 自带；Windows 10 缺少时，安装程序会下载并装上（便携版不会，窗口打不开时请自己安装 Microsoft Edge WebView2 运行时）。
- v0.1.5 自带 PowerShell 7（`pwsh` 文件夹），不用另外安装；0.1.6 起不再需要 PowerShell。

Aimloom 没有代码签名，第一次运行时 Windows SmartScreen 可能会提示：点「更多信息」→「仍要运行」。下载页给出了每个文件的 SHA-256，可以用来核对下载的文件。

## 状态

- **已发布：** v0.1.6（2026-10-01）——侧边栏改成两个大页面：「探索」（快速导入、备份与恢复、官网探索页）和「更改配置」（Profile、背景、音效、准星、敌人）；改用 Rust 写的引擎读写游戏文件，安装包不再带 PowerShell 7，下载只有几 MB；快速导入改成「拖入、看一眼、加进游戏」，已经在游戏里的跳过并说明原因，个人设置放进默认收起的「高级」；Profile 改成完整快照（背景和全部音效），0.1.5 保存的 Profile 要删除后重新创建；背景和音效可以收藏。从 0.1.5 升级请先卸载旧版。它之前有两个测试版（0.1.6-beta.1、beta.2），主要的写入在测试版上、在测试电脑的真实游戏里走过；正式版在测试版之后的修复（列表刷新、关闭窗口的提示、旧 Profile 的删除等）只跑过测试，正式包本身还没有在真实游戏里用过。已知问题：从 OneDrive 同步的文件夹拖入或添加文件会被拒绝（[#30](https://github.com/JerryLove77/aimloom/issues/30)）。
- **上一个版本：** v0.1.5（2026-09-30）——自带 PowerShell 7，不用另外安装（安装程序约 81 MB，便携版约 114 MB）；背景、音效、准星页可以打开官网的探索页；连接的 Steam 账号可以改显示名。官网的探索页（Steam 登录、上传、审核）和反馈工单随这个版本一起上线。安装程序在一台全新的 Windows（Windows 沙盒）里装过并打开过。
- **更早：** v0.1.4（2026-09-22）——粘贴 CS2 / VALORANT 准星代码后微调、Profile「应用并启动游戏」、Profile 里换背景和音效时可搜索和从电脑添加、背景页搜索、设置里的「参与 Beta 测试」。v0.1.3 带来了应用内问题报告、可选的 Steam 账户、启动时检查更新、应用 Profile 和敌人皮肤。后续计划见 [ROADMAP.md](ROADMAP.md)。
- v0.1.1 和 v0.1.2 已下架：它们的 `Aimloom.exe` 里嵌着打包电脑的 Windows 用户名（在依赖库的源码路径里）。从 v0.1.3 起，打包时会替换这些路径，打包脚本也会拒绝仍带本机路径的 EXE。
- 每个功能在真实电脑和真实游戏里看到了什么、还没看到什么，维护者另有验证记录，不公开。测试通过不等于「在游戏里能用」。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `packages/app` | App：React 前端，Tauri（Rust）外壳 |
| `scripts/installer` | Windows 构建和打包脚本，以及 Rust 引擎对照的 parity goldens（旧 PowerShell 引擎留下的，已冻结） |
| `packages/app/src-tauri/src/engine` | Rust 引擎，所有写入游戏的操作都经过它（`Aimloom.exe --worker`，0.1.6 起） |
| `packages/crosshair` | CS2 / VALORANT 准星代码解析和 PNG 渲染 |
| `packages/theme` | 主题解析和背景预览图（App 与官网共用） |
| `packages/site` | aimloom.dev 官网和它的 Cloudflare Worker（反馈报告、探索页、登录与上传） |
| `docs/` | 设计文档（`superpowers/specs/`）、技术研究、界面交互规范 |

`CLAUDE.md` 是贡献者指南（英文）：请求链路、测试守着的不变量，以及所有命令。`DESIGN.md` 是界面视觉规范。

## 开发

App 的目标平台是 Windows；Mac 或 Linux 可以跑浏览器演示和测试。

```sh
npm ci
npm test                                  # Vitest：App、@kvk/theme、crosshair
npm run typecheck
npm run dev:installer -w @kvk/app         # 浏览器演示 http://127.0.0.1:5173/installer.html，不会改动任何文件
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui
npm run test:site                         # 官网：页面构建 + Worker（D1、R2、登录、上传）
```

打包脚本的测试需要 PowerShell 7，在 Windows 上运行（CI 每次 push 都会跑）：

```powershell
pwsh -NoProfile -File scripts/installer/tests/package-build.test.ps1
```

每个 checkout 都要先启用一次隐私提交钩子（每次提交前扫描暂存的改动，查找已知的身份信息和密钥，见 `.githooks/pre-commit`）：

```sh
git config core.hooksPath .githooks
```

## 许可证

[GNU AGPL-3.0](LICENSE)。第三方代码及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。KovaaK's 是其所有者的商标，Aimloom 与其没有关联。
