# Changes

## 0.2.0 — 2026-10-15

- Register automatic desktop attachment so the original Codex icon remains the daily entry point.
- Start control services on demand without opening the settings panel or a dedicated launcher.
- Preserve the normal macOS application launch chain and retire the Node-based desktop launcher.
- Restore owned startup settings on removal and preserve external edits.
- Test ordinary Launch Services environment inheritance with an isolated, permission-free probe app.
- Show the saved window budget, effective percentage and expected capacity together.
- Label previous runtime readbacks as pending until the new budget is confirmed.
- Clarify that compaction settings specify a usage threshold rather than window capacity.

## 0.1.0 — 2026-10-15

- Native macOS control panel and dedicated Codex launcher.
- Per-chat window and total-scope compaction settings.
- Idle-boundary single-thread reload with transparent RPC forwarding.
- Runtime-window confirmation, explicit unknown and stale states.
- Local metadata-only persistence and authenticated loopback controls.
- Stop hook output that coexists with existing hooks.
- Reversible installation and verified runtime compatibility gates.
