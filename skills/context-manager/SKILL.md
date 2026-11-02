---
name: context-manager
description: "Manage Codex context budgets, compaction, response-speed tradeoffs, one-shot task handoffs, task queues and quota monitoring through Context Manager. Use when users request context or speed adjustments, long work approaches compaction, or queues and quotas need management. Assess the task and discuss tradeoffs before adjusting; not for generic Codex configuration."
---

# Context Manager

Context Manager is a local extension for Codex. Its menu bar or system tray panel and CLI share the same local controller. Use the task's needs, local measurements and the user's preferences to manage context interactively; the controller owns runtime validation and execution.

## CLI entry point

- macOS: `"$HOME/Library/Application Support/CodexContextControl/bin/context-manager"`
- Windows PowerShell: `& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd"`
- From source: `node src/cli.mjs` in the user's designated repository.

Start with `--help`; use `queue --help` and `queue schema` for installed capabilities and input fields. If the entry point is missing, explain that the extension needs to be installed. Do not substitute direct edits to its state files.

`skill path` locates the bundled skill. When asked to install or update it, use `skill install`; `--path` selects another agent's skills parent directory.

## Context control

For “this chat”, use `chat show current --summary`: `current` resolves `CODEX_THREAD_ID` and verifies it against the controller. If unavailable, resolve the target with `chat list` and use its explicit ID. Listing reads 20 lightweight native-index entries; use `chat list --offset 20` (then 40, etc.) when an older target is needed. Normal state reads focus on recent chats plus active, pending and explicitly selected work. A missing row in that hot snapshot does not mean the chat was deleted; `chat show CHAT_ID` loads it on demand. Do not assume the first or most active chat is the current chat. Keep changes scoped to the requested chat; changing global defaults or other chats requires that scope to be authorized.

Own the task's progression: proactively assess context value, remaining work and bottlenecks, then choose whether to continue, optimize or hand off. User feedback refines that judgment; it is not the only trigger. Within the authorized task and agreed bounds, make useful low-disruption adjustments with a brief explanation. Interview the user when a meaningful quality, cost or history-retention tradeoff remains unresolved.

### Choose a working policy

Default to **quality-first** unless the user has expressed another preference. These are agent decision policies, not CLI options or fixed token presets:

| Policy | Priorities and likely choices |
| --- | --- |
| Quality-first | Preserve relevant evidence and reasoning continuity. Favor a justified expansion when the next stage still depends on detailed history; consider compaction at a meaningful checkpoint. |
| Balanced | Weigh continuity against elapsed time and avoidable context growth. Consolidate completed work and keep room for the next stage. |
| Speed-first | Favor a useful result sooner. Reduce unnecessary output, repeated searches and serial tool work; consider context reduction when history is dispensable, or suggest model/effort alternatives when relevant. |

Treat “this is too slow” as a reason to reassess and offer alternatives, not as permission to silently change models, service tier, spend or discard history. The user's latest preference takes precedence over the default. A policy may change with the task phase; preserve explicit user limits and previously agreed adjustment ranges.

### Assess at useful checkpoints

Assess when the user requests it, before a context-heavy stage, near the anticipated compaction boundary, or when task requirements or observed performance change materially. When space is comfortable and work is progressing, continue without a recurring interview or status report.

Start with `chat show current --summary` (or an explicit ID): inspect the requested and loaded budgets, observation freshness, estimated headroom, model limits, available actions and operation receipts. Use full `chat show` only for additional detail. Get speed/statistics only when they would change the decision; use cached reads and avoid routine `--refresh` or tight polling. `chat speed current --summary` provides a bounded numerical report without full context tokenization; missing or insufficient comparable samples stay unknown. Do not launch another Codex server, fetch model lists repeatedly or add a monitoring loop to support this skill.

Combine these observations with your understanding of the visible working context:

