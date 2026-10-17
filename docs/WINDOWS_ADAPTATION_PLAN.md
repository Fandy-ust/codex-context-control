# Windows 适配方案与开发步骤

日期：2026-10-17。代码基线：`a6f44d7`，`package.json` 版本 `0.17.2`。工作分支：`codex/windows-adaptation`。

**本文保留最初开发方案。当前 Windows x64 实现、构建与自动测试已落地，下面的原始阶段清单不作为最终测试状态。** 实测进展见 [Windows 兼容性记录](WINDOWS_COMPATIBILITY.md)，安装构建见 [Windows 指南](INSTALL_WINDOWS.md)，待人工检查的 UI 项见 [验收清单](WINDOWS_UI_CHECKLIST.md)，共用代码及版本管理约定见 [多平台开发与版本管理](MULTIPLATFORM_DEVELOPMENT.md)。

## 1. 目标与交付边界

把现有 Context Manager 适配到 Windows，保留目前的视觉设计、页面结构、交互和有效功能。入口从 macOS 顶部菜单栏迁到 Windows 右下角系统托盘，点击后打开外观相近的紧凑面板，再进入主窗口。

- UI 以当前 `macos/` 源码和实际渲染为基准：深色背景、圆角卡片、低对比边框、蓝白双滑块、圆环用量、MAX 渐变和统计图交互均保留。
- 复用 Node 业务核心，平台差异集中封装；macOS 原生版本继续保留。
- 按功能逐项验收，不能用静态演示、只读统计或统一修改全局配置代替逐聊天控制。
- 首个目标为 Windows 11 x64 原生桌面版本。Windows ARM64 单独构建和验证；Windows 10、WSL 与远程宿主不计入首个版本的已支持范围。
- 不修改 Codex 已签名的安装文件，不代写 hook 信任记录，不变更用户登录凭据，不为测试自动发起付费模型调用。

0.17.2 新增的升级配置继承、未来 schema 标记保留、运行中资源清理保护和 OTA 清理重试全部纳入基线；Windows 实现必须保留对应语义，只替换平台机制。

UI 的“保留”指应用内容区与交互的一致性。字体栅格化、系统窗口阴影、读屏接口和托盘位置按 Windows 实现，不承诺跨系统逐像素完全相同。

## 2. 当前代码结论

| 层次 | 现有实现 | Windows 处理 |
| --- | --- | --- |
| 主面板及控件 | `macos/ContextControl.swift`、`BudgetMath.swift`、`MaxContextFlow.swift` | 重建视觉组件；预算计算调用共享 JS 实现并做跨实现对照 |
| 菜单栏面板 | `ContextMenu.swift`、`ContextMenuPanel.swift`、`Menu*.swift` | 用系统托盘加自定义弹窗承载，保留行内预算调节 |
| 统计及图表 | `ContextDetails.swift`、`ContextCharts.swift`、`Timeline*.swift` | 统计服务复用；迁移前端聚合、悬停、固定与原始明细交互 |
| 预算及桥接 | `src/bridge.mjs`、`policy.mjs`、`budget.mjs`、`confirmation.mjs` | 保留事务和数据口径；验证 Windows 协议及进程行为 |
| 默认值及 fork | `new-chat-defaults.mjs`、`fork-budget.mjs`、`fork-metadata.mjs` | 复用，覆盖 Windows 路径与文件读取 |
| 本地统计及缓存 | `context-statistics*.mjs`、`thread-cache.mjs` 等 | 复用，检查文件指纹、替换、并发与 worker 路径 |
| 桌面发现及接入 | `paths.mjs`、`runtime-selection.mjs`、`automatic-startup.mjs` | 适配 Windows 安装布局、进程身份及启动环境 |
| 服务及 IPC | `service.mjs`、`ipc.mjs`、`daemon.mjs` | 替换 Unix socket、`ps`、权限和退出处理 |
| 安装及更新 | `scripts/install.mjs`、`updates.mjs`、`update-worker.mjs` 等 | 增加 Windows 安装、更新、回滚及卸载实现 |

