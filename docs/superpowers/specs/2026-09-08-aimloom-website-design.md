# Aimloom 官网：信息架构与功能范围

## Product alignment — 2026-09-15

App descriptions follow the [shared five-section workspace](2026-09-13-aimloom-training-profiles-design.md)
and [repository roadmap](../../../ROADMAP.md): Profile stores a reusable name/path
combination; Scheme/Audio/Crosshair/Enemy independently edit current configuration.
Describe Profile Save as saving that combination, never as automatic game application.
The Profile page is implemented on feature/profile; current component pages, full Profile
application and Windows/release acceptance remain pending. Match download claims to the
actual released artifact, not branch tests or browser demo behavior. The website retains
its own Home/Download/Guide/Changelog navigation and bilingual/Figma requirements; it does
not copy the app's five-section navigation. The Profile-only Figma exception is not a
website design waiver. Original website requirements below remain otherwise unchanged.

日期：2026-09-08

**Positioning amendment — 2026-09-13:** the website should lead with **personal training
Profiles**: manually switch a saved combination of background, sounds, crosshair and enemy
appearance for static clicking, tracking or another training purpose. CS2/VALORANT code
compatibility is part of that story. Preview, fast replacement and backup are supporting
capabilities; they are no longer the sole product pitch. External background/audio API
providers are a later goal. Keep the four bilingual pages and Figma workflow, but revise
their content/feature order around the [Profile product contract](2026-09-13-aimloom-training-profiles-design.md).
Clearly label upcoming capabilities until corresponding features ship; do not present a
Profile mockup or future generated asset as an available product feature.

**Design workflow amendment — 2026-09-13:** the user requires the website and software UI to be designed in **Figma** before their corresponding screens are implemented. This written specification supplies the website content and visual starting point; it is not a completed Figma design. Record editable file/node links, desktop/mobile and Chinese/English frame coverage, reviewed screenshots and component/token mappings. The current schedule and execution steps are in [ROADMAP.md](../../../ROADMAP.md) and the [delivery plan](../plans/2026-09-13-docker-crosshair-figma.md).

状态：用户已确认品牌名称、信息架构和功能范围，并要求视觉参考 F1 迈凯轮，稍微时尚潮流，有 Gulf 海湾赛车风。下文的具体配色、排版和构图是据此提出的设计建议，尚未完成视觉稿确认。

## 产品定位

品牌：Aimloom · 瞄织。

官网主要用于介绍 KovaaK 配置管理工具，并帮助用户下载、安装和开始使用。核心路径为：了解用途 → 看见效果 → 下载 → 顺利用起来。

建议首页文案：

> 轻松打理你的 KovaaK 配置。
>
> 安装喜欢的主题、音效与准星，修改前自动备份，需要时轻松恢复。

当前功能依据仓库 README.md、scripts/installer/README.md 及现有安装器实现。网站描述应随实际发行版本维护，不能把计划功能宣传为已交付能力。

## 页面与导航

| 页面 | 路径 | 内容与目标 |
| --- | --- | --- |
| 首页 | / | 产品介绍、真实效果、核心功能、使用流程、常见问题；引导下载 |
| 下载 | /download | 推荐安装包、版本、运行要求、包含内容和安装步骤 |
| 使用帮助 | /guide | 首次安装、配置选择、备份恢复与问题排查 |
| 更新记录 | /changelog | 各版本改进、修复与已知问题 |

顶部导航：功能介绍（首页锚点）、使用帮助、更新记录、下载。品牌标识链接至首页。移动端保留全部导航入口和清晰的下载入口。

## 首版中英双语

用户明确要求第一版同时提供简体中文和英文，通过右上角切换显示。一次只显示当前语言，避免将两种正文并排堆叠。

