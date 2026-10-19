# Context Manager CLI and skill

The CLI shares the app's controller on both platforms. It supports global status/quota analysis, new-chat defaults, per-chat context budgets, observed speed analysis and task queues. Context sizes are user-visible tokens; the controller owns conversion and validation. Speed is read-only: no model/tier switching or fixed tokens/s control.

See [queue CLI](QUEUE_CLI.md) for installed launcher paths. From source, run `node src/cli.mjs --help`.

```sh
context-manager global status
context-manager global quota
context-manager global defaults-set --window 400K --compact 360K
context-manager chat list
context-manager chat preflight CHAT_ID --window 500K --compact 450K
context-manager chat set CHAT_ID --window 500K --compact 450K
context-manager chat speed CHAT_ID --limit 20
context-manager queue --help
```

Use the full launcher path if it is not on PATH. Defaults affect future new chats; forks inherit their parent. `chat set --save-only` saves without requesting application, and `--revision` prevents stale writes. Saving, queuing and runtime confirmation are distinct states. `chat compact` explicitly requests native compaction; `chat stop-auto` preserves the current runtime window while stopping subsequent automatic budget application.

Speed results group recorded generation throughput by model, effort, service tier and response kind. Aggregate throughput is total output tokens divided by observed generation duration. Missing timing remains null. Output can include reasoning, and the metric is not network TTFT or visible-text speed.

The bundled [context-manager skill](../../skills/context-manager/SKILL.md) describes the app and its CLI. `skill path` locates it in the installation. Copy that folder into the agent's skills directory (normally `~/.codex/skills` for Codex) and invoke `$context-manager` or allow automatic discovery. The skill respects the requested scope and queue guards.