不能只把 `darwin` 改为 `win32`。源码还存在 `/Applications`、`Contents/MacOS`、`launchctl`、`/bin/ps`、shell 包装脚本、符号链接、`chmod`、DMG 挂载、codesign 等依赖。

另一个明确的路径问题：`daemon.mjs` 的主入口比较使用手工拼接的 `file://` URL。Windows 盘符、反斜杠、空格和中文路径需要统一改为 `pathToFileURL` / `fileURLToPath` 处理，并检查测试中的同类写法。

部分旧文档仍描述版本白名单和已停用修复功能。实施基线以当前源码及最新变更为准：当前 `compatibility.mjs` 识别版本字符串格式，并没有维护版本白名单；后续需要在此基础上补充协议能力验证，不能把识别到版本号等同于完整兼容。

## 3. 推荐技术路线

**建议：Windows 使用 Electron 桌面壳与自绘 Web UI，继续使用现有 Node 控制服务、桥接和统计核心。** 这是本方案的技术选择，尚未创建 Electron 工程或新增依赖。

选择原因：现有业务代码以 ES modules 和 Node 标准库为主；Web UI 容易精确复刻双滑块、粒子、图表和布局；Electron 提供托盘、窗口、屏幕与单实例能力。代价是安装体积、内存占用和 Electron 更新维护，需要纳入验收。

暂不选择全量 WPF/WinUI 重写：虽然能做出相近外观，但仍须重写整套 UI，并增加跨语言边界。Tauri 可作为实测资源超标后的备选，不过它还需要额外的 Rust 壳与 Node sidecar 管理，不能假定总成本更低。P0/P1 完成后冻结技术选择，避免开发中途反复换框架。

建议的运行结构：

```text
Windows 原有 Codex 桌面
  └─ 经验证的运行时选择接入点
       └─ codex-context.exe（原生薄启动器，保持标准流及参数）
            └─ 随包 Node → src/wrapper.mjs → 原有 codex.exe app-server
                              ↕ 本地 IPC
                         Node 控制服务 / 统计 workers
                              ↕ 已有认证 HTTP 接口
                         Electron 主进程
                              ↕ 类型受限的 preload API
                         托盘弹窗 / 主窗口
```

桥接和 daemon 使用随包的独立 Node，不依赖 UI 存活，也不要求用户安装 Node。Electron 自带的运行时只服务 UI 壳；先接受这部分体积，再通过测量优化。原生启动器可用小型 C++ Win32 程序实现，需处理 Windows 参数转义、标准句柄和子进程退出。

### 平台层建议

新增 `src/platform/`，对外提供路径、IPC 端点、运行时发现、进程身份、服务生命周期、桌面接入登记、UI 启动与安装器选择等能力。建议拆成 `index.mjs`、`darwin.mjs`、`win32.mjs`，避免把平台判断散布到预算和统计算法中。

| macOS 机制 | Windows 对应方案 | 必须验证的细节 |
| --- | --- | --- |
| SwiftUI / AppKit | Electron `BrowserWindow` + 自定义组件 | 内容区尺寸、焦点、读屏、缩放、系统关闭行为 |
| `NSStatusItem` | Electron `Tray` + `.ico` | 明暗任务栏、高 DPI、Explorer 重启、单实例 |
| `NSPanel` 定位 | 托盘图标 bounds + 屏幕 workArea | 底部向上展开，多屏、负坐标、折叠区及备用定位 |
| LaunchAgent / `launchctl setenv` | 经实测确认的用户级接入登记 | 用户环境继承与应用启动链；不能仅写注册表便宣称接入成功 |
| Unix-domain socket | Windows named pipe | 用户隔离、认证、重连及命名冲突；不能对管道执行文件 unlink/chmod |
| `0700` / `0600` | 用户目录 ACL 与本地认证 | Node 的 mode 参数不能等同于 Windows DACL |
| `ps` / Unix signals | Windows 进程路径与身份查询、显式关闭握手 | PID 重用、路径大小写、拒绝访问、停止超时 |
| `.app` 布局及 symlink helpers | 实际 `codex.exe` 与辅助资源目录 | Store/普通安装差异；不要求管理员或开发者模式才能建立链接 |
| DMG / codesign / notarization | Windows 安装包、校验与 Authenticode | 架构匹配、文件占用、签名、升级失败恢复 |