- 入口：导航最右侧使用“中文 / EN”，清晰标示当前语言，支持键盘操作；手机布局同样保留容易找到的切换入口。
- 内容范围：首页、下载、帮助、更新记录，以及导航、按钮、发布状态、图片说明和无障碍标签均提供对应语言内容。此要求针对官网，不表示桌面安装器也已支持双语。
- 建议语言路径：使用 /zh/ 与 /en/ 前缀；上表路径表示页面的逻辑路径，例如下载页对应 /zh/download 和 /en/download。
- 选择规则：显式 URL 的语言优先。无语言前缀的首次入口先采用已保存的用户选择，否则中文浏览器采用中文、其他语言采用英文。切换后记住用户选择。
- 切换行为：保留当前对应页面及有效的锚点、查询参数，避免切换语言后无故返回首页。
- 一致性：版本号、下载文件与发行状态共用同一数据来源，说明文案分别本地化。两种语言的功能承诺和已知问题保持一致；文件名、命令、路径等操作内容保留实际值。
- 排版：分别处理中文与英文的字长和自然换行，保持相同信息层级和下载入口位置。页面语言、标题与描述随语言同步设置。

## 首页内容顺序

1. 首屏：一句话定位、简短介绍、真实软件画面。主入口为下载，次入口为使用指南；下载入口旁展示适用平台与真实发布状态。
2. 效果展示：精选主题、准星的真实游戏画面；音效提供用户主动点击的试听。标注示例是否包含在推荐下载包中。
3. 核心能力：按需选择主题、音效与准星；修改前核对文件清单；自动备份与撤销恢复。
4. 使用流程：下载并解压 → 选择游戏位置与内容 → 核对并安装 → 进入游戏选择素材。明确安装文件后仍需在游戏中选择素材。
5. 常见问题：支持系统、是否修改灵敏度、是否需要自备配置包、如何恢复。简短回答链接到完整指南。
6. 结尾下载区：再次提供下载和安装指南入口。

## 下载与发行状态

突出一个推荐完整安装包。版本号、发布日期、文件大小、运行要求、包含内容及下载后的第一步应集中呈现。源码和旧版本作为次要入口，明确源码 ZIP 不等于完整安装包。

下载模块支持三种真实状态：

- 准备中：明确尚无可下载的对应发行包，提供使用指南和更新记录入口，不生成虚假下载链接。
- 测试版：明确测试版标签、适用范围和已知问题，并链接已存在的完整测试包。
- 正式版：展示已完成发布的推荐版本及其真实下载链接。

截至本文编写时，仓库记录表明 Windows GUI、完整发行包和真实游戏验收仍待目标环境完成。这是仓库内记录，不构成对外部发布渠道的实时核查。上线前必须以实际发行资产和验收结果确认网站状态。

当前目标平台为 Windows；现有入口要求 PowerShell 7+。下载页的最终运行要求必须与所推荐的具体发行包一致。

## 帮助与更新内容

帮助覆盖游戏位置选择、素材与可选设置的区别、安装后选择素材、备份位置、撤销和恢复，以及常见运行问题。特别说明完整设置可能覆盖灵敏度、DPI、FOV 等设置；默认素材安装与整体设置替换应清楚区分。

更新记录按实际发布版本组织，展示日期、改进、修复与已知问题，并链接对应下载入口。未来规划不混入已发布功能列表。

## 实现边界

建议在同一仓库以 packages/site 独立维护静态官网，与现有应用分开构建。基础设施以 Cloudflare 为主，具体技术栈与部署配置在实现规划中确定。

版本与下载信息由单一数据来源维护，首页、下载页及更新记录引用同一版本标识，避免重复手工维护导致不一致。下载文件使用实际发行渠道链接。

第一版范围为上述四个页面与其内容，不增加账号、社区、在线配置编辑或素材市场。

## 已确认的后续阶段：精选配置与热门 Top 10

用户确认在收集到足够的设置文件后，按“审核上传 → 精选 Top 10 → 积累下载数据 → 自动热门榜”的顺序扩展。网站与 App 共用配置清单。此阶段独立于当前官网首发，不表示下载中心、联网 App 或排行榜已经实现。

### 阶段一：审核上传与精选配置