- Which user constraints, unresolved hypotheses, decisions and evidence must survive? Which material can be recovered from files or another authoritative source?
- What remains until the next meaningful checkpoint, and how much new context might inputs, tool results and responses add? Estimate a range with uncertainty; cumulative billed tokens across requests are not context growth.
- Will the remaining room accommodate that stage, a response reserve and uncertainty? Use the controller's preflight rather than a universal percentage or a fixed K-sized window.
- Is delay coming from recorded generation throughput, tool waits, repeated work or a difficult task? State what the available evidence cannot distinguish.

Do not claim access to hidden context, an exact future token count or a measurement of the model's attention. A larger configured window alone does not establish higher actual usage. Before proposed compaction, identify the critical state and, when useful, preserve a concise checkpoint with source references and next steps in an appropriate task artifact. Native compaction controls the replacement history; `--floor` is a numeric preflight constraint, not a way to pin specific text or guarantee lossless retention.

### Keep adjustment interactive

Explain a proposed change briefly: the observed situation, the task-specific reason, the preferred action and its tradeoff. Offer a small number of meaningful choices when the user's preference is unresolved. Use an available asynchronous question/interview facility and continue independent, safe work while awaiting the reply. Do not interpret silence as agreement or ask again for a choice already authorized.

- **Comfortable headroom:** continue working. If an adjustment would be useful, discuss it without pausing solely to wait for optional tuning.
- **A stage may exhaust the remaining room:** raise the choice before reading large inputs or starting that stage. “Near compaction” depends on anticipated growth and uncertainty, not only the current occupancy percentage.
- **The next step risks compaction and the necessary decision is unresolved:** preserve a checkpoint, explain why waiting is necessary, and end the current turn at a safe point for the user's decision. Do not interrupt your own runtime, pause unrelated queues or enqueue yourself to simulate this pause.

Execute adjustments within the user's current answer or an already agreed range, with brief notice. Recommendations can include expansion, compaction at a checkpoint, narrower retrieval, a staged deliverable, or a model/effort tradeoff. Recommend a new chat or fork only when useful; do not create one without authorization. Speed improvements are hypotheses to assess against subsequent comparable work, not promises.

### Decide between soft adjustment and a turn-boundary handoff

First explore with `chat show current --summary`; compare **loaded** headroom with the estimated work until the next safe checkpoint. Use task complexity, evidence that must survive, expected tool-output growth and speed samples where relevant. The agent owns this decision within agreed limits. Explain consequential tradeoffs and interview the user if needed.

| Decision | Tool use | Expected response and next action |
| --- | --- | --- |
| Continue normally | Read summary only | No mutation or scheduled message. Continue the task. |
| Soft adjustment | Preflight, then `chat set current ... --revision N --request-id ID` | A budget receipt may be `waiting_for_idle`/`accepted`. Continue only work that fits the **currently loaded** budget. End naturally; the change loads at a safe boundary. No automatic message is registered; the next real user message or authorized task starts the next turn. |
| Urgent handoff | Save a checkpoint, register agreed context operations, then `chat schedule current ... --after-operation OPERATION_ID` | `nextAction: "finish_turn"`, `agentInstruction`, readiness and a schedule receipt. Briefly explain the handoff, send a final response and **end this turn**. The app waits for its exact completion and readiness, then submits one checkpoint message to this same chat. |
| Necessary user decision pending | Ask/interview; if remaining room is unsafe, checkpoint and end | Wait for the user's answer. Do not register an automatic continuation that could bypass the decision. |

Why a turn boundary matters: a shell command or synchronous/async interview reply can add context to the current turn, but does not by itself reload that turn's context-window configuration. Neither a saved budget nor a pending receipt protects the current turn with a larger window. "Pause" here means finish the current agent turn, not kill Codex, block in a sleep/wait tool, or leave a synchronous question holding the turn open. The app's wake-up is a new same-chat message/turn, not a restart of the desktop app or process.

An accepted urgent handoff returns fields like:

```json
{"nextAction":"finish_turn","agentInstruction":"请保存交接进展并结束当前轮次，等待下一条消息。…","schedule":{"state":"waiting_for_turn","sourceCompleted":false},"readiness":{"quotaValid":true,"quotaBlocked":false,"quotaSource":"credits"}}
```