原有 UI HTTP 服务已有随机 Bearer token，监听 `127.0.0.1` 并拒绝带 Origin 的请求。Electron 应由**主进程**访问它，再经 preload 提供有限操作；不要让 renderer 直接请求后端，否则会遇到 Origin 拒绝，也会扩大凭据暴露面。renderer 开启 `contextIsolation` 与 sandbox、关闭 `nodeIntegration`，使用本地资源与 CSP。

Windows IPC 使用独立命名管道端点，名称包含用户和安装目录的稳定摘要；摘要仅用于避免冲突，不是身份认证。增加认证握手，秘密存入受当前用户 ACL 保护的文件；实测跨用户访问。若直接使用 Node 无法满足所需 DACL，增加小型原生 helper 创建受限管道，不能默认所有本机用户都可信。

## 4. UI 与托盘行为规范

### 视觉基线

从当前 Swift 源码提取 design tokens，保留已有图标设计：

- 背景灰度 `0.095`、卡片灰度 `0.16`、白色边框透明度 `0.09`、主蓝色 RGB `(0.27, 0.50, 0.99)`。
- 主窗口初始参考最小 `960 × 670` DIP，侧栏参考宽度 270、范围 235–340；Windows 标题栏差异单独测量。
- 紧凑托盘面板参考宽度 400 DIP，聊天行高 50 DIP；长列表限制在当前工作区内并滚动。
- 双滑块轨道高 26、滑块直径 32，保留蓝色压缩点、白色容量点、灰色余量段、1K 微调、比例预设和草稿恢复。
- MAX CONTEXT 只改变对应进度条；窗口和卡片仍保持深色。保留最多 40 个流动粒子的表现，隐藏、失焦或减少动态效果时暂停。
- 复用 `macos/Assets/ContextManager.svg` 品牌源图，另按 `ContextMenu.swift` 的独立托盘轮廓生成多尺寸 ICO；不能直接把彩色应用图标当作菜单栏圆环的等价替换。

### 入口与窗口

1. 后台启动只出现托盘图标，不主动弹主窗口；关闭主窗口后托盘保留。
2. 左键切换紧凑面板；右键提供打开主窗口、检查更新和退出管理界面等操作。
3. 保留原面板的运行中聊天优先、最近五个其他已接入聊天、行内占用环与状态；所有本地聊天仍在主窗口查看。
4. 悬停行切换为容量调节，保留沿用压缩比例、应用/取消、移出丢弃草稿、拖动锁定当前行及最后位置提交的行为。点击其他区域进入该聊天主面板。
5. 从底部托盘图标上方向内展开，并约束在所在显示器 workArea；不能直接复制 macOS 左下原点坐标算法。图标 bounds 不可用时退回点击位置附近，再约束到工作区。
6. 外部点击或 Esc 关闭；拖动及内部弹层期间避免误关。键盘可以选聊天、调整滑块、应用和退出面板。
7. 退出管理界面不结束 Codex、桥接或正在生成的请求；更新/卸载通过独立流程处理服务。右键菜单文字需明确这一行为。
8. Windows 可能把图标收进右下角折叠区，不能强制固定到可见区域；安装说明提供系统设置引导。重启 Explorer 后确认图标能够恢复。

### 视觉验收

使用相同的合成状态、语言、窗口内容尺寸与动画相位，分别获取 macOS 参考图和 Windows 实测图。至少覆盖等待连接、列表有数据、双滑块重叠、MAX、统计详情、默认值、更新错误及托盘编辑草稿。

