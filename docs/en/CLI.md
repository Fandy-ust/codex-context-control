# Context Manager CLI and skill

Context Manager is a local Codex extension for context control and quota-aware task queues. Its CLI and desktop panel share one controller on both platforms. It supports global status/quota analysis, new-chat defaults, per-chat context budgets, observed speed analysis and task queues. Context sizes are user-visible tokens; the controller owns conversion and validation. Speed is read-only: no model/tier switching or fixed tokens/s control.

See [queue CLI](QUEUE_CLI.md) for installed launcher paths. From source, run `node src/cli.mjs --help`.

```sh
context-manager global status
context-manager global quota
context-manager global defaults-set --window 400K --compact 360K
context-manager chat list
context-manager chat show current --summary
context-manager chat preflight CHAT_ID --window 500K --compact 450K
context-manager chat set CHAT_ID --window 500K --compact 450K
context-manager chat speed current --limit 20 --summary
context-manager queue --help
```

Use the full launcher path if it is not on PATH. Defaults affect future new chats; forks inherit their parent. `chat set --save-only` saves without requesting application, and `--revision` prevents stale writes. Saving, queuing and runtime confirmation are distinct states. `chat compact` explicitly requests native compaction; `chat stop-auto` preserves the current runtime window while stopping subsequent automatic budget application.

Speed results group recorded generation throughput by model, effort, service tier and response kind. Aggregate throughput is total output tokens divided by observed generation duration. Missing timing remains null. Output can include reasoning, and the metric is not network TTFT or visible-text speed.

## Agent workflow

`current` validates `CODEX_THREAD_ID`; it never guesses the foreground chat. Use an explicit ID when unavailable. Start with `chat show current --summary` for requested/loaded budgets, observation validity, estimated headroom, capabilities and recent receipts. Use task-specific judgment to interpret the measurements.

Preflight returns `budgetValid`, `evidence`, `execution`, `basis.policyRevision` and `registered:false`; checking a proposal never registers it. Discuss the tradeoff, then apply using `--revision N` from that basis. Reuse a stable `--request-id ID` for the same budget change or compaction request. Inspect `chat operations current` or `chat operation current OPERATION_ID` after uncertain responses; structured errors expose `code`, `nextAction` and an operation ID when available.

After agreement, `chat compact current --when-idle --request-id CONFIRMED_ID` registers one compaction bound to the exact current turn, model, budget and history branch. End the turn at a safe checkpoint rather than polling yourself. Requests expire after 15 minutes and cancel or become superseded on interruption, relevant changes or disconnect. Cancel an unstarted compaction with `chat cancel current OPERATION_ID`. It does not interrupt a turn or send a continuation message; a service restart does not replay uncertain operations. Inspect capabilities: older bridges require a normal Codex restart.

Accepted, waiting, executing, awaiting readback and completed/confirmed are distinct. Budget confirmation uses the next normal request's window readback. Receipts are bounded to 200 entries. Speed summaries compare available samples with matching configurations and keep insufficient baselines unknown; they reuse existing workers without full context tokenization, another Codex server or model-list downloads.

The skill defaults to quality-first, supports balanced and speed-first preferences and revisits tradeoffs when the user reports slowness. It continues safe work with comfortable headroom and yields only when an unresolved choice risks compaction during the next stage.

## Install the skill

The [context-manager skill](../../skills/context-manager/SKILL.md) lives in this GitHub repository and ships with both installers. Written in English, it guides an agent to control context budgets and schedule queues around 5-hour and weekly quota windows through the extension's CLI. Speed remains read-only analysis.

After installing the extension, run once:

**macOS**

```sh
"$HOME/Library/Application Support/CodexContextControl/bin/context-manager" skill install
```

**Windows PowerShell**

```powershell
& "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd" skill install
```

The default is `~/.codex/skills/context-manager`, or `$CODEX_HOME/skills/context-manager` when configured. Reopen Codex and invoke `$context-manager`, or ask it to use Context Manager in natural language.

Run the same command after extension updates to update the skill. It replaces unmodified managed `SKILL.md` content, preserves unrelated files and stops if you edited the skill; `--force` explicitly replaces local edits. Installing the extension alone does not modify any agent's skills.

For another agent supporting `SKILL.md`, choose its skills parent directory with `skill install --path "/path/to/agent/skills"`. `skill path` locates the bundled copy. Alternatively copy the repository's `skills/context-manager` folder into the agent's skills directory; the extension and its CLI are still required.
