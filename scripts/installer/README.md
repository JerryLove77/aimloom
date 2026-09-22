# KovaaK 配置安装器 v0.1.0 候选包

面向使用者的项目介绍、当前功能和使用步骤见 [项目 README](../../README.md)。本页保留安装器构建、发行清单和测试说明。

此目录包含独立的 Windows PowerShell 安装／恢复入口及开发者打包工具。发行状态为 **candidate**；此前脚本候选包在 Windows PowerShell 5.1 上的 23 项引擎测试、CLI、最终 ZIP 整包安装／恢复及 18 项原生 CMD 测试均已通过；完整游戏验收仍待完成。实测记录见 [候选包验证](../../docs/superpowers/notes/2026-09-06-v010-verification.md)。设计和发布条件见 [v0.1.x 设计](../../docs/v0.1.x-design.md)。

用户解压整个 ZIP 后运行根目录的 `安装配置.cmd` 或 `恢复配置.cmd`。当前源码入口需要已安装的 PowerShell 7+（pwsh.exe），不需要 Python、Node.js 或 Rust。先阅读包内 `使用说明.txt`，按界面核对路径和选择内容；完整设置、UI、Palette 分别选择，默认仅安装素材。游戏必须退出。若系统执行策略阻止脚本，请按错误说明处理；入口不会自动提权或修改策略。

## 开发者构建

在仓库根目录使用 Python 3.9 或更新版本：

```sh
python3 -m unittest discover -s scripts/installer/tests -p 'test_*.py'
python3 scripts/installer/build-release.py
```

默认输出为 `dist/KovaaK-Config-v0.1.0.zip`。也可指定 `--output`；临时测试或独立素材目录可使用 `--pack-dir`、`--runtime-dir` 和 `--inventory`。构建只写发行文件，不安装配置、不修改游戏、不上传或发布。完整 Windows 验收记录由主项目验证文档维护。

`release-inventory.json` 固定记录真实本地配置包内 **695 个文件** 的相对路径、字节数和 SHA-256：139 个主题（包括名为 `.json` 的原始文件）、480 个音效、73 个准星和 3 个独立配置文件。只扫描素材目录的第一层；不改名、不重写 JSON、不转换编码。ZIP、`.png~`、`.ogg.sfk`、原包 readme 和未知文件不分发。

**Git 源码不包含完整发行素材。** 音效和准星二进制被 `.gitignore` 排除。必须取得与清单一致的实际 `KVK Settings 2025` 素材目录；缺少、改动或新增可安装文件都会停止构建。不能通过删除清单项让不完整源码“构建成功”。有意更新素材时，应先检查素材来源和内容，再审阅相应清单差异；工具不自动重建基准清单。

## ZIP 内容和校验

```text
安装配置.cmd
恢复配置.cmd
使用说明.txt
scripts/kvk-config.ps1
scripts/kvk-engine.ps1
scripts/<其他运行时辅助脚本>.ps1
KVK Settings 2025/<原始素材与三个配置文件>
release-manifest.json
```

运行时辅助脚本放在本目录第一层；打包器包含第一层 `.ps1`，排除 `*.test.ps1`、`*.tests.ps1`，并且不分发 `tests/`、Python 构建工具或开发文档。主入口、引擎、两个 CMD 和使用说明缺失时停止。

构建先核对全部源素材，再写临时 ZIP。`release-manifest.json` 使用 UTF-8 和 `/` 相对路径，记录每个分发载荷文件的 SHA-256 和字节数，包括入口、说明和所有运行时脚本。清单自身不列入其散列范围，避免循环散列；整个 ZIP 的 SHA-256 由构建输出提供。工具读回 ZIP 的全部文件，检查成员列表、长度和散列，与内存中生成的清单核对成功后才替换旧候选包。此前失败保留原输出。

所有 ZIP 文件使用固定时间戳、权限和排序；在相同 Python/zlib 环境、相同输入下，重复构建得到相同字节。拒绝源目录内输出、覆盖输入清单、链接／junction／硬链接、路径穿越、Windows 不可用名称和大小写冲突。此清单用于完整性验证，不是数字签名或来源认证。

Python 测试使用真实临时文件和 ZIP，覆盖缺失／改动素材、未知文件排除、Unicode 和原始字节、辅助脚本分发、重复构建、输入保护、不安全路径及被篡改的 ZIP。文件系统大小写冲突场景在不区分大小写的卷上跳过；清单中的大小写冲突在所有平台验证。安装事务、恢复流程和 Windows 交互由独立的 PowerShell 测试及真机验收负责。

## Windows 自动化测试

将本目录及候选 ZIP 复制到专用临时目录，解压 ZIP 后在 Windows PowerShell 7+ 执行（`$releaseRoot` 指向解压根目录）：

```powershell
pwsh.exe -NoProfile -File .\tests\engine.test.ps1
pwsh.exe -NoProfile -File .\tests\cli.test.ps1
pwsh.exe -NoProfile -File .\tests\distribution.test.ps1 -ReleaseRoot $releaseRoot
pwsh.exe -NoProfile -File .\tests\windows-entrypoints.test.ps1 -ReleaseRoot $releaseRoot
```

引擎和整包套件创建随机临时游戏／LocalAppData 目录并在结束后清理。CMD 套件在包含中文与空格的临时路径使用最终发行入口，验证两种目录布局、安装／恢复参数、STA、退出码及真实 CLI 取消；使用替代引擎阻止访问真实游戏。它不模拟资源管理器鼠标双击，也不操作文件夹对话框或检查游戏内显示／播放。这些观察仍须记入单独的游戏验收。

## Windows GUI 与开发边界

GUI 仅面向 Windows。Mac 上使用浏览器预览与 PowerShell 7 的临时文件测试，不发布 Mac App。当前 GUI 运行时通过固定 PowerShell worker 调用同一份引擎；生产入口不提供测试用 LocalAppData 参数。

`gui-distribution.test.ps1` 用受控测试包装器将**内部 worker 循环**连接到随机临时游戏／LocalAppData，能在 Mac 上检查真实素材和 JSONL 协议。它不等于 Windows GUI、系统 LocalAppData 解析或完整 EXE 的验收。

`build-gui-release.py` 接受 Windows EXE、已解压 WebView2、运行时锁定清单和原素材清单，流式生成带逐文件校验的 GUI ZIP。WebView2 清单需要 `schemaVersion: 1`、`version`、`source`、`archiveSha256` 和每个文件的 `path/size/sha256`。缺少输入或任一 hash 不匹配就停止；本机测试中的假 EXE 仅用于验证打包逻辑，不用于发行。

此前 Windows PowerShell 5.1 的测试记录是旧候选包的历史证据。当前 PowerShell 7 入口与 Windows GUI 仍需在目标电脑重新验收。