在 100% / 125% / 150% / 200% DPI、双屏不同缩放、中文/英文、明暗任务栏、系统减少动态效果及 Narrator 下检查。内容布局与数值需一致；设计间距和控件尺寸目标误差不超过 2 DIP，字体抗锯齿和系统装饰单独排除。差异截图必须可追溯，不能只写“外观接近”。

## 5. 功能保留与验收矩阵

以下“保留”均是开发要求，不表示 Windows 目前已可使用。

| 功能 | 实施要求 | 验收证据 |
| --- | --- | --- |
| 每聊天窗口与压缩阈值 | 复用策略、反算、预检与持久化 | 同一输入在共享 JS 与 UI 产生相同预算；按实际运行时窗口读回确认 |
| 双滑块及高级设置 | 保留 1K 步进、比例联动、预设、保留下限与下一轮预留 | 边界、往返拖动、键盘操作、取消与提交对照 |
| 热调整与聊天隔离 | 继续等待轮次边界，只重载目标聊天 | 活跃生成不中断；其他聊天继续；保留历史、工具、模型、审批和沙盒设置 |
| 连续更新及冲突处理 | 保留 revision、最新预算优先和迟到响应防护 | 重载中再次调整、旧回包、停止自动应用后不回退 |
| 新聊天全局默认 | 第一轮之前注入，只影响新聊天 | 已有聊天、临时及代理会话不被误套用 |
| fork 预算继承 | 桥接 fork 快照与本地元数据补充发现均保留 | 分支第一轮预算正确，后续父子独立，已有子预算不覆盖 |
| 上下文拓展 | 保留开关、上限、原版运行时目录方案及切换状态 | Windows 运行时独立验证；保持原生/拓展切换和预算恢复，不把 920K 当作服务端保证 |
| 托盘即时概览 | 保留真实读回占用、缺失和旧数据标签 | 未知不是零、断开不显示运行中、不把草稿当实际窗口 |
| 上下文详情 | 保留分类、事件、模型、原始明细及必要说明 | 同一合成日志的数据与原版一致 |
| 费用、缓存与生成速度 | 复用统计口径和估算标识 | 同一 fixture 聚合、费用与缺失点一致，不把生成速度当完整响应速度 |
| 趋势图交互 | 迁移 Swift 中的聚合及命中逻辑 | 悬停、固定、横轴命中、断点、重置边界、明细关联与当前版本一致 |
| 本地缓存与增量统计 | 保留启动快照、增量读取、worker 合并及上限 | 追加、半行 UTF-8、替换、截断与多聊天并发等价于完整重算 |
| Hook stats | 追加独立 hook，保留其他 hooks 和审核机制 | Windows 命令转义正确；安装/卸载只改自己的条目 |
| 中文 / English | 复用文案与现有自动语言选择规则 | 设置持久化、长标题、长英文与时区推断对照 |
| 诊断与连接状态 | 保留 doctor、已安装/服务/已加载桥接版本 | 接入失败、桥接旧版、等待确认与真正已确认清晰区分 |
| 在线更新 | 自动检查，用户点击后下载、验证及安装 | 平台/架构匹配、错误展示、回滚，不误下载 macOS 包 |
| 安装/重装/卸载 | 用户级安装、幂等、恢复自有登记，默认保留预算与备份 | 安装两次再卸载；外部设置和其他 hooks 保留 |
| 提前压缩修复 | **沿用当前版本停用状态** | 不为“功能齐全”重新启用已停用的修改核心方案；界面说明以当前发布行为为准 |

## 6. 开发顺序与完成标准

### P0：先证明真实桌面接入可行（预计 1–3 个工作日）

