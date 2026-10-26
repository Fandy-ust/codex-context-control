---
name: context-manager
description: "Manage Codex chat task queues, quota monitoring, context budgets and recorded response speed through Context Manager. Use to add or reorder a chat's tasks, start/pause monitoring, adjust quota reserves or inspect reset times; not for source-code editing or generic Codex configuration."
---

# Context Manager

Context Manager is a local extension for Codex. It adds context controls and task queues that keep work moving across 5-hour and weekly quota windows. Its menu bar or system tray panel and CLI share the same local controller.

## CLI entry point

- macOS: `"$HOME/Library/Application Support/CodexContextControl/bin/context-manager"`
- Windows PowerShell: `& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd"`
- From source: `node src/cli.mjs` in the user's designated repository.

Start with `--help`; use `queue --help` and `queue schema` for installed capabilities and input fields. If the entry point is missing, explain that the extension needs to be installed. Do not substitute direct edits to its state files.

`skill path` locates the bundled skill. When asked to install or update it, use `skill install`; `--path` selects another agent's skills parent directory.

## Context control

Find the chat ID with `chat list`, then inspect `chat show CHAT_ID`. Use the requested scope; resolve ambiguous chat names before changing anything.

- `chat preflight CHAT_ID --window 400K --compact 360K` checks a proposed budget.
- `chat set CHAT_ID --window 400K --compact 360K` saves and requests application. `--save-only` saves without applying; `--revision N` protects an earlier snapshot.
- Inspect `global defaults`, then use `global defaults-set --window 400K --compact 360K` to change defaults for future chats. Existing chats keep their own budgets; forks inherit their parent's budget.
- `chat compact CHAT_ID` requests native compaction when wanted.
- `chat stop-auto CHAT_ID` stops further automatic budget application while preserving the current runtime window.

Window values mean usable context capacity. The controller handles model limits and runtime conversion. With compaction compensation enabled, Codex may report a larger runtime window than the target budget.

After a change, inspect `phase`, `expectedWindow`, `observedWindow`, and `compensation` in `chat show`. Saved, queued, and confirmed are distinct states.

## Queue work around quota windows

Read `global quota` and `queue show CHAT_ID` before adjusting the queue. Use `global usage` for consumption history and `global status` for extension state.

Resolve the requested chat with `queue chats` or `chat list`, then `chat show CHAT_ID`. For “this chat”, prefer a known current thread ID (for example `CODEX_THREAD_ID`) and verify it against the controller. Do not assume the first or most recently active chat is the foreground chat. Ask only when the target remains ambiguous.

```text
queue add CHAT_ID --prompt-file task.txt --request-id UNIQUE_ID
queue start CHAT_ID
queue pause CHAT_ID
queue pause-cycle CHAT_ID
queue monitoring-off
queue monitoring-on
```

`queue monitoring-off/on` controls the global quota monitor while preserving per-chat switches and reserves. `queue pause-all` disables every chat's switch. Neither is a request to interrupt a live turn. Use `queue stop CHAT_ID TASK_ID` when the user asks to stop the running task, then inspect its status.

`queue account-switch-on/off` controls automatic account switching for quota-paused queues. Enable it only when the user requests automatic switching: it can close and reopen Codex once all managed chats are idle. It uses saved local logins and fresh candidate quotas, preserves task order and quota reserves, and verifies the new account before dispatch. It does not override manual pauses, interrupt unrelated chats or replay uncertain submissions. Old runtimes require reopening Codex. Inspect `queue list` → `accountSwitch` for progress or a reason it is waiting.

Cloud sync can include encrypted account display names/emails, Credits and quota/reset snapshots from another device's signed-in account. A cloud badge denotes cached remote observations. Those snapshots are display data, not proof of current quota or authorization to switch; sign-in credentials remain local.

To add work, put the full task and acceptance criteria in a UTF-8 prompt file; supply a stable request ID. Add multiple tasks separately in the requested order. Omit model and effort overrides by default: empty values follow the target chat's current model and observed reasoning effort at dispatch; missing effort falls back to `medium` (not `median`). Explicit user choices take precedence. Inspect `queue models` before specifying a model or effort it may not support. Keep inherited permissions unless the user requests a change.

Use `queue config` or `queue task-config` with `--input config.json` to set 5-hour and weekly reserves, optional release stages near a reset, and automatic or manual resumption. Read `queue schema` for the current format. Task settings, including model, effort, inherited permissions, and attachments, can be supplied through `--settings-file`.

Adding a task does not start a paused queue. Start/resume remains subject to quota, connection, idle-state, and context checks. `queue pause` stops later dispatches; `queue stop CHAT_ID TASK_ID` requests interruption of the specified running task. Query again to confirm the result. The controller owns scheduling and quota protection.

To reorder tasks, read the latest queue and send the **complete** task-ID array (including retained history) to `queue reorder CHAT_ID --input order.json`. Preserve the running task's position and every other task's settings and attachments. Use the snapshot's revision; reread on conflict. The UI also supports dragging task cards.

Quota monitoring defaults to 20% five-hour and 10% weekly reserves; read the actual saved configuration instead of resetting existing settings. `global quota --refresh` shows observed balances and reset timestamps; cached data from an inactive account is not a live measurement.

The updated queue runtime automatically requests native compaction when context blocks a pending task, then checks the new usage before sending the original prompt once. It does not treat a compaction request as completion. If compression fails or no fresh usage arrives, inspect `chat show` and the task error; do not repeatedly add copies or blindly retry. When manually requested, `chat compact CHAT_ID` compresses the idle chat. Existing failed tasks require `queue retry CHAT_ID TASK_ID` and, if paused, `queue resume CHAT_ID`.

Confirmed task failures and quota waits can retry at cumulative minutes 1, 3, 5, 10, 15, 30, 45 and 60 after the first failure. The controller persists this schedule, checks quota and idle state, skips missed slots without bursts, and preserves task order. `retryEnabled` defaults to true; set it false in task/default quota config to disable it. Automatic resumption must also be enabled. Manual stops, unknown submission outcomes and exhausted retries require inspection and explicit manual handling; do not create duplicate tasks or reset the retry clock.

## Speed and statistics

Use `chat speed CHAT_ID --limit 20` or `chat stats CHAT_ID` for recorded generation throughput. These are read-only analysis commands. Missing measurements stay `null`; output counts can include reasoning. Do not turn a speed-analysis request into model or service-tier changes. The CLI does not switch foreground windows.

## Results and retries

Success is JSON on stdout: `{schemaVersion:1,ok:true,data:...}`. Errors use stderr, `{schemaVersion:1,ok:false,error:{code,message}}`, and a nonzero exit code.

Pass prompts as UTF-8 files or stdin to avoid shell expansion. Reuse the same request ID when retrying an add; deduplication lasts while that task is retained. After a timeout, inspect state before retrying other mutations. On revision conflicts, read the latest state instead of replaying a stale change. Operate within the user's requested or already-authorized scope.