- 由维护者收集、核对并发布配置；先提供最多 10 个精选条目，数量不足时按实际数量展示。
- 标题使用“精选配置 / Featured configs”，排序由维护者决定，不将人工排序表述为下载热度。
- 配置文件和预览素材存入 R2；一份共享清单保存稳定配置 ID、版本、分类、作者、来源与发布许可记录、中英文介绍、适用游戏版本、修改范围、预览、文件大小、下载地址和 SHA-256。
- 分类覆盖主题、音效、准星与完整配置包。涉及灵敏度、DPI、FOV 等个人设置时明确提示。
- 网站与 App 读取同一份清单。维护者先校验文件再发布清单，版本更新使用独立文件地址；支持撤下条目。
- App 将下载文件接入现有核对、备份、确认与应用流程；缓存最近一次清单，断网时标示缓存状态，已下载配置保持可用。
- 先用仓库维护清单，发布到静态托管或 R2；预留稳定配置 ID 和统一下载入口，为后续统计保留衔接点。

### 阶段二：统一统计与自动热门榜

- Cloudflare Workers 提供网站与 App 共用的榜单及下载接口；D1 存放配置元数据与统计，R2 继续负责文件分发。无需为此单独租用 VPS。
- 上线统计时明确展示口径。按钮点击、下载请求、下载完成分别处理；仅记录请求时不能声称已经成功下载。
- 网站与 App 使用一致的去重和限频规则，避免重复点击、重试、自动更新及明显异常请求反复推高排名。客户端不能直接提交任意累计计数。
- 优先采用近 30 天热门榜；数据不足时继续展示精选内容。主题、音效、准星与完整配置包可按分类排行。
- 定期汇总并缓存榜单，不要求每次打开页面都实时重算。界面说明统计周期和更新时间。
- 上线前进一步验证统计口径、异常请求处理、榜单缓存以及撤下配置后的展示与下载行为。

