# Agent queue CLI

The CLI uses the same authenticated local queue service as the UI. Quota guards, task permissions, serial scheduling and context compensation remain in force. Adding a task does not start the queue; `start` enables monitoring and scheduling after the normal checks.

The installer provides a launcher using bundled Node without changing PATH:

- macOS: `~/Library/Application Support/CodexContextControl/bin/context-manager`
- Windows: `%LOCALAPPDATA%\CodexContextControl\bin\context-manager.cmd`
- Source checkout: `node src/cli.mjs queue ...`

Use `queue --help` for commands and `queue schema` for defaults and request fields. Discover chat IDs with `queue chats` and models with `queue models`.

```sh
CM="$HOME/Library/Application Support/CodexContextControl/bin/context-manager"
"$CM" queue add CHAT_ID --prompt-file task.txt --request-id agent-run-001
"$CM" queue show CHAT_ID
"$CM" queue start CHAT_ID
"$CM" queue pause CHAT_ID
```

Use UTF-8 prompt files or stdin (`--prompt-file -`) to preserve literal text. `--settings-file` accepts the same model, effort, approval, attachment and quota settings as the UI; approval defaults to `inherit`.

`pause` stops later dispatch and lets the current turn finish. `stop CHAT_ID TASK_ID` requests interruption of the specified running task; inspect status afterward. `pause-cycle` waits until the next quota reset. Tasks can be edited, deleted, retried or reordered. `config` and `task-config` accept complete quota configuration via `--input`. `pause-all` pauses all queues. `queue command --input request.json` (or `--input -`) accepts the raw actions listed by `queue schema`.

Success is JSON on stdout: `{schemaVersion:1,ok:true,data}`. Failure is JSON on stderr: `{schemaVersion:1,ok:false,error:{code,message}}` and a nonzero exit. Connection credentials are never returned.

Mutations read the latest revision unless `--revision N` is supplied. Conflicts are not retried. For reliable add retries, retain and reuse `--request-id`: matching content is deduplicated while that task remains stored, including across service restarts; different content with the same ID is rejected. If omitted, an ID is generated and returned on success. After a timeout, inspect state before retrying any other mutation.

Input files are limited to 64 KiB; task text is limited to 16,000 characters. See the [Chinese guide](../QUEUE_CLI.md) for complete command examples.
