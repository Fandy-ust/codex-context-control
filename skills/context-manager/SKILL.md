---
name: context-manager
description: "Control Codex context budgets and quota-aware task queues through the installed Context Manager extension. Use for per-chat or global context settings, quota checks, queue scheduling, and response-speed analysis; not for editing source code or generic Codex configuration."
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

```text
queue add CHAT_ID --prompt-file task.txt --request-id UNIQUE_ID
queue start CHAT_ID
queue pause CHAT_ID
queue pause-cycle CHAT_ID
```

Use `queue config` or `queue task-config` with `--input config.json` to set 5-hour and weekly reserves, optional release stages near a reset, and automatic or manual resumption. Read `queue schema` for the current format. Task settings, including model, effort, inherited permissions, and attachments, can be supplied through `--settings-file`.

Adding a task does not start a paused queue. Start/resume remains subject to quota, connection, idle-state, and context checks. `queue pause` stops later dispatches; `queue stop CHAT_ID TASK_ID` requests interruption of the specified running task. Query again to confirm the result. The controller owns scheduling and quota protection.

## Speed and statistics

Use `chat speed CHAT_ID --limit 20` or `chat stats CHAT_ID` for recorded generation throughput. These are read-only analysis commands. Missing measurements stay `null`; output counts can include reasoning. Do not turn a speed-analysis request into model or service-tier changes. The CLI does not switch foreground windows.

## Results and retries

Success is JSON on stdout: `{schemaVersion:1,ok:true,data:...}`. Errors use stderr, `{schemaVersion:1,ok:false,error:{code,message}}`, and a nonzero exit code.

Pass prompts as UTF-8 files or stdin to avoid shell expansion. Reuse the same request ID when retrying an add; deduplication lasts while that task is retained. After a timeout, inspect state before retrying other mutations. On revision conflicts, read the latest state instead of replaying a stale change. Operate within the user's requested or already-authorized scope.