Values are illustrative: quota can be unknown or blocked. Registration is not execution. An already completed/replayed receipt returns `inspect_schedule`; it is not an instruction to stop again. If registration fails, no wake-up is promised. Near exhaustion, checkpoint and end for the user's next message instead of spending the remaining room retrying.

After an app-generated checkpoint arrives, inspect the schedule once and compare its `turnId`/`executionId` with `chat show current`. Verify loaded budget/readback before continuing substantial work. Resume the saved task, honoring any newer user direction. A running receipt becomes completed only after that continuation ends; do not poll yourself waiting for completion. Never create a chain of new handoffs merely to test this flow. A real user message before dispatch cancels the pending automatic message, so the real input takes precedence.

### Schedule a one-shot continuation when yielding

When the unfinished task needs a new context budget or an agreed compaction before its next stage, you can arrange a handoff through the existing scheduler instead of requiring the user to type “continue”. This starts a new turn in the same chat and runtime; it does not restart ChatGPT or create another Codex server.

1. Save a concise UTF-8 checkpoint: original goal and acceptance criteria, user constraints, completed work, source/file references, remaining work and the next concrete step. Keep it within the task's existing authorization and at most 16000 characters.
2. Register any agreed budget change or idle compaction first. Then use `chat schedule current --prompt-file CHECKPOINT_FILE --request-id STABLE_ID`; add `--after-operation OPERATION_ID` to depend on that action. `--revision N` checks the current saved budget revision (use the new revision returned by `chat set`, not its earlier preflight revision).
3. Inspect the response's `context`, `readiness`, `schedule` and `nextAction`. It reports estimated room and whether quota is known or blocked; registration alone does not guarantee execution or change the active window. Announce the chosen handoff briefly and end the current turn at a safe checkpoint. Do not poll waiting for yourself to become idle or keep working through a projected compaction boundary.

The app waits for that exact turn to complete, the target budget to load, any explicit dependency to finish and fresh quota. A one-shot handoff can continue with a fresh, identified positive or unlimited extra-Credits observation; the existing Credits-stop trigger still applies. Ordinary queues retain their percentage reserves. Inspect readiness.quotaSource and quotaReason rather than treating a zero percentage as proof the account cannot continue. Budget `awaiting_readback` can proceed once loaded: the continuation itself provides normal usage readback. Each accepted handoff submits its prompt at most once; uncertain delivery is not automatically retried. Up to 50 handoff receipts are retained, with request-ID deduplication while retained; use unique stable IDs and inspect rather than resubmitting an old uncertain request. Ordinary queue switches and other pending tasks are preserved.

Use `chat schedules current` to inspect metadata or `chat schedule-cancel current SCHEDULE_ID` to cancel an unstarted handoff. New user input (including an interview answer), interruption, context/model/budget changes, disconnection, expiry after 15 minutes, or service restart invalidate waiting intent. Already started work follows Codex's normal Stop/steering controls. Global or per-chat queue pause cancels waiting handoffs. Check `capabilities.scheduleAfterTurn`; an older bridge requires a normal Codex restart. Never work around missing support by spawning a second runtime.

If you are yielding because a necessary user decision is still pending, leave automatic continuation unscheduled. Comfortable headroom is a reason to keep progressing, not to manufacture turn boundaries. When your plan or the user's direction changes after registration, inspect/cancel the handoff rather than leaving an unwanted wakeup behind.

### Execute and verify using installed capabilities

