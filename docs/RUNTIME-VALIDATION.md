# 启动、信任与资源验收标准

适用于 macOS 和 Windows。自动检查接在双平台构建、安装、更新测试之后；真实浏览器认证作为发布验收。测试与文档维护不改变运行时行为，也不单独升级产品版本。

## 什么才算通过

| 层次 | 固定检查 | 判定与证据 |
| --- | --- | --- |
| CI 启动 | Mac 原生 launcher 保持 runtime PID、原样传输二进制输入、准备失败不吞输入；Windows EXE 保留参数、工作目录、标准流与退出码 | 本平台 launcher 测试必须执行，不允许跳过 |
| CI 生命周期 | 健康客户端不被误杀；客户端死亡、输出管道断开后清理自己持有的运行时；EOF 保留尾部响应 | 使用隔离进程，不终止用户的 Codex；失败阻止发布流水线 |
| CI 被动观察 | 原样转发额度通知，不追加后台 RPC；缓存过期不变“新鲜”；兼容性成功缓存复用、失败冷却、升级失效 | 无登录依赖，检查实际调用与状态，不只搜索源码 |
| CI 预算与交接 | 真实目标/额外计数分开；Credits 与停止规则；精确轮次完成、取消、去重、不确定结果不重发 | 隔离功能测试；不能把这些结果说成服务端容量保证 |
| CI 有界本地工作 | worker 数量受限，闲置释放；同聊天去重；不重复读未变历史；只读追加；跨聊天缓存不串数据；速度查询不做全文 token 化 | 基于字节量、调用次数和生命周期的断言，避免用共享 runner 的不稳定 CPU 数作为门槛 |
| CI 构建产物 | 记录本平台 EXE 哈希；Mac 验证本 App 和 launcher 的签名完整性 | 不等于 OpenAI 签名身份，也不等于浏览器允许连接；Windows 此步骤不声称 Authenticode 已验收 |
| 实机身份与浏览器 | 更新前后官方 Codex 哈希及签名；重开后实际进程身份与链路；现有 JS 浏览器接口发现 Chrome 并成功 `tabs.list()` | 必须记录客户端、manager、bridge 版本和时间；空共享标签列表可以通过；认证失败不能换通道绕过 |
| 实机负担 | 空闲隐藏、窗口可见、长聊天刷新、预算更新、任务完成/关闭后分别采样 | 报告 CPU、RSS、采样时长、聊天数、缓存冷热；网络/磁盘/唤醒未测时必须明确写出 |

执行 `node scripts/test-runtime-release.mjs`。结果写入 `build/runtime-release/report.json`、各组 TAP 和 `summary.md`；CI 上传独立 evidence artifact 并写入运行摘要。任何本平台必跑组失败、取消、跳过或没有测试都会失败。`automatedPassed` 只说明自动层通过，`liveBrowser.status=not_run` 不能冒充真实浏览器通过。

现有真实 Codex＋本地 provider 的预算/压缩集成测试仍在完整测试套件中。没有官方客户端的 runner 会跳过这些用例，标准报告和发布验收必须保留这一范围限制。不能用编译的 fixture 或本地 ad-hoc 签名模拟 OpenAI 的真实服务端授权结论。

### 实机最小步骤

1. 更新前记录官方运行时路径、SHA256、签名身份和严格校验结果；另记本 App、连接版本与拓展开关。
2. 更新本 App，确认安装版本、控制服务版本及产物哈希一致。旧连接仍在运行时，不声称已经验证新版桥接。
3. 正常完整重开 Codex，确认在线 bridge 是本次版本。Mac 应看到 ChatGPT → 官方 Codex → Node 子进程；不要仅凭进程名称，核对可执行路径和官方签名。
4. 按 Browser Workflow 使用当前宿主 JS 接口发现 Chrome、读取受支持接口并调用 `tabs.list()`。不改权限、不上传文件、不需要登录业务网站。
5. 正常交互后核对目标窗口和原生计数读回。例如目标 828000、历史估算 64268，对应原生窗口 892268；真实目标和剩余空间不能被算成 892268。
6. 一次性交接检查 sourceCompleted、唯一 executionId、精确 turnId，并在后续轮次确认 completed。停止/插话、断线、过期与未知提交使用隔离测试覆盖，不为验证去打断别人的真实任务。