- [ ] 记录目标 Windows Codex 版本、安装渠道、主程序路径、原生 `codex.exe`、helper 布局、父子进程关系和实际启动参数；仅记录必要元数据。
- [ ] 在隔离配置中验证该桌面版本是否读取 `CODEX_CLI_PATH`，能否启动自有 `.exe` 包装器；不假定它与 macOS 相同，也不假定 `.cmd` 能被直接执行。
- [ ] 验证从原图标、开始菜单和已有快捷方式重开后的接入，以及应用更新后路径变动。单独确认原生 Windows 与 WSL/远程聊天的边界。
- [ ] 用当前 Windows 二进制生成 schema 并运行本地 mock-server 集成，验证订阅/恢复、配置覆盖、反向工具调用与取消。随后在隔离桌面会话验证真实接入链，不用旁路 CLI 成功冒充桌面成功。
- [ ] 特别核对取消订阅后的卸载时机与 resume 是否重建配置。当前官方文档存在无订阅后的宽限期描述，不能推断所有版本都立即重载。
- [ ] 如用户级环境登记可行，验证环境变化通知、已运行 Explorer/桌面进程的继承、重开或重新登录的真实要求，再确定安装指引。

交付：新增 `docs/WINDOWS_COMPATIBILITY.md`，给出版本、安装渠道、证据和结论。**P0 未通过时，不进入“完整功能已实现”的承诺。** 若官方原启动链无法接入，先记录具体原因与可逆启动器备选对正常使用的影响；该备选需作为产品体验变化明确列出，不能悄悄用只读模式替代预算控制。

### P1：提取平台层，让核心在 Windows 跑通（预计 2–3 日）

- [ ] 为 `paths`、`runtime-selection`、`service`、`ipc`、`menu-bar`、自动接入和安装布局加入平台适配；不改业务数据格式。
- [ ] 应用文件默认安装到 `%LOCALAPPDATA%\Programs\ContextManager`，数据存到 `%LOCALAPPDATA%\CodexContextControl`；继续支持 `CONTEXT_CONTROL_HOME` / `CONTEXT_CONTROL_CODEX_HOME` / `CODEX_HOME` 等现有覆盖。
- [ ] 修复 file URL、中文/空格路径、大小写与规范化；测试长路径、只读路径和原子替换失败恢复。
- [ ] 实现管道端点、认证、ACL、服务单实例和陈旧锁恢复；服务身份使用进程映像路径及启动身份交叉核对，不能只按 PID 杀进程。
- [ ] 把 `SIGTERM` 假设改为先请求服务 flush/shutdown、确认退出，再按身份执行超时处理。后台 Node 以隐藏窗口方式启动，UI 退出不联动杀 runtime。
- [ ] 处理 Windows 正在运行的可执行文件不可直接替换、helper 无管理员符号链接替代和旧运行时清理。

完成标准：Windows 纯业务测试通过；模拟桌面、wrapper、daemon、统计 worker 可以启动、重连和退出；macOS 测试继续通过。

### P2：托盘与原生启动器（预计 2–3 日）

- [ ] 建立 `desktop/` Electron 壳、单实例、preload 边界和随包 Node 启动路径；固定依赖版本及 lockfile。
- [ ] 新增 `windows/native/` 薄启动器：透传参数、cwd、环境、stdin/stdout/stderr、EOF 和退出码；输出中不混入日志，不弹控制台窗口。
- [ ] 验证 Codex 对取消与关闭的实际机制、进程句柄和 job object 行为；不得因 UI 更新或关闭而结束活跃模型请求。
- [ ] 实现托盘图标、动态占用环、菜单、弹窗定位、系统缩放、Explorer 重启恢复与重复启动聚焦。
- [ ] 托盘 UI 与状态查询解耦，按现有状态刷新更新图标，不以高帧率重建系统托盘图标。

完成标准：真实任务栏可操作、无重复图标或黑色命令窗口，所有弹窗留在可见工作区，UI 退出后桥接继续。

### P3：复刻主窗口与预算交互（预计 3–4 日）

- [ ] 提取视觉 token 与合成 fixtures，实现聊天侧栏、状态卡片、双滑块、默认值、上下文拓展和设置。
- [ ] 通过共享 JS 实现预算校验、容量换算和草稿运算；与 `macos/BudgetMath.swift`、`MenuBudget.swift`、`NewChatDefaults.swift` 的案例对照，补齐仅在 Swift 的 UI 运算。
- [ ] 接入现有 `/state`、`/preflight`、`/policy`、`/clear`、`/compact`、`/new-chat-defaults`、`/context-extension` 等接口，保持后端响应和状态语义。
- [ ] 复刻托盘悬停编辑、单滑块、拖动事件合并、草稿取消和行切换；生成中仍显示排队而非立即确认。
- [ ] 完成键盘、Narrator、高对比及减少动态效果行为，保留控件可访问名称和值。

