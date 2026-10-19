---
name: context-manager
description: "Operate the installed Context Manager app through its CLI: inspect global quota and chat context, adjust chat or new-chat budgets, analyze observed speed, and manage task queues. Use for operating the app, not editing its source or changing generic Codex configuration."
---

# Context Manager

Context Manager 是 Mac 菜单栏／Windows 托盘中的本地控制器，管理 Codex 聊天预算、额度分析与任务队列。CLI 与界面使用同一服务；额度保护、权限、队列执行和上下文补偿由 App 负责。

## 找到入口

- macOS：`~/Library/Application Support/CodexContextControl/bin/context-manager`，路径含空格，调用时加引号。
- Windows PowerShell：`& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd" ...`。
- 开发环境：只在用户指定的源码仓库中使用 `node src/cli.mjs ...`。

先用 `--help` 检查实际支持的命令；队列细节看 `queue --help` 和 `queue schema`。入口缺失时说明需要安装带 CLI 的版本，不直接改数据文件来代替 API。`skill path` 可定位随 App 分发的本技能。

## 按任务选择操作

- **全局与聊天查询**：`global status`、`global quota`、`global usage`、`global defaults`、`chat list`、`chat show CHAT_ID`。需要新观测时，相关查询可加 `--refresh`。
- **单聊天窗口**：`chat preflight CHAT_ID --window 400K --compact 360K` 检查预算；`chat set CHAT_ID --window 400K --compact 360K` 保存并请求应用。数值使用用户要求的实际可用容量。`--save-only` 只保存，`--revision N` 防止覆盖较新的编辑。
- **新聊天默认值**：`global defaults-set --window 400K --compact 360K`。它只影响后续新聊天；已有聊天独立设置，fork 继承父聊天预算。
- **压缩／停止自动应用**：用户需要时使用 `chat compact CHAT_ID` 或 `chat stop-auto CHAT_ID`；后者不删除历史，也不会立即恢复运行时窗口。
- **速度分析**：`chat speed CHAT_ID --limit 20`，或 `chat stats CHAT_ID`。这是只读分析，不切换模型或快慢模式，不设定固定 tokens/s。
- **队列**：先查 `queue show CHAT_ID`；添加任务用 `queue add CHAT_ID --prompt-file task.txt --request-id UNIQUE_ID`，模型、思考程度、权限和附件可由 `--settings-file` 提供。其他操作与 JSON 字段以 `queue schema` 为准。

聊天 ID 从查询结果取得；名称不足以唯一定位时先确认目标。按用户指定或已授权的范围操作，查询本身不授权修改预算、队列、权限或执行压缩。

## 正确理解结果

- CLI 成功为 stdout 的 `{schemaVersion:1,ok:true,data:...}`；失败为 stderr 的 `{schemaVersion:1,ok:false,error:{code,message}}`，退出码非零。
- 保存、排队和运行时确认是不同状态。调节后读取 `chat show`，根据 `phase`、`expectedWindow`、`observedWindow` 和 `compensation` 报告实际进度，不把保存成功说成已经生效。
- 开启补偿后 Codex 的运行时窗口可能比目标更大。继续以 App 保存的目标预算操作，不手动把原生读回值改成目标值。容量上限由 App 校验。
- 速度缺少观测时保留 `null`，不能当作零；按记录的模型／思考程度／服务档位比较。生成吞吐可能包含推理输出，不等于可见文字速度或网络 TTFT。CLI 不切换前台窗口。
- 新任务不会自动开启一个已暂停的队列。`queue start`／`resume` 仍受额度与空闲检查约束。`queue pause` 等当前轮次结束；`queue stop CHAT_ID TASK_ID` 才请求中断指定执行中任务，之后查询状态确认。
- 提示词优先通过 UTF-8 文件或 stdin 传入，避免 shell 展开。重试添加任务时复用原 request ID；去重在任务仍保留期间有效。遇到超时先查状态，其他修改不要盲目重放；revision 冲突后重新读取队列。
