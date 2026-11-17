# Experimental context reminders

Open **Settings → Experimental → Context reminders during work** on Windows or
macOS. The switch is off by default. Enabling installs owned `UserPromptSubmit`,
`PostToolUse` and `PostCompact` command hooks in the selected Codex home's
`hooks.json`. The feature switch alone does not enable any chat. Use **Manage
context automatically** below the budget controls to opt in each chat, or
enable **Manage context automatically for all chats** in Experimental settings.
The all-chats mode defaults to off. It covers existing and new eligible chats,
including forks, with per-chat opt-outs. Turning it off restores individual
opt-ins. Turning the feature switch off pauses all reminders and preserves
choices. Review and trust these hooks in Codex Settings → Hooks (or `/hooks`
in the CLI), then reopen the target session if it has already loaded its hooks.
The manager never writes hook trust records. Merely enabling the switch is not
proof of delivery: Settings distinguishes waiting for a hook from receiving one.

**Context management debug notifications** is off by default. When enabled,
the running desktop app can display a system notification for each emitted
reminder (including token-growth updates), accepted CLI expansion request, or
accepted CLI compaction request. A request notification does not indicate the
runtime has applied the budget or completed compaction. Status checks,
preflight, saved-only budgets, replayed request IDs, and suppressed reminders
do not send notifications. Delivery follows OS notification preferences.

Use **Log** next to the chat's automatic management switch to see its recent
status injections and requests. The local log retains the latest 500 events
across chats and shows up to 50 for the selected chat. It records times, trigger
and token counts, and links to current operation receipts when available. Full
Planner entries include the configured, rendered Planner text (up to 16,000
characters) and distinguish returned payloads from context acknowledged by the
native bridge. User messages, tool output, and conversation contents are not
logged. Turning
system notifications off does not stop logging.

Expand **Experiment parameters** under this feature to edit the English prompt,
context status template and five frequency controls. Preview renders unsaved
drafts against the selected chat's available observations without enabling hooks
or sending anything to a model. Restore defaults changes the draft; press Save
experiment parameters to persist. Saving is permitted while the feature is off,
does not rewrite hook definitions and takes effect on the next hook invocation.
Revision conflicts preserve the draft instead of overwriting newer settings.

Templates and prompts support the placeholders listed in the editor. Numeric
fields such as `{context_tokens}` use readable separators. Their `_raw` variants
produce unformatted numbers or `null` and can be used in JSON templates, for
example `{"used":{context_tokens_raw},"room":{headroom_tokens_raw}}`. Unknown text
fields display `unknown`. Substitution is literal text; no template code or shell
commands are evaluated. Each editable text field is limited to 12,000 characters.
Custom prompts can replace the default 100K guidance for controlled experiments.
The preview includes both the status box and the full English prompt. In live
use the full prompt is sent at the first eligible hook after enabling, on
manual submission and after compaction. Later tool updates and Context Manager
scheduled handoffs send status only. Enabling during work can therefore deliver
the full prompt on the next supported tool completion without starting a turn. A manual
submission is the start boundary; the hook does not infer task changes from text.
Use Restore defaults and Save to adopt the new defaults over a saved custom configuration.

The command hook reads the opt-in preference on every invocation. Disabling
removes only this feature's handlers and makes hooks held by existing sessions
return empty JSON. External hooks and the existing Stop hook are preserved.
Upgrades retarget opted-in hooks to the installed code; changed hooks need the
normal Codex trust review again. Without opt-in, startup installs no reminder
hooks. Uninstall removes them on both platforms.

Each hook makes one bounded local IPC request to the already-running controller.
It does not start a daemon, send a model request, change a budget, compact history,
interrupt work or register a continuation. It forwards event identifiers, not
prompts, tool results or transcript contents. Unavailable services, malformed or
oversized input and errors return `{}`; there is a 1.5-second process deadline
and a 700 ms IPC timeout. This is a synchronous informational hook, so a small
local process/IPC overhead remains even when no reminder is emitted.

Within a chat/turn, parallel tool completions are coalesced. A reminder is emitted
at the first supported event, prompt submission, and after compaction. Subsequent
tool completions emit after a pressure/budget change (at least 5 seconds apart),
or after 30 seconds and 6 calls / 20K observed growth, or after 2 minutes. These
are initial experimental defaults, not a claim of optimal model performance.
The controller retains at most 128 chat entries and 64 recent tool IDs per chat.

Messages report the latest estimate, loaded capacity/threshold, reserved room
and a separately labelled unconfirmed target, plus the existing Context Manager
CLI controls. Only a fresh, timestamped runtime observation can supply numeric
headroom. New tool output is not assumed to be counted. After compaction, earlier
usage cannot supply headroom until a new usage event arrives. Unknown stays
unknown; cumulative billed tokens are never used as context occupancy. The
notices reinforce the original task and acceptance criteria rather than adding
general planning work.

The English adjustment guidance defaults to keeping the loaded budget. It asks
for fresh occupancy evidence and expected growth through a concrete checkpoint
before any change. Without explicit user authorization, each increase is at most
100K. Increases must not be chained to stockpile capacity. Finish and
deliver when the remaining work fits. Existing larger user-selected budgets are
not automatically shrunk. These are model instructions, not hard controller
limits on manual settings, and cannot guarantee model compliance.

This does not reproduce a request-only message appended to every internal model
request: hook context can enter retained history and consumes context. Hosted
search and some specialized tools bypass local tool hooks. Native
`PreModelRequest` is diagnostic and cannot inject model context. There is no
network interception or `turn/steer` fallback in this release. With hooks disabled,
the existing CLI/skill remains available for on-demand context management.

The installed runtime must support these hook events and `additionalContext`.
See the [official hook contracts](https://learn.chatgpt.com/docs/hooks).
The settings API is `POST /context-reminders` with `{ "enabled": true|false }`,
`{ "action": "set-chat", "id": "chat-id", "enabled": true|false }`,
`{ "action": "set-all-chats", "enabled": true|false }`,
`{ "action": "defaults" }`, `{ "action": "preview", "config": {...}, "id": "optional-chat-id" }`
or `{ "action": "configure", "config": {...}, "expectedRevision": N }`;
`GET /state` exposes `contextReminders` with enabled/phase, last hook/reminder
times, count and configuration errors. A received hook is execution evidence,
not proof of model attention or efficiency gains.