完成标准：预算和默认值端到端可用，状态区分准确，视觉基线逐项检查通过。

### P4：统计、图表与性能对齐（预计 2–3 日）

- [ ] 接入 `/context-stats`，复用缓存、统计 worker、token 计数与费用核心。
- [ ] 迁移 `TimelineData.swift` 的展示聚合及 `TimelineInteraction.swift` 的命中规则，使用相同 fixture 验证；图表库是否使用及版本在此阶段固定。
- [ ] 实现图表主体和悬停覆盖层分离、固定点和明细、缺失值断线、原始记录折叠，避免悬停触发全量后端统计或图表重建。
- [ ] 保留刷新节奏：普通状态约 2 秒，统计约 10 秒；拖动/悬停时按现有交互暂停相关刷新，面板隐藏后不保留无用动画。
- [ ] 测量冷启动、托盘打开、后台 CPU、总进程 RSS 和大日志增量统计；不能用旧 Mac 数字直接宣称 Windows 性能。

完成标准：同一日志的统计与原版一致，追加、截断、替换、多聊天及超过缓存预算的场景无遗漏。

### P5：安装、自动接入、更新与回滚（预计 2–3 日）

- [ ] 新增 Windows 用户级安装器，分别包装 x64/ARM64；包含 Electron UI、独立 Node、tokenizer、核心源码、原生 shim 及必要许可。
- [ ] 依照 P0 结果实现接入登记；只在值仍属于本项目时恢复旧值，已有第三方 `CODEX_CLI_PATH` 不覆盖。
- [ ] 托盘开机启动与 Codex 桥接登记分开记录和诊断；前者不能证明后者生效。
- [ ] Windows hook 命令使用实际运行环境可解析的引号/路径，保留原 hooks，备份并检测并发修改，不生成信任记录。
- [ ] `updates.mjs` 改为按 platform/arch 选资产，清楚处理无当前平台包、预览频道和版本差异；现有 macOS arm64 文件名、大小上限不能直接照搬。
- [ ] Windows updater 验证来源、版本、架构、哈希与发布签名策略；签名证书及发布凭据作为发布前依赖。不能把同源 SHA-256 当作发布者身份签名。
- [ ] 使用版本目录和稳定 shim，等待预算事务边界；新 wrapper 对新启动生效，旧连接继续，未使用旧文件才清理。更新失败恢复上一版并保留数据。
- [ ] 卸载移除自己的登记、hook 和程序文件，默认保留预算/备份；活跃桥接完成正常退出后清理，不结束 Codex。

完成标准：新安装、重复安装、跨版本升级、断网、坏包、文件被占用、回滚及卸载都在隔离目录通过。

### P6：Windows CI 与发布验收（预计 2–3 日）

- [ ] `.github/workflows/checks.yml` 增加 `windows-latest`，先跑跨平台 Node 测试，再做 shim 与 Electron 构建；macOS 编译/UI 检查保留。
- [ ] 测试中的 `/tmp`、shell、Unix 可执行文件和硬编码 `file://` 改为跨平台 fixture；平台专属测试明确跳过，不为追求全绿删断言。
- [ ] 新增 Windows 运行时集成、安装/更新/卸载和服务恢复测试；需要 runtime 而缺失时报告 skipped，不计为验证成功。
- [ ] CI 使用隔离 Codex home、固定 schema/合成目录与回环 mock 服务；真实桌面和托盘、多屏、读屏列入交互式实机验收，不能由无交互 runner 的绿灯代替。
- [ ] 新增 Windows 安装、使用、兼容与发布文档；README 在功能真正通过后才添加下载和支持声明。

