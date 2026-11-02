# Context Manager CLI 与配套 skill

Context Manager 是 Codex 的本地扩展，提供上下文控制和按额度调度的任务队列。CLI 与 Mac／Windows 面板使用同一个控制服务。它可以读全局状态、改新聊天默认预算、调节单聊天上下文、分析速度，以及管理队列。窗口以用户可用容量输入，由扩展换算和应用；速度是只读分析，不提供快慢模式切换。

安装后入口及队列详细用法见 [队列 CLI](QUEUE_CLI.md)。从源码可运行 `node src/cli.mjs`。

```sh
CM="$HOME/Library/Application Support/CodexContextControl/bin/context-manager"
"$CM" --help
"$CM" global status
"$CM" global quota
"$CM" global usage --days 28
"$CM" global defaults
"$CM" global defaults-set --window 400K --compact 360K
"$CM" chat list
"$CM" chat show current --summary
"$CM" chat preflight CHAT_ID --window 500K --compact 450K
"$CM" chat set CHAT_ID --window 500K --compact 450K
"$CM" chat speed current --limit 20 --summary
"$CM" chat stats CHAT_ID
```

- `global defaults-set` 只影响后续新聊天，已有聊天不批量变更，fork 沿用父聊天预算。
- `chat set` 默认请求应用；`--save-only` 只保存。`--revision` 可携带已有快照，发生冲突不会自动覆盖。窗口、压缩阈值、预留量和保留下限均由共享核心校验。
- `chat compact` 请求原生压缩；`chat stop-auto` 停止后续自动应用，保留当前运行时窗口。这些是操作命令，不会在查询统计时自动调用。
- `chat speed` 只使用已有观测，按模型、思考程度、服务档位和响应类型分组，汇总用输出 token 总量除以观测生成时长。缺少时间戳时返回 `null`。输出 token 可能包含推理，不等于可见文字速度或网络首包时间。
- 额度／用量和统计查询支持各自帮助中列出的 `--refresh`。不请求改模型、改服务档位或切换前台 App 窗口。
- 新命令统一输出 JSON，错误退出码非零。保存、排队和读回确认分开报告；补偿后的运行时窗口与 App 中的目标容量可能不同。

## 面向 agent 的交互流程

`current` 读取并验证 `CODEX_THREAD_ID`；无法确定时返回错误，不猜测前台聊天。其他环境使用明确的聊天 ID。

1. 用 `chat show current --summary` 查看已请求／已加载预算、观测有效性、估算余量、可用动作和近期操作。结合任务内容判断，不把未知用量当作零。
2. 用 `chat preflight current --window 500K --compact 450K` 检查提议。`budgetValid`、`evidence`、`execution` 分别说明预算是否可行、证据是否充分、何时能执行；`registered:false` 表示没有登记操作。与用户协商后，用 `basis.policyRevision` 作为 `chat set --revision N` 的依据。
3. 修改预算和请求压缩时提供稳定的 `--request-id ID`。超时后用 `chat operations current` 或 `chat operation current OPERATION_ID` 查看原操作，避免重复执行。错误中的 `code`、`nextAction`、`operationId` 提供恢复信息。
4. 用户确认后，可用 `chat compact current --when-idle --request-id CONFIRMED_ID` 登记一次空闲后压缩；agent 在安全位置结束本轮即可，不需要自己轮询等待。请求绑定本轮、模型、预算和历史分支，15 分钟未执行即过期；中断、相关状态变化或断线会使其取消或失效。尚未执行时可用 `chat cancel current OPERATION_ID` 取消。

操作已接受、等待空闲、执行中、等待读回和已完成分别报告。压缩不自动发送续聊消息；重启服务不重放未确定的操作。最多保留 200 条操作记录，预算确认需要后续正常请求的窗口读回。旧的已接入运行时需正常重开 Codex 才支持延后压缩；检查摘要的 `capabilities`。

速度摘要使用同模型、思考程度、服务档位及响应类型的近期／基线样本；基线不足时变化率为 `null`。读取复用已有统计工作线程，不做完整上下文 token 化，不额外启动 Codex server 或下载模型列表。默认质量优先，用户嫌慢时重新讨论取舍；空间充足时继续工作，下一阶段存在压缩风险且决策未定时再暂停协商。

## 配套 skill

[context-manager skill](../skills/context-manager/SKILL.md) 与源码一起维护在 GitHub，并随两端安装包分发。技能使用英文编写，引导 agent 通过 CLI 控制上下文、管理队列，并围绕 5 小时和每周额度设置保留量、暂停与恢复策略。速度只用于分析。

安装扩展后，执行一次：

**macOS**

```sh
"$HOME/Library/Application Support/CodexContextControl/bin/context-manager" skill install
```

**Windows PowerShell**

```powershell
& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd" skill install
```

默认安装到 `~/.codex/skills/context-manager`；设置了 `CODEX_HOME` 时使用其下的 `skills/context-manager`。重新打开 Codex 后可直接说“用 Context Manager 调整这个聊天的上下文”，或显式调用 `$context-manager`。

扩展更新后重新运行同一命令即可更新 skill。安装器仅替换自己管理且未经修改的 `SKILL.md`，保留其他文件；本地内容被修改时会停止，确认要覆盖后可加 `--force`。扩展安装过程不会自动改动 agent 的 skills。

其他支持 `SKILL.md` 的 agent 可指定 skills 父目录：`context-manager skill install --path "/path/to/agent/skills"`。`skill path` 返回 扩展内置副本的位置。从 GitHub 手动安装时，把 `skills/context-manager` 文件夹放入 agent 的 skills 目录即可；仍需安装带 CLI 的 Context Manager。
