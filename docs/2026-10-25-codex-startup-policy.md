# Codex 更新后无法加载组织设置：故障分析

日期：2026-10-25（Asia/Taipei）  
受影响环境：Windows；Codex 桌面版 `26.1021.3705.0`；Context Manager `0.26.3`  
处理分支：`codex/release-maintenance`；拟发布修复版本：`0.26.5`

## 现象

启动 Codex 时出现“无法加载组织设置”，应用暂停并提示检查网络、代理或防火墙。Context Manager 当时已启用 Codex 集成，Codex 启动所用的可执行文件被指向 Context Manager 的 `codex-context.exe`。目前的本机证据指向启动命令兼容性问题；弹窗本身不能证明账号组织权限或网络故障。

## 时间线与证据

| 本地时间 | 观察 |
| --- | --- |
| 01:47 | 使用 Context Manager `0.26.2` 的启动尝试中，Codex 记录 `Desktop startup policy read failed`，原因 `process`。启动器记录输入流收到 0 字节后结束，原生进程输出 122 字节并退出。 |
| 01:48 | Context Manager 升级至 `0.26.3`，接入探针完成 `initialize` 并报告 `ready`，随后保存了启用集成的配置。 |
| 01:48 | 正式启动时，Codex 选择 `codex-context.exe` 作为 app-server 运行时，随后记录同一阶段失败，原因变成 `protocol`。Context Manager 记录原生子进程启动后立即出现 `wrapper.client_disconnected`，子进程收到 `SIGTERM`。日志未标明断连回调的具体触发源。 |

Codex 日志位置：`%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Codex\Logs\2026\10\24\`。  
Context Manager 日志位置：`%LOCALAPPDATA%\CodexContextControl\logs\integration.jsonl` 与 `launcher.jsonl`。

## 原因判断

1. 故障版本内置的 Codex CLI 已确认提供 `app-server proxy` 子命令，用于将标准输入输出转发至运行中的 app-server 控制套接字。修复前，Context Manager 的 `isStdioServer()` 只排除了 `daemon` 和生成代码等子命令，未排除 `proxy`。因此，若启动阶段使用 `app-server proxy`，它会被误当成可注入模型目录和上下文配置的直接 stdio app-server。这是与新版 Codex 命令形态不兼容的明确代码缺陷。
2. `0.26.3` 新增的退出清理把输入流 EOF 视为立即断连，并向原生子进程发送 `SIGTERM`。故障日志证实断连回调和终止信号紧随原生进程启动发生，但没有指出是 EOF、输出管道关闭还是父进程检查触发了回调。过早终止可能截断启动响应，使错误表现为协议失败。
3. `0.26.2` 的启动尝试也曾报 `process` 错误。因此，不能把整个问题仅归因于 `0.26.3` 的退出清理。现有日志只记录参数数量，没有记录启动命令的完整参数，也没有证明当次失败一定调用了 `proxy`。Codex 桌面版的具体更新时间亦未核实。

综合判断：问题很可能由 Codex 与 Context Manager 更新后的启动命令不兼容触发，`0.26.3` 的立即杀进程行为又放大了故障。尚无证据表明是用户账号、组织设置或网络本身失效。

## `0.26.5` 修复

- 将 `app-server proxy` 和 `app-server help` 作为普通原生命令透传，不再走直接 stdio app-server 的包装与配置注入。
- 输入流 EOF 时先关闭原生进程的输入，给它时间完成最后的输出；只有超时仍未退出才执行终止清理。输出管道断开和父进程消失仍触发清理。
- 该逻辑位于 Windows 与 macOS 共用的核心代码中。产品版本同步更新至 `0.26.5`。

## 验证与剩余风险

发布前复核：完整 `npm run test:ci` 运行 402 项，363 项通过、39 项按环境条件跳过、0 失败；架构检查和 `git diff --check` 通过。随后新增真实 Node 子进程回归，验证输入 EOF 后延迟输出的启动响应可以完整返回并正常退出；协议识别与生命周期定向测试共 8 项通过。macOS 打包脚本会复制完整共享 `src/`，因此包含这两处修复；macOS 原生构建、测试和安装包校验由 GitHub Actions 执行。

以上证据确认共享代码缺陷已修复，但不代表已在 macOS Codex 桌面版上复现并确认弹窗消失。最终验收应在安装新版本并完全重启 Codex 后进行：启动不再出现组织设置弹窗，Context Manager 接入状态出现有效连接，并能正常打开聊天。
