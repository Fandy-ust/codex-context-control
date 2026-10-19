# Context Manager CLI 与配套 skill

CLI 与 Mac／Windows 界面使用同一个控制服务。它可以读全局状态、改新聊天默认预算、调节单聊天上下文、分析速度，以及管理队列。窗口以用户可用容量输入，由 App 换算和应用；速度是只读分析，不提供快慢模式切换。

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
"$CM" chat show CHAT_ID
"$CM" chat preflight CHAT_ID --window 500K --compact 450K
"$CM" chat set CHAT_ID --window 500K --compact 450K
"$CM" chat speed CHAT_ID --limit 20
"$CM" chat stats CHAT_ID
```

- `global defaults-set` 只影响后续新聊天，已有聊天不批量变更，fork 沿用父聊天预算。
- `chat set` 默认请求应用；`--save-only` 只保存。`--revision` 可携带已有快照，发生冲突不会自动覆盖。窗口、压缩阈值、预留量和保留下限均由共享核心校验。
- `chat compact` 请求原生压缩；`chat stop-auto` 停止后续自动应用，保留当前运行时窗口。这些是操作命令，不会在查询统计时自动调用。
- `chat speed` 只使用已有观测，按模型、思考程度、服务档位和响应类型分组，汇总用输出 token 总量除以观测生成时长。缺少时间戳时返回 `null`。输出 token 可能包含推理，不等于可见文字速度或网络首包时间。
- 额度／用量和统计查询支持各自帮助中列出的 `--refresh`。不请求改模型、改服务档位或切换前台 App 窗口。
- 新命令统一输出 JSON，错误退出码非零。保存、排队和读回确认分开报告；补偿后的运行时窗口与 App 中的目标容量可能不同。

## 配套 skill

[context-manager skill](../skills/context-manager/SKILL.md) 与源码一起维护在 GitHub，并随两端安装包分发。它教 agent 通过 CLI 查询额度、调整上下文和管理队列；速度只用于分析。

安装 App 后，执行一次：

**macOS**

```sh
"$HOME/Library/Application Support/CodexContextControl/bin/context-manager" skill install
```

**Windows PowerShell**

```powershell
& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd" skill install
```

默认安装到 `~/.codex/skills/context-manager`；设置了 `CODEX_HOME` 时使用其下的 `skills/context-manager`。重新打开 Codex 后可直接说“用 Context Manager 调整这个聊天的上下文”，或显式调用 `$context-manager`。

App 更新后重新运行同一命令即可更新 skill。安装器仅替换自己管理且未经修改的 `SKILL.md`，保留其他文件；本地内容被修改时会停止，确认要覆盖后可加 `--force`。App 安装过程不会自动改动 agent 的 skills。

其他支持 `SKILL.md` 的 agent 可指定 skills 父目录：`context-manager skill install --path "/path/to/agent/skills"`。`skill path` 返回 App 内置副本的位置。从 GitHub 手动安装时，把 `skills/context-manager` 文件夹放入 agent 的 skills 目录即可；仍需安装带 CLI 的 Context Manager。