完成标准：功能矩阵每行都有通过证据或明确的发布阻塞项；不把未实现项静默删除为“首版简化”。

以上按单人熟悉代码估算，合计约 14–22 个工作日；P0 未通过、上游协议变化、ARM64 环境和签名证书准备会影响进度。先完成 P0，再更新排期。

## 7. 建议文件落点与后续提交顺序

```text
docs/WINDOWS_ADAPTATION_PLAN.md    本方案（本次新增）
docs/WINDOWS_COMPATIBILITY.md      P0 实测证据（待新增）
docs/INSTALL_WINDOWS.md            安装、折叠区、环境继承与卸载（待新增）
src/platform/                     平台接口及实现（待新增）
desktop/main/                     Electron 托盘、窗口、主进程后端访问（待新增）
desktop/preload/                  有限的 UI API（待新增）
desktop/renderer/                 视觉组件、图表和页面（待新增）
windows/native/                   Win32 shim 与必要 helper（待新增）
windows/installer/                安装、升级与回滚资源（待新增）
scripts/build-win.mjs              Windows 构建（待新增）
scripts/package-win.mjs            Windows 分发打包（待新增）
test/fixtures/                    双平台共用合成状态/统计输入（按需新增）
```

推荐按 P0 证据 → 平台层 → shim/托盘 → 预算 UI → 统计 UI → 安装更新 → CI/文档逐次提交，每次附对应验证结果。复用现有测试文件；确有 Windows 特有行为再增加测试，避免另写一套与业务实现同步重复的测试。

`build:win`、`package:win`、`dev:win` 及隔离测试入口现已加入 `package.json`，当前执行方式见 Windows 指南。

## 8. 最终验收清单

- [ ] 原有 Codex 普通启动后成功接入；不是另开一个独立 app-server 的演示。
- [ ] 右下角托盘可打开紧凑面板，主窗口关闭后后台能力保留，Explorer 重启后图标恢复。
- [ ] 页面、双滑块、托盘编辑、图表、MAX 动效与参考 UI 一致，DPI、键盘与读屏通过。
- [ ] 预算、默认值、fork、上下文拓展、统计、Hook stats、更新、安装和卸载逐项通过。
- [ ] 生成、取消、反向工具调用、动态工具与其他聊天不受预算事务影响；未知和失败不标成已确认。
- [ ] 凭据、正文、真实聊天标题不进入测试产物或公开诊断；本地端点认证与用户隔离通过。
- [ ] macOS 构建和必要回归通过；Windows 安装产物可在干净机器上独立运行。

## 9. 参考与事实边界

- 仓库依据：[开发契约](DEVELOPMENT.md)、[UI](UI.md)、[架构](ARCHITECTURE.md)、[性能](PERFORMANCE.md)、[上下文拓展](CONTEXT_EXTENSION.md)，以及当前 `macos/`、`src/`、`scripts/` 源码。旧文档与源码不一致时需补充实测，不直接沿用旧支持声明。
- [OpenAI App Server 官方文档](https://learn.chatgpt.com/docs/app-server)：确认 JSONL stdio 和按运行时生成 schema 的方式；其中 unsubscribe 生命周期描述也要求本项目重新验证重载行为。它**没有在本次核查中确立 Windows `CODEX_CLI_PATH` 为稳定第三方接入契约**，该接入仍列为 P0 实测项。
- [Electron Tray](https://www.electronjs.org/docs/latest/api/tray)、[BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[screen](https://www.electronjs.org/docs/latest/api/screen)：用于托盘、独立内容窗口和屏幕工作区的实现依据。
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)：用于 renderer 隔离和 preload 边界。
- [Node net](https://nodejs.org/api/net.html)：Windows IPC 对应 named pipes，不能直接套用 Unix socket 文件生命周期。
- [Microsoft 通知区域说明](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area)：托盘可见区/折叠区及用户控制边界；应用不应承诺强制固定显示。

上述资料核查于 2026-10-17；它们支持 API 选型，不代表本项目 Windows 版本已通过验证。
