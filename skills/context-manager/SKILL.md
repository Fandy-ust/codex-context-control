---
name: context-manager
description: "Plan and manage your working context to complete long or context-heavy tasks well. Proactively assess retained evidence, remaining work, expected context growth and response speed; use Context Manager to inspect headroom, adjust budgets or hand off at a safe turn boundary. Invoke at meaningful planning checkpoints, after compaction, or when your own task assessment suggests context pressure or a performance bottleneck; no explicit user request is needed. Also handles requested context tuning, task queues and quotas."
---

# Context Manager

Use this as a planning capability while doing the user's task. Own the decision about when to inspect context, what information is worth keeping, and whether to continue, change your approach, expand capacity or prepare a handoff. Optimize the whole task's quality, elapsed time, continuity and rework cost. Do not wait for the user to diagnose a context problem or request a command.

The skill supplies decision guidance; it is not a background monitor. Your task assessment initiates occasional checks. The local CLI supplies bounded observations, preflight checks and execution receipts; it cannot judge which evidence the task still needs. Combine both. A hunch that the task has grown, details are becoming hard to reconcile, or responses are slowing is a reason to inspect, not a measurement of context occupancy or model attention.

## Keep a lightweight context plan

At a meaningful planning point, consider:

- **Continuity:** the goal, user constraints and preferences, unresolved hypotheses, important decisions, and evidence needed by the next stage. Separate detail that must remain available from material recoverable through precise file/source references.
- **Work ahead:** the next useful checkpoint, remaining complexity, likely input/tool-output growth, and room for reasoning, a response and a checkpoint. Forecast a rough range with uncertainty, not an exact token count or the whole task's cumulative billed tokens.
- **Capacity and timing:** the latest loaded budget, earliest applicable compaction/capacity boundary, observation freshness and any saved change that has not loaded. Plan against the loaded state.
- **Decision and next check:** continue, narrow retrieval/output, stage the work, adjust capacity, or consolidate at a checkpoint. Revisit when an upcoming action or new evidence could change that choice.

Keep this in the ordinary task plan or checkpoint when it helps continuity; do not create a separate report or persistent file for every task. A short, comfortable task can proceed without a CLI call. For substantial work, inspect at the start of a context-heavy phase when there is no useful recent observation. After a major batch of reads/tool results, a change of phase, an unexpected slowdown, or compaction, decide whether another check would change your next action. Reuse a still-relevant observation instead of checking every message or on a timer.

After compaction or a handoff, reconstruct the goal, constraints, decisions and remaining work from the retained summary and task artifacts. A summary is not a verbatim copy of earlier user messages. Retrieve the relevant original messages or authoritative files when a missing detail affects the next decision; do not reread the entire history by default. Check the current budget once before substantial new context growth when the previous observation may no longer apply. Expanding a window does not restore content already removed by compaction.

## Observe only what can inform the decision

Start with `chat show current --summary`. Inspect loaded versus requested budgets, estimated headroom, freshness, model limits, available actions and pending operations. Use full `chat show` only for missing detail. If speed matters, use `chat speed current --summary`; it returns recent/baseline samples without full context tokenization. Request full statistics only when the extra detail could change the plan. Prefer cached reads; avoid routine `--refresh`, repeated model-list downloads, extra Codex servers or monitoring loops.

Compare the likely growth until the next safe checkpoint with the room to the **earliest loaded compaction or capacity boundary**, allowing for output/reasoning and uncertainty. Account for large tool results before reading them. Treat stale or unavailable estimates as unknown; reduce the next read or use a conservative checkpoint rather than assuming zero usage. If accounting is unknown, the loaded capacity exceeds the reported real ceiling, or the compaction boundary is missing, do not present the resulting headroom as verified usable space. Use bounded work and resolve that uncertainty before a large stage. The controller's accounting overhead is already handled separately; do not add it again to real headroom. Use `chat preflight` to validate a concrete proposed budget, not a universal occupancy percentage or fixed K-sized preset.

Distinguish observed values, your forecast and unknowns. An occasional useful update might be: “The remaining review depends on these earlier decisions. I expect the next batch to add roughly X–Y tokens, so I'll limit the read to the relevant sections and check again before the full comparison.” Only supply numbers when you have a basis; a qualitative estimate is better than invented precision. Report when this changes the plan or explains a tradeoff, not as a recurring status ritual.

## Choose a policy and an action

Default to **quality-first**, using speed as supporting evidence. Policies guide your judgment; they are not CLI modes or fixed window sizes. Adapt to the task phase and the user's expressed priorities while preserving explicit limits.

