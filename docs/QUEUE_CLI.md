# 队列 CLI：供 agent 和脚本使用

CLI 连接和界面相同的本地队列服务，沿用额度保护、模型／权限设置、串行执行和上下文补偿。添加任务不会自动开启监视；`start` 才请求开始执行。暂停不会强行中断当前轮次。

## 入口

安装／更新后自带运行环境，无需额外安装 Node，不修改系统 PATH。

macOS：

```sh
CM="$HOME/Library/Application Support/CodexContextControl/bin/context-manager"
"$CM" queue --help
"$CM" queue chats
```

Windows PowerShell：

```powershell
$cm = "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd"
& $cm queue --help
& $cm queue chats
```

从源码运行：`node src/cli.mjs queue ...`。`doctor` 输出中也会列出已安装 CLI 的路径。

## Agent 工作流

先用 `queue chats` 获取聊天 ID，用 `queue models` 查看可用模型。提示词建议写入 UTF-8 文件，避免 shell 把反引号、美元符号或换行当成命令。

```sh
"$CM" queue add CHAT_ID --prompt-file task.txt --request-id agent-run-001
"$CM" queue show CHAT_ID
"$CM" queue start CHAT_ID
"$CM" queue pause CHAT_ID
```

- `add`：加入任务，权限默认沿用聊天。`--settings-file settings.json` 可设置 `model`、`effort`、`approval`、`attachments` 和 `quota`，规则与界面一致。
- `start` / `resume`：开启队列监视，仍需通过额度、连接、空闲及预算检查，不保证立即执行。
- `pause`：停止后续派发，当前轮次继续；`pause-cycle` 暂停到下一次额度重置。
- `stop CHAT_ID TASK_ID`：请求中断指定的执行中任务；CLI 返回表示请求已受理，随后查询状态确认完成。
- `edit` / `delete` / `retry`：修改、删除或重新排队指定任务。执行中的任务不能编辑或删除。
- `config` / `task-config`：更新队列默认额度或指定任务的额度设置，`--input` 读取完整配置 JSON。
- `reorder`：`--input` 读取完整任务 ID 数组。`pause-all` 停止全部队列的后续派发。

`queue schema` 返回默认配置和字段说明。所有输入也可通过单个 JSON 命令表达：

```sh
"$CM" queue command --input request.json
```

```json
{
  "action": "add",
  "id": "CHAT_ID",
  "prompt": "实现功能并运行相关测试。",
  "requestId": "agent-run-002",
  "settings": {"approval": "inherit"}
}
```

`--input -` 或 `--prompt-file -` 从 stdin 读取，适合其他程序直接传入数据。每个输入文件上限 64 KiB，任务文本上限 16,000 字符。

## 输出与重试

成功输出到 stdout：`{"schemaVersion":1,"ok":true,"data":...}`。失败输出到 stderr：`{"schemaVersion":1,"ok":false,"error":{"code":"...","message":"..."}}`，退出码非零。认证令牌不出现在输出中。

修改操作默认先读取当前 revision；也可用 `--revision N` 携带之前的快照。发生冲突时刷新状态，不自动重放修改。

添加任务时，agent 应生成并保留 `--request-id`。同一聊天中重复提交同一 ID 和内容会返回现有队列，不重复加入；同一 ID 用于不同内容会被拒绝。该去重在任务仍保留期间有效，服务重启后也保留。省略时 CLI 生成一个 ID 并在成功结果中返回。

请求超时可能意味着服务端已接受修改。先查询队列；添加任务可复用原 request ID 重试，其余操作先核对状态。CLI 不会在网络错误后盲目重试。
