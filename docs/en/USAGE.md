# Use Context Manager

**English** | [简体中文](../USAGE.md) · [Home](../../README.md)

## Open the panel

Click the quota icon in the Mac menu bar or Windows system tray. Running chats come first, followed by recent chats ordered by actual starts and completions. A completed chat can remain available after its runtime unloads it. Temporary and managed agent sessions are excluded.

Hover over a chat to reveal its budget slider, or click it to open the main window. Chat names retain their original text in both UI languages.

## Language

Open Settings from the sidebar header and use **Language**:

- **Automatic (time zone):** Chinese for mainland China, Hong Kong, Macao, and Taiwan zone identifiers; English elsewhere.
- **中文:** always use Chinese.
- **English:** always use English.

The choice is saved locally and applies immediately. Automatic mode responds to system time-zone changes. It checks identifiers rather than offsets, so UTC+8 alone does not imply Chinese. The installer uses the same preference. No restart or account permission is needed for a language change.

## Adjust a chat budget

The two handles control **Compact at** and **Context window**. Adjust in 1K steps, or select a handle and use arrow keys. Moving the context handle preserves the linked compaction proportion within supported limits. The gray span is headroom.

Use **Preflight** to inspect whether the change is safe, then **Apply to this chat**. Changes normally apply between turns. A smaller threshold can require compaction first; retained content cannot be guaranteed to shrink to a particular size.

**Actual window** is the last runtime observation. A saved target can differ until a later normal request confirms it. A stale observation is labeled; saving a target does not fabricate confirmation.

**Stop auto-apply** stops future automatic budget application and preserves the runtime’s present window.

## Global defaults and forks

**Global defaults** affect future user-created chats. Existing chats keep independent settings. Forks inherit the parent budget at creation instead of receiving the current global default. Temporary and agent-managed sessions do not receive these defaults.

## Extra features

**Extend context** permits the local 920K ceiling and compaction by 904K. Without it, each model’s native capacity applies. Switching the mode of an already-running core requires restarting Codex. Re-enabling extension restores previous larger budgets unless you explicitly edited them while extension was off.

**Early compaction fix** chooses a separate, verified patched runtime to avoid historical reasoning being counted twice under the supported protocol conditions. It is independently switchable and requires an optional runtime package. New installations leave it off.

## Context details

The details window shows latest recorded input occupancy, cache hits, and an API cost estimate. Cache reads are part of input, not extra occupancy. Cache writes are estimated where they are not reported. Cost uses Standard API rates even when the model label says Fast; it is not a subscription bill.

The aligned trend charts show generation speed, input/cache, and conversation events. Hover over a plot or its horizontal axis to inspect an interval; click to pin it. Expand original records for per-response values and model configuration. Blue means final replies, green means user input or steering, and purple marks compaction.

The overview has bounded interval counts. Smoothing affects trends only; it does not change usage or cost. Missing measurements stay missing, and recorded cache zeros remain distinguishable.

**Native compaction…** requests Codex’s own compaction. It can use model allowance. Wait for completion and a later usage observation before treating capacity as confirmed.