| Policy | What to optimize and when to change course |
| --- | --- |
| Quality-first | Keep decision-critical evidence and continuity. Favor justified expansion when the next phase still needs detailed history. Consolidate once a phase is complete and its essentials can be preserved. |
| Balanced | Weigh continuity, elapsed time and avoidable growth. Prefer focused retrieval and staged work; expand or consolidate when that improves completion of the task. |
| Speed-first | Seek a useful result sooner. Diagnose tool waits, repeated work and generation speed; narrow inputs/output or stage deliverables. Consider consolidation if history is dispensable, or offer model/effort alternatives with their tradeoffs. |

Choose the least disruptive action that supports the next phase. More capacity is useful when relevant context needs room to grow; raising a maximum alone neither improves quality nor makes generation faster. Lowering a maximum does not remove existing history. A single slow response does not prove context is the cause: compare available samples under the same model, effort, tier and response kind, and include tool latency and rework in the task-level assessment. Do not oscillate budgets after each sample.

Continue when the work fits. Improve retrieval/output discipline when avoidable growth is the problem. Expand within agreed bounds when valuable history and the next phase need room. Consider compaction at a meaningful checkpoint when completed detail is recoverable; first preserve essential constraints, decisions, source references and next steps. Native compaction chooses the replacement history: `--floor` is a numeric preflight constraint, not a way to pin text or guarantee lossless retention.

## Own routine decisions; involve the user for real tradeoffs

You may inspect, forecast, narrow reads and improve the execution plan on your own. Within the task's authorization and agreed adjustment range, choose and apply useful budget changes with a brief notice and verify their receipts; do not interview before every action. If an adjustment range has not been established, propose one concrete change when needed rather than turning every task into a setup interview.

Seek the user's judgment when important history could be discarded, the quality/cost tradeoff is material, a model/tier change is proposed, or the action exceeds agreed scope. “This is too slow” is evidence to reassess and offer alternatives, not blanket permission to change spending, models or retained history. Existing answers persist; do not request the same choice again.

- **Comfortable room:** keep progressing. Discuss optional tuning asynchronously when useful, without pausing work solely for it.
- **The next stage may exhaust the loaded room:** anticipate this before large reads or extended work. Explain the relevant evidence, recommendation and tradeoff while there is still time to choose.
- **The next step risks compaction and a necessary decision is unresolved:** preserve a checkpoint, ask a focused question and end this turn at a safe point. Await the real reply; do not arrange automatic continuation past the unanswered decision.

Interaction helps resolve meaningful choices; it is not the trigger for your awareness. Never treat silence as agreement. Recommend a fork/new chat only when it benefits the task and create it only when authorized.

## CLI entry point

- macOS: `"$HOME/Library/Application Support/CodexContextControl/bin/context-manager"`
- Windows PowerShell: `& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd"`
- From source: `node src/cli.mjs` in the user's designated repository.

Start with `--help`; use `queue --help` and `queue schema` for installed capabilities and input fields. If the entry point is missing, explain that the extension needs to be installed. Do not substitute direct edits to its state files.

`skill path` locates the bundled skill. When asked to install or update it, use `skill install`; `--path` selects another agent's skills parent directory.

## Resolve the current chat

For “this chat”, use `chat show current --summary`: `current` resolves `CODEX_THREAD_ID` and verifies it against the controller. If unavailable, resolve the target with `chat list` and use its explicit ID. Listing reads 20 lightweight native-index entries; use `chat list --offset 20` (then 40, etc.) when an older target is needed. Normal state reads focus on recent chats plus active, pending and explicitly selected work. A missing row in that hot snapshot does not mean the chat was deleted; `chat show CHAT_ID` loads it on demand. Do not assume the first or most active chat is the current chat. Keep changes scoped to the requested chat; changing global defaults or other chats requires that scope to be authorized.

### Decide between soft adjustment and a turn-boundary handoff

Use the plan and latest observation to select the execution path below. Read again only if the observation is no longer sufficient for this decision.

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

Use speed evidence proactively when it can improve your task plan. A read-only speed investigation does not by itself expand mutation authority; apply the agreed scope and interaction rules above. After a change, compare subsequent work at a useful checkpoint rather than assuming the intervention helped.

## Results and retries

Success is JSON on stdout: `{schemaVersion:1,ok:true,data:...}`. Errors use stderr, `{schemaVersion:1,ok:false,error:{code,message}}`, and a nonzero exit code.

Pass prompts as UTF-8 files or stdin to avoid shell expansion. Reuse the same request ID when retrying an add; deduplication lasts while that task is retained. After a timeout, inspect the operation receipt or list the target chat's operations before retrying. Reuse the same request ID; request-ID conflicts require a new decision rather than changing the request body under the same ID. For structured errors, follow `nextAction` and `operationId` when present; `outcome_unknown` must not trigger blind resubmission. On revision conflicts, read the latest state instead of replaying a stale change. Operate within the user's requested or already-authorized scope.