Cloudflare Workers 和 D1 均提供免费使用额度，实际费用按请求、计算、数据库读写和存储量评估；不把免费额度当作无限服务承诺。实施前核对 [Workers 官方价格](https://developers.cloudflare.com/workers/platform/pricing/) 与 [D1 官方价格](https://developers.cloudflare.com/d1/platform/pricing/)。

## 注意事项：托管、云存储与上线维护

用户确认采用 Cloudflare 为主的基础设施方向。以下是实施与上线时的安排，不表示已开通服务、购买域名、上传文件或完成部署。

### 服务分工

| 部分 | 首选方案 | 用途与边界 |
| --- | --- | --- |
| 官网托管 | Cloudflare Pages | 托管四个页面及中英文内容，连接 GitHub 自动构建；开发分支先生成预览，正式站使用明确指定的生产分支 |
| 安装包与大型素材 | Cloudflare R2 Standard | 提供完整 ZIP／EXE 和大型素材的下载，使用自有下载子域名 |
| 域名与 DNS | Cloudflare Registrar／DNS | 集中管理注册、续费、解析与 HTTPS；域名可用性和续费价格在购买前确认 |
| 源码与版本记录 | GitHub aimloom 仓库 | 保存代码、帮助、构建配置与版本信息 |
| 版本归档与备用下载 | GitHub Releases | 归档发布说明和对应安装包；面向普通访客的备用链接必须可公开访问 |

可以先接通 Pages 与 GitHub Releases，再启用 R2 作为主下载渠道。官网的版本数据应允许更换主下载地址，避免迁移存储时修改多个页面。官网首发和人工精选阶段的静态内容直接在仓库维护；自动统计热门榜阶段再引入 Workers 与 D1。

### 费用与限制

以下数据于 2026-09-08 查阅官方文档，上线或调整套餐前重新核对：

- **Pages 免费档**：每月 500 次构建，单个静态文件上限 25 MiB。大型安装包放 R2 或 Releases，不作为页面构建产物上传。[官方限制](https://developers.cloudflare.com/pages/platform/limits/)
- **R2 Standard 免费额度**：每月 10 GB-month 存储、100 万次 A 类操作、1,000 万次 B 类操作；互联网出站流量免费。超额标准存储为 $0.015／GB-month，A 类操作 $4.50／百万次，B 类操作 $0.36／百万次。按实际用量与官方计费舍入规则结算，其他付费服务可能单独收费。[官方价格](https://developers.cloudflare.com/r2/pricing/)
- **R2 正式下载地址**：绑定自己的下载子域名；`r2.dev` 为开发用途且有限速，不作为正式下载入口。[公开访问文档](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- **GitHub Releases**：每个附件需小于 2 GiB；官方文档未设置单次 Release 总大小与带宽用量上限。[官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- **域名**：注册与续费单独计费；Cloudflare Registrar 按注册局及 ICANN 成本收费，具体金额取决于域名与后缀。[官方说明](https://www.cloudflare.com/products/registrar/)

存储量和下载流量分开估算：一份 500 MB 文件保存约占 0.5 GB，下载 1,000 次约产生 500 GB 分发流量。定期查看存储、请求量与账单，不能将“免出站流量费”理解成所有服务均免费。免费额度内可以控制早期基础设施成本，域名和后续代码签名等费用另计。

### 发布与下载可靠性

- 每个发行版本保存独立文件名与地址，展示版本、发布日期、文件大小、运行要求和 SHA-256 校验值。已发布版本不在原地址静默替换内容。
- 发布顺序为：完成 Windows 实机验收 → 上传安装包 → 验证下载和校验值 → 更新共享版本数据 → 发布官网。准备中、测试版和正式版状态与实际文件一致。
- 主下载和备用下载使用同一版本的相同文件，并核对校验值。不要把源码 ZIP 作为完整安装包提供。
- 保留上一可用官网版本及安装包，记录回退方法。最新版本信息与固定版本文件分别设置合适缓存，避免页面仍指向旧版本。
- 公开存储只放计划公开的发行文件与素材；上传凭据保存在部署服务的密钥配置中，不写入前端或仓库。

### 网页体验与内容维护

- 海湾蓝场景使用压缩后的适当尺寸图片，预留媒体尺寸；大素材和音效按需加载，音效由用户主动播放。首屏不加载整个配置素材包。
- 下载后的指南覆盖解压、启动、游戏路径选择、素材应用和恢复操作；下载页运行要求与具体发行包一致。
- 中英文共用版本和下载数据，帮助说明、已知问题和发布状态同步更新；验证语言切换、刷新、页面直达及手机上的长文案。
- 保留明确的问题反馈入口。上线时检查页面、下载链接、HTTPS、手机与键盘操作；后续检查关注可访问性及链接失效。
- 从实际用户所在地区测试官网与完整安装包下载，记录结果后决定是否增加镜像。主要用户地区尚未确认，不能仅凭美国开发环境判断体验。
- 正式 Windows 发行考虑代码签名，并验证浏览器下载与 SmartScreen 的实际表现；签名不保证新文件立即免除信誉提示。[微软说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

## 验收标准

- 新用户能从首页理解用途、目标平台和主要能力，并找到下载或真实的未发布状态。
- 推荐下载入口指向对应版本的真实完整安装包；源码入口标识清晰。
- 使用指南覆盖从解压到进入游戏选择素材的完整路径，并解释恢复方式。
- 首页、下载页与更新记录的版本状态保持一致。
- 展示素材与截图来源真实，示例是否随包提供有清晰说明。
- 桌面和手机均可阅读、导航与查看下载要求；手机访问不暗示支持手机安装。
- 导航与下载入口可通过键盘操作；音效不自动播放。
- 两种语言覆盖全部首版页面；切换后仍在对应页面，刷新保持所选语言，英文长文案和手机导航不溢出。

## 视觉简报：迈凯轮 × Gulf 赛车文化

用户要求：参考 F1 迈凯轮的一些设计，稍微时尚潮流，有海湾赛车风；在此基础上继续融合 KovaaK 元素，让瞄准训练与配置用途一眼可识别。

参考锚点为 [McLaren 2021 摩纳哥 Gulf 特别涂装](https://www.mclaren.com/racing/formula-1/2021/monaco-grand-prix/mclaren-racing-and-gulf-oil-international-unveil-limited-edition-monaco-grand-prix-livery/)。官方介绍明确采用 Gulf 蓝与橙色条带，并延伸到车队服装和生活方式系列。Aimloom 提炼其色块关系、利落排版和运动服饰感，用于介绍和下载官网。

建议视觉方向：现代赛车的精确排版，结合复古赛车海报与运动服饰的明快色彩。官网拥有自己的营销视觉；现有 DESIGN.md 中桌面安装器的深色、单橙色和低装饰规则继续适用于安装器。

以下颜色是 Aimloom 的初步配色建议，并非 McLaren 或 Gulf 的官方品牌色值：

| 角色 | 建议颜色 | 用法 |
| --- | --- | --- |
| 海湾蓝 | #8BC4D6 | 首屏大色面、效果展示背景 |
| 木瓜橙 | #FF8000 | 下载按钮、重点条带与少量强调 |
| 墨黑 | #182126 | 标题、导航及深色展示区域 |
| 暖白 | #F4F1E8 | 使用流程、FAQ 和帮助页阅读背景 |
| 灰蓝 | #56666D | 浅背景上的辅助文字；实现时检查对比度 |

排版建议：品牌与少量英文展示标题使用紧凑、粗重的运动风无衬线字形；中文标题保持清晰方正，正文使用易读的中文无衬线字体。版本与文件信息可使用等宽数字。具体字体在视觉稿阶段选择并确认可用性。

首屏建议：海湾蓝大底，墨黑的大标题与中文用途说明，橙色下载按钮；另一侧突出真实 KovaaK 主题与准星画面。用一条有明确边界的橙色带组织视觉重心，主体内容保持水平可读。品牌字标和内容共同建立 Aimloom 身份。

页面节奏建议：明快的首屏 → 深色游戏效果展示 → 暖白的功能与使用说明 → 清晰的结尾下载区。帮助与更新页沿用配色、字体和导航，采用稳定、舒适的阅读布局。

标志性元素建议：将赛车涂装条带与瞄准目标的细线图形结合，用于主视觉与区块交接。媒体仍以真实软件和游戏画面为核心。动画集中于短促的内容出现和按钮反馈，尊重减少动态效果设置；音效由用户主动播放。

### KovaaK 元素的融合

- 主体画面：训练房间的透视墙面与地面、不同深度的球形目标、中心准星。以海湾蓝场景和橙色目标呼应网站配色，使赛车色彩与训练内容产生直接联系。
- 品牌细节：Aimloom 使用原创的目标圆环与中心点图形；准星细线作为媒体对焦与局部布局元素。赛车条带在画面边缘衔接目标图形，保持内容可读。
- 素材展示：主题展示同一场景的不同配色，音效用主动播放控件与波形表达，准星展示几种清晰轮廓。各类示例必须与实际可提供的素材核对。
- 视觉权重：KovaaK 训练场景承担产品识别，赛车文化承担配色、字形与条带风格，主行动仍为下载。

已生成一张首页概念图用于讨论上述融合方向，其中训练场景为 AI 生成的示意画面，不是真实游戏截图，也不作为软件已实现功能、现有素材或已发布状态的证据。图中的具体文案和示例名称属于草案，实施时按产品事实校订。

### 第二版构图：增加留白与空间感

用户对第一版的反馈：方向可以，进一步偏设计风，空间拉开，减少局促感。

第二版概念稿据此调整：暖白承载页面留白，海湾蓝集中在训练场景；导航与首屏内容拉开距离；首屏保留一组标题、简短说明与下载入口，素材功能区移到下一屏。移除主视觉的粗黑框与重复大字标，让训练场景延展至页面右侧，通过更开阔的天空、地面与目标纵深形成空间感。赛车条带缩减为场景墙面上的一条橙色线，品牌延续橙蓝关系和运动风字标。

此版仍为讨论中的 AI 视觉概念，尚未获用户最终确认；此前的满蓝首屏、重复大字标和首屏内三类素材卡片不再作为首选构图。正式效果展示仍应使用经核对的真实产品或游戏画面。

### 第三版排版：更灵动的字形

用户认可第二版的大致方向，并要求字体更灵动。第三版概念稿保留第二版的空间和场景构图，将标题改为较轻的前倾字形，以两行字重差异和轻微错位形成节奏；“风格”采用深橙色强调。品牌字标探索小写、圆润且略前倾的 aimloom，正文与导航保持正体易读。

这些字形目前来自 AI 概念图，不代表已选定或可直接使用的字体文件。正式实现需选择适合中文、可用于网站的字体并验证实际排版；具体字标与标题处理仍待用户确认。

### 第四版：强化蓝色与双语入口

用户要求蓝色更加明显，并从第一版支持中英切换。新概念稿扩大海湾蓝在首屏中的面积，训练场景与右侧上沿形成连续蓝色区域，左侧继续用暖白留出阅读空间；保留第三版灵动字形和橙色强调。

已分别生成中文与英文首页概念稿，在右上角展示“中文 / EN”及当前语言的橙色下划线。英文标题使用“Your aim. Your style.”表达对应品牌语气。两张图片用于验证视觉方向和文案长度，不代表语言切换功能已经实现。

### 第五版：通透海湾蓝底色与黑橙叠层

用户最新要求：参考一些 VPN／机场网站及小型项目网站，背景采用海湾蓝的透色，在上面叠加黑橙，突出 KovaaK 元素。此方向优先于此前的暖白左栏／蓝色右栏分区。

本轮实际查看公开页面并截图对照的参考如下。这里只记录视觉与信息结构观察，不评估其网络服务或性能宣传。

| 参考 | 实际观察 | Aimloom 的提炼方向 |
| --- | --- | --- |
| [oixCloud](https://oixcloud.com/)（从 dlercloud.com 跳转） | 深色首屏、大字、低对比细线圆环和网格、清晰主行动 | 提炼细线瞄准图形与文字层级，用于蓝底上的黑橙前景 |
| [Doggygo](https://www.dg6.me/en/) | 全屏彩色背景、图形叠层、右上角语言入口 | 提炼连续底色与主体图形的叠加关系，使用 Aimloom 的海湾蓝与训练靶球 |
| [LocalSend](https://localsend.org/) | 直接的用途标题、清晰下载入口、宽松首屏留白、右上角语言选择 | 延续介绍与下载优先的结构，保持双语入口容易找到 |
| [Cap](https://cap.so/) | 浅色大底、较轻标题、简短说明、下载与演示的主次关系 | 提炼通透背景和少量操作的节奏，保持首屏信息量克制 |

另尝试了 Nexitally，但公开页停在自动访问验证；Hiddify 首页被 Cookie 弹层遮挡，因此二者未作为本轮主要视觉依据。

第五版概念稿采用统一的淡海湾蓝背景与柔和明暗层次，以视觉通透感贯穿导航和首屏。黑色承载标题、准星轮廓和少量半透明材质条；橙色承载下载按钮、靶球与图标。保留灵动字形与右上角“中文 / EN”。

KovaaK 场景融入整页背景：训练墙面与地面透视降低对比度，前景橙色目标搭配黑色准星和一条细跟踪路径；主体与文字共同构图。底部仅保留一条简短的主题／音效／准星提示，避免首屏重新堆积卡片。

本轮只生成中文视觉概念，英文沿用已确认的双语需求，在布局定稿后同步适配。图像仍属于概念示意，半透明材质、背景浓度及具体字体尚待实际页面验证；并未实现网站或发布下载包。

下一轮确认首页视觉稿，选取真实产品画面并细化各区块布局。视觉确认后再补充实现计划。