浏览器连不上时记录准确阶段：发现失败、原生连接关闭、明确身份拒绝、标签不可用、网站权限。`native pipe closed` 是连接断开症状；只有相应拒绝日志/签名或身份证据才能归因。

## 为什么文件没改，连接仍可能被拒绝

签名完整性检查回答“代码有没有被修改、谁签的”；服务身份策略回答“这个运行进程或连接是否符合我的要求”。两项不能互相替代。Apple 文档说明签名 requirement 用于识别代码，签名后的改动会破坏签名；对运行进程也可以进行动态验证：

- [Apple：Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)
- [Apple：Inside Code Signing — Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)

本项目的历史证据包括两种不同情形：旧修改版 Codex 不再具有官方 OpenAI 身份；旧 App → Node 代理 → 官方 Codex 路径中，官方文件仍可通过签名校验，但实际连接出现 `untrusted-code-signing-identity`，原生直连和后续子进程代理对照可以连接。它支持“启动/连接身份路径有影响”的诊断，不足以公开声称 OpenAI 检查器只查直接父进程，或每次都是同一个被拒绝 PID。

现在 Mac launcher 用 `exec` 让自己的 PID 成为官方 Codex，Node 只持有传输管道并作为它的子进程。修改配置数值不会重新签名官方二进制。禁止为修复连接而关闭身份校验、替换官方运行时或改 Chrome 权限。

Windows 保留现有 EXE/Node 启动机制，没有因此套用 Mac 的身份判断。自动测试覆盖其启动、流转发、退出清理与安装更新；Windows 上真实浏览器/系统信任行为需要对应平台实机验收。

## 当前监控究竟做什么

| 组件 | 何时运行 | 资源与外部请求 |
| --- | --- | --- |
| 每个 stdio 连接的 Node bridge | 随宿主运行时启动；通常一个连接承载多个聊天 | 事件驱动地转发 JSON-RPC，接收已有 usage/额度事件；不是每聊天一个 server |
| 客户端存活检查 | 每个 bridge 每 2 秒 | Mac 用 `kill(pid,0)` 检查存活；Windows 会调用 `tasklist.exe`，确实有周期性短进程开销。异常清理只针对自己持有的运行时 |
| 控制服务 | 独立本地 Node，IPC＋仅本机 HTTP | 管理状态/队列/缓存；本机读取有 CPU/内存/磁盘成本，不因为“没有模型调用”就免费 |
| 额度同步 | 已有客户端通知立即更新；本地缓存读取约每 10 秒 | 不主动创建额度探测 app-server，也不为刷新请求模型列表；旧读数不会因重读缓存而刷新观测时间 |
| Credits 与自动换账号检查 | 各约每 3 秒 | 检查当前本地状态；是否启用功能决定后续操作。不是每 3 秒请求模型 |
| 额度启动检查 | 约每 10 秒检查计划 | 默认关闭自动周启动；用户明确启用的启动探测会实际调用模型，属于另一个有费用的功能 |
| 任务调度 | 普通队列启用、存在交接或待核对的运行任务时每 1 秒 | 复用一个服务内 timer；无任务时停表；会重复本地额度检查，但不是 1 秒一次模型请求。执行任务/压缩才会产生相应模型使用 |
| 防睡眠 | 有需要运行的自动队列/交接期间 | Mac 一个 `caffeinate` 子进程；Windows 一个持有系统执行状态的 PowerShell 子进程，结束后释放 |
| 侧栏元数据 | 服务约每 15 秒 | 本地索引/文件读数；不是下载聊天全文。较多聊天仍可能提高状态构建与序列化成本 |
| 额度历史扫描 | 初次约 3 秒；正常约 10 秒；积压时约 1 秒 | 本地增量分析和 SQLite；有后台工作成本。新鲜额度记录还会写本地历史 |
| 上下文统计 | 查询/面板需要时 | 最多 2 个 worker；同聊天合并工作；通常闲置 30 秒回收。每 worker 384 MiB 是 JS old-generation 限制，不是整个进程 RSS 上限 |
| 额度统计 worker | 新观察记录、扫描或报表时 | 单 worker，JS old-generation 256 MiB，闲置约 30 秒回收；后台扫描可使其持续活跃 |
| 历史推理估算 | 应用预算、冷恢复及安全的下一轮边界 | 本地 `.jsonl`/`.zst` 读取、解码、估算；按文件指纹/追加复用有界数值缓存，不保留推理内容；首次大历史解压有 CPU 和分配峰值 |
| 原生预算加载 | 空闲安全边界且数值需要改变 | 同一官方运行时中 unsubscribe/resume；可能导致该聊天的 MCP 重新初始化。这种延迟/网络开销不能与启动额外 Codex 监控 server 混为一谈 |
| UI 刷新 | Mac 菜单/窗口可见约 1 秒、运行聊天 2 秒、正常隐藏 6 秒、离线 15 秒；Windows 主进程可见 2 秒/隐藏 10 秒，renderer 可见时还有本地刷新 | 构建状态、序列化、布局与图表都有成本；本地刷新不等于远程模型请求 |
| 兼容性确认 | 原生文件、版本或配置变化时；成功结果缓存，失败约 60 秒冷却 | `--version` 和有限的本地 `app-server generate-json-schema` 导出后退出；不初始化持久 app-server。记录进程命令时须区分导出工具与实际监控 server |
| 更新与云同步 | 检查更新启动后一次/约每 6 小时；云同步按已有用户设置 | 可能访问 GitHub/同步端点；不是模型列表。不能声称整个 App 零网络 |

