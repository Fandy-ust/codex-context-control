# Windows 兼容性记录

日期：2026-10-17。仓库基线 `a6f44d7` / 产品版本 `0.17.2`，适配分支 `codex/windows-adaptation`。

**当前结论：Windows x64 本地预览实现已完成，核心测试、真实 Windows 内核的隔离集成测试和隐藏窗口加载检查通过。人工 UI、首次安装后的普通桌面激活、多屏和系统可访问性尚待使用者验收。** 当前运行中的 Codex 没有被重启，真实 `CODEX_CLI_PATH` 未被开发测试自动修改；不把内核模拟集成等同于现有桌面进程已激活。

## 当前验证结果

| 验证 | 结果 |
| --- | --- |
| `npm test`，显式指定本机 Windows `codex.exe` | 148 项：127 通过、0 失败、21 跳过 |
| 真内核预算集成 | 逐聊天窗口确认、历史/工具/权限/指令保留、生成排队、fork、服务恢复通过 |
| 真内核拓展集成 | 920K 读回、轮后压缩、大输入前保护、原生/拓展切换与预算恢复通过 |
| 真内核原生工具 | 本地 PowerShell `Write-Output` 经桥接执行，退出码 0，stdout 进入下一次模拟模型请求 |
| 原生 `.exe` 包装器 | 二进制 stdin/stdout、stderr、中文/空格/引号参数、cwd、退出码及 Hook 模式通过 |
| Windows 接入登记 | 随机独立用户环境变量的重复登记、冲突拒绝、外部修改保留与撤销通过；未操作真实 `CODEX_CLI_PATH` |
| 安装/升级/卸载 | 隔离目录安装两次、原生入口、未来配置字段保留、模拟 0.17.2→0.17.3 服务替换、配置快照、卸载及数据保留通过 |
| UI 加载 | 主窗口、托盘、全局默认及三张趋势图加载通过，renderer 无直接 Node 入口；不等于视觉验收 |
| macOS 原生 UI/安装及其他架构 | 本机未执行；保留 macOS CI，不能把跳过项记为通过 |

常规与内核测试日志为本地 `build/windows-final-tests.log`，不会随源码提交聊天数据。所有模型交互都使用隔离 Codex home 和回环模拟服务，没有调用远端模型或消耗真实模型额度。

更新器选择当前平台/架构资产，复用流式下载校验，再用 Windows ZIP 解压与文件清单验证。`node scripts/test-win-update.mjs` 已通过：本地模拟下载、SHA-256、ZIP 解压、完整清单、安装、清理及坏包拒绝。它不访问网络，不能冒充尚未发布的远端 Windows 资产验证。

## 实现范围

新增 Electron 托盘/主窗口、原生 C# shim/安装器、Windows 路径/管道/ACL/进程/用户环境适配、Windows 构建分发和更新流程。预算、桥接、统计缓存、费用、默认值与 fork 核心继续共用。文案翻译和 Hook 编辑也提取为共享实现。

现有 macOS SwiftUI 保留；Windows 主面板与小面板复刻原版布局、双滑块、MAX 动效、草稿行为、分类、费用和趋势明细。界面细节由 [UI 验收清单](WINDOWS_UI_CHECKLIST.md) 确认。

## 本机只读检查

| 项目 | 观测 |
| --- | --- |
| 桌面安装 | MSIX 包 `OpenAI.Codex`，版本 `26.1013.3656.0`，x64 |
| 桌面进程 | 包内 `app/ChatGPT.exe` |
| 包内运行时 | `app/resources/codex.exe` 返回 `codex-cli 0.163.0-alpha.10.2` |
| 运行中内核布局 | 当前用户 LocalAppData 下的版本化 `OpenAI/Codex/bin/<digest>/codex.exe`；不能假定一直直接执行包内文件 |
| 可用本地 CLI | 当前用户 `Programs/OpenAI/Codex/bin/codex.exe` |
| 应用内接入线索 | 只读检查 `app.asar`，存在读取 `CODEX_CLI_PATH`、Windows 路径解析及本地 daemon 选择逻辑 |
| 开发 Node | `v24.18.0` |
| 依赖 | `npm ci --ignore-scripts` 成功 |

上述证据只证明文件布局、版本及应用代码中存在相关处理。**尚未证明**给 Windows 桌面注入环境后一定选中本项目包装器，亦未验证 MSIX 启动环境继承、shim 标准流及子进程生命周期。未修改注册表、启动项、用户环境或已安装 Codex 文件，也未重启现有 Codex。

应用可能有独立的本地 daemon 和版本化核心路径。适配时先证明包装器进入了真实当前连接，再验证逐聊天预算；旁路 CLI 的成功不能替代这个结果。

## 原始 Windows 测试基线（适配前）

在未修改业务代码时执行：

```powershell
npm ci --ignore-scripts
node --test --test-reporter=dot test/*.test.mjs
```

依赖安装成功，测试退出码为 1。已观察到的适配问题：

- daemon 用普通文件路径 `ipc.sock` 作为 IPC 端点，在 Windows 触发 `listen EACCES`，影响统计 HTTP、默认值 API 和聊天活动 API 等测试。
- 多项测试使用 `/tmp/...`，Windows 无该目录时 `mkdtemp` 失败。
- 符号链接测试依赖 Unix 权限及链接创建方式，当前 Windows 环境触发 `EPERM`。
- 部分 runtime fixture 是 shell 程序，Windows 不能按原方式执行，版本检测结果为空。
- macOS runtime 选择测试使用本机 `path.join` 生成 Windows 分隔符，再按 `/Contents/MacOS/` 解析，导致平台混用失败。
- 服务异常重启测试受 daemon 启动失败影响，未通过。

上述基线失败已通过平台层与 fixture 修正解决，当前测试结果见文首。macOS 专属项目仍然明确跳过，没有删除其在 macOS 上的断言。

## 仍需激活或人工验收的证据

- [ ] 在隔离启动环境验证本机桌面实际采用 `.exe` shim，而非本地 daemon 或另一份 CLI。
- [ ] 验证普通图标/开始菜单重开、MSIX 环境继承及应用升级后的运行时发现。
- [x] Windows 订阅、恢复、配置覆盖、预算读回和两个聊天隔离的真实内核模拟集成。
- [x] 启动器参数、EOF、退出码和真实原生命令输出通过。
- [ ] 在原桌面普通启动链中确认首次接入；本次未替使用者关闭当前桌面。

实施顺序见 [Windows 适配方案](WINDOWS_ADAPTATION_PLAN.md)；代码复用和版本管理见 [多平台开发约定](MULTIPLATFORM_DEVELOPMENT.md)。
