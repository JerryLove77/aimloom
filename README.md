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

到 [aimloom.dev](https://aimloom.dev/zh/download/) 下载安装程序或便携版 ZIP，页面上有每个文件的 SHA-256。
同样的文件也挂在 [GitHub Releases](https://github.com/JerryLove77/aimloom/releases/latest)。当前版本是 **v0.1.4**。

## 功能

- **准星（Crosshair）**：粘贴 CS2 或 VALORANT 的准星代码，微调长度、粗细、间隙、描边、颜色、中心点和透明度，生成 PNG 准星放进游戏文件夹；也可以添加自己的 PNG。用哪个准星在游戏设置里选。
- **背景、音效（Theme、Sounds）**：列出游戏里已有的主题和音效，预览后应用；从电脑选择或直接拖入文件，就能添加新的。
- **敌人（Enemy）**：和游戏自带的「皮肤浏览器」一样，给人形、方块、球三种形状各选一个游戏自带的皮肤。
- **Profile**：把一套背景和音效存成一个命名的组合，之后一步应用，也可以应用后直接通过 Steam 启动游戏。
- **一键拖入（Quick import）**：一次把整包文件放进游戏。

每次写入前都会先备份，随时可以撤销。Aimloom 不会改你的灵敏度、DPI 和 FOV，而且只在游戏关闭时修改：KovaaK 退出时会重写它的设置文件，游戏开着时改的会被覆盖掉。

## 官网 aimloom.dev

- **[探索](https://aimloom.dev/zh/explore/)**：浏览、试听、下载别人分享的背景、音效和准星。下载的就是原文件，拖进 Aimloom 对应的页面就能用。
  - **上传**：用 Steam 登录（只拿 SteamID，不碰密码），起一个署名，选文件就能传；每次上传还有一道 Cloudflare Turnstile 真人验证。
  - 上传的文件会被严格检查：只收主题 `.json`、音效 `.wav` / `.ogg`、准星 `.png`，每个字节都要对得上格式，准星图片会重新编码。新作者的上传先经审核再公开；作者可以随时下架自己的文件。
- **[准星代码工具](https://aimloom.dev/zh/crosshair/)**：不用安装 App，在浏览器里粘贴 CS2 / VALORANT 准星代码，预览、微调、下载 PNG，全程不上传任何东西。

## 运行要求

- Windows 10 或 11，64 位。
- **PowerShell 7**：没有的话，安装程序会提出用 winget 帮你装。
- WebView2，Windows 10/11 一般都自带。

Aimloom 没有代码签名，第一次运行时 Windows SmartScreen 可能会提示：点「更多信息」→「仍要运行」。下载页给出了每个文件的 SHA-256，可以用来核对下载的文件。

## 状态

- **进行中：** v0.1.5——官网的探索页已经上线，包括 Steam 登录、上传、审核（维护者已在线上登录并上传过）。App 这边的「在 aimloom.dev 找更多…」链接在 [v0.1.5-beta.1](https://github.com/JerryLove77/aimloom/releases/tag/v0.1.5-beta.1) 里，目前只是 GitHub 上的测试版，App 的更新检查还不会提示它。
- **已发布：** v0.1.4（2026-09-22）——粘贴 CS2 / VALORANT 准星代码后微调、Profile「应用并启动游戏」、Profile 里换背景和音效时可搜索和从电脑添加、背景页搜索、设置里的「参与 Beta 测试」。v0.1.3 带来了应用内问题报告、可选的 Steam 账户、启动时检查更新、应用 Profile 和敌人皮肤。后续计划见 [ROADMAP.md](ROADMAP.md)。
- v0.1.1 和 v0.1.2 已下架：它们的 `Aimloom.exe` 里嵌着打包电脑的 Windows 用户名（在依赖库的源码路径里）。从 v0.1.3 起，打包时会替换这些路径，打包脚本也会拒绝仍带本机路径的 EXE。
- 每个功能在真实电脑和真实游戏里看到了什么、还没看到什么，维护者另有验证记录，不公开。测试通过不等于「在游戏里能用」。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `packages/app` | App：React 前端，Tauri（Rust）外壳 |
| `scripts/installer` | PowerShell 引擎，所有写入游戏的操作都经过它 |
| `packages/crosshair` | CS2 / VALORANT 准星代码解析和 PNG 渲染 |
| `packages/core` | TypeScript 设置库（暂停开发） |
| `packages/site` | aimloom.dev 官网和它的 Cloudflare Worker（反馈报告、探索页、登录与上传） |
| `docs/` | 设计文档（`superpowers/specs/`）、技术研究、界面交互规范 |

`CLAUDE.md` 是贡献者指南（英文）：请求链路、测试守着的不变量，以及所有命令。`DESIGN.md` 是界面视觉规范。

## 开发

App 的目标平台是 Windows；Mac 或 Linux 可以跑浏览器演示和测试。

```sh
npm ci
npm test                                  # Vitest：App、@kvk/core、crosshair
npm run typecheck
npm run dev:installer -w @kvk/app         # 浏览器演示 http://127.0.0.1:5173/installer.html，不会改动任何文件
cargo test --manifest-path packages/app/src-tauri/Cargo.toml --features installer-ui
npm run test:site                         # 官网：页面构建 + Worker（D1、R2、登录、上传）
```

PowerShell 测试需要 PowerShell 7，在 Windows 上运行（CI 每次 push 都会跑全部十六个套件）：

```powershell
pwsh -NoProfile -File scripts/installer/tests/engine.test.ps1
```

发布包不能直接从 Git 仓库构建：发布包里的音效和准星素材不在仓库里，`scripts/installer/release-inventory.json` 会让缺少其中任何一个的构建停下来。

每个 checkout 都要先启用一次隐私提交钩子（每次提交前扫描暂存的改动，查找已知的身份信息和密钥，见 `.githooks/pre-commit`）：

```sh
git config core.hooksPath .githooks
```

## 许可证

[GNU AGPL-3.0](LICENSE)。第三方代码及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。KovaaK's 是其所有者的商标，Aimloom 与其没有关联。