主要代码入口：[wrapper](../src/wrapper.mjs)、[native launcher](../macos/runtime-launcher/main.swift)、[lifecycle](../src/runtime-lifecycle.mjs)、[passive quota](../src/passive-quota.mjs)、[daemon](../src/daemon.mjs)、[statistics service](../src/context-statistics-service.mjs)、[reasoning resolver](../src/compaction-compensation.mjs)。

## 如何量化，而不是凭感觉说轻量

运行 `node scripts/sample-manager-resources.mjs 15`，仅采样现有进程，结果为 `build/manager-resources.json`。不启动 Codex、不发送模型请求、不修改窗口/监控开关。CPU 是单个逻辑核的百分比，RSS 包括共享页面；多个进程相加不是唯一物理占用。Windows 此工具不测父子链；两端都不测网络字节、磁盘 I/O 或唤醒。

2026-11-02 本机一次 15 秒观察：一个聊天运行，菜单及窗口可见，普通队列为 0。控制服务 CPU 约单核 7.2%、RSS 286–351 MiB；bridge 约 0%、134.5–134.6 MiB；UI 约 4.6%、121.9 MiB。官方 Codex 另列为对照，不能算成全部由本 App 新增的开销。这个读数不能外推为空闲开销或 Windows 开销。

建议发布前固定四个场景，各自保留冷热两次记录：隐藏空闲、窗口打开、长历史刷新/切聊天、预算更新后再等待回稳。优先比较同机同场景的 CPU 时间、常驻工作集、重复解压字节、worker 数、额外 native 启动次数和模型列表请求数。第一版不编造通用 CPU/RSS 硬阈值；先建立可重复基线，再给每个平台制定回归预算。

设计上优先减少高频全量状态重建、重叠的 UI 刷新、后台扫描和 Windows 周期 `tasklist`，而不是仅压低界面显示的进程数。保留事件驱动的 usage/额度观察、数值增量缓存和按需 worker。必要时分别优化，配合前后同场景测量；本次只建立测试和说明，不改变这些生产行为。