- `chat preflight CHAT_ID --window 400K --compact 360K` checks a proposed budget.
- `chat set CHAT_ID --window 400K --compact 360K` saves and requests application. `--save-only` saves without applying; `--revision N` protects an earlier snapshot. Reuse a stable `--request-id ID` for retries of the same intended change.
- Inspect `global defaults`, then use `global defaults-set --window 400K --compact 360K` to change defaults for future chats. Existing chats keep their own budgets; forks inherit their parent's budget.
- `chat compact CHAT_ID --request-id ID` requests native compaction for an idle chat. After agreement, use `--when-idle` for a one-shot request bound to the current turn, model, budget revision and history branch. It expires after 15 minutes and cancels on interruption, relevant state changes or disconnect; it does not resume work or send a message.
- `chat operations CHAT_ID` lists receipts; `chat operation CHAT_ID OPERATION_ID` inspects one. `chat cancel CHAT_ID OPERATION_ID` cancels a compaction request that has not started. Executing compaction cannot be undone; a newer budget supersedes a previous budget request.
- `chat stop-auto CHAT_ID` stops further automatic budget application while preserving the current runtime window.

Window values mean usable context capacity, capped by native model limits or 920K when the extension is enabled. At safe boundaries the controller calculates retained historical-reasoning estimates before loading window and compaction settings together. The accounting block separates this extra local estimate and larger runtime counters from the real loaded target and headroom. Do not add accounting overhead to the requested real capacity or interpret the larger counter as additional usable context. Estimates are not actual reasoning usage or a guarantee against mid-turn compaction. Older connections need a normal restart for capabilities.reasoningBudget; no additional runtime is needed.

An active turn's window change queues until that turn ends; `waiting_for_idle` does not mean the new budget is already protecting the running turn. For your own active chat, register any agreed deferred action and finish at a safe checkpoint. Do not poll waiting for yourself to become idle or retry compaction. Check `agentCapabilities`/summary `capabilities` before using new features; an older connected runtime may require a normal Codex restart for deferred compaction. No command hot-reloads the active turn.

Before changing a budget, use `chat preflight`: `budgetValid`, `evidence` and `execution` distinguish a feasible budget from one that can execute now. `registered:false` means this read-only check did not queue anything. Carry `basis.policyRevision` into `chat set --revision N` when applying a proposal discussed with the user; reread and reconsider on a conflict. After a change, inspect the returned operation receipt and the requested/loaded revisions in `chat show`. Saved, queued, loaded awaiting readback, and confirmed are distinct states; an old `observedWindow` does not confirm a new revision. An operation accepted by the service is not yet completed. Report pending application honestly and verify on the next opportunity before context-heavy work. Native compaction acceptance is not completion; inspect the resulting status and fresh usage when available. Never send a throwaway message to obtain usage, repeatedly retry an uncertain mutation, or promise that increasing the window reverses completed compaction.

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

Use `chat speed CHAT_ID --limit 20 --summary` for recorded generation throughput and comparable recent/baseline samples; request `chat stats CHAT_ID` when context growth, cache records or the full timeline would help. These commands reuse bounded local statistics workers and are read-only; avoid repeated analysis for routine decisions. The CLI does not switch foreground windows.

Compare several available samples under the same model, effort, service tier and response kind, excluding compaction from normal-generation comparisons. Missing measurements stay `null`; output counts can include reasoning. Generation tokens/s is not time to first visible token or end-to-end task duration. A single slow response is insufficient to attribute delay to context size; cached input is still context, not free capacity.

A request to analyze speed does not authorize configuration changes. When the user wants faster work, explain relevant alternatives and their quality, cost or continuity tradeoffs through the interactive process above. After an authorized change, reassess at a useful checkpoint and keep the user's preference open to revision; avoid oscillating budgets after each sample.

## Results and retries

Success is JSON on stdout: `{schemaVersion:1,ok:true,data:...}`. Errors use stderr, `{schemaVersion:1,ok:false,error:{code,message}}`, and a nonzero exit code.

Pass prompts as UTF-8 files or stdin to avoid shell expansion. Reuse the same request ID when retrying an add; deduplication lasts while that task is retained. After a timeout, inspect the operation receipt or list the target chat's operations before retrying. Reuse the same request ID; request-ID conflicts require a new decision rather than changing the request body under the same ID. For structured errors, follow `nextAction` and `operationId` when present; `outcome_unknown` must not trigger blind resubmission. On revision conflicts, read the latest state instead of replaying a stale change. Operate within the user's requested or already-authorized scope.
