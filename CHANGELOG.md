# Changes

## 0.11.0 — 2026-10-16

- Open the menu below the status icon toward the right, with screen-edge clamping and outside-click/Escape dismissal.
- Replace a hovered chat row with the shared dual-handle budget slider and explicit Apply/Cancel controls.
- Preserve draft revisions and advanced reserves, freeze row ordering during editing, and report queued or blocked application states.

## 0.10.0 — 2026-10-16

- Rename the visible app to Context Manager and replace the menu-bar text with a robot inside a live usage ring.
- Show running chats first in a compact menu, with usage rings and numbers on the right, followed by recent chats.
- Open a chat’s settings directly from its menu row; retain unknown/stale usage states and use observed capacity for percentages.

## 0.9.1 — 2026-10-16

- Recover saved parent budgets for native desktop forks that bypass the bridge fork RPC; queue application automatically at a safe turn boundary.
- Preserve explicit child settings and disabled policies; use the actual fork parent, not the history-storage ancestor.
- Keep native window controls clear of sidebar chrome; replace the sidebar heading with a compact connection light.
- Refresh untouched slider drafts when an inherited policy arrives.

## 0.9.0 — 2026-10-16

- Add an optional, disabled-by-default early-compaction fix switch in the native sidebar.
- Select an independently installed, pinned Codex 0.160.0 runtime on the next launch, with integrity checks and version-mismatch fallback.
- Distinguish saved preference from active runtime; disabling takes effect on the next launch.
- Provide reproducible Apple Silicon builds and offline validation for the community reasoning-accounting patch.

## 0.8.1 — 2026-10-16

- Use Standard base rates for all panel cost estimates, with no Fast surcharge or price comparison.
- Preserve actual response configurations and display names as `GPT-6 Astra · High · Fast`.
- Keep window and compaction details in the expanded response metadata.

## 0.4.0 — 2026-10-16

- Automatically show a menu-bar entry when Codex connects, with connection status and a settings shortcut.
- Keep the entry available after closing the settings window; background attachment does not open or focus a window.
- Detect an existing entry by its canonical executable path and avoid reopening it on reconnect.
- Recover window confirmation when a model switch clears the bridge expectation but a fresh matching report is available.
- Add an isolated native UI test for automatic appearance and reconnect behavior.

## 0.3.0 — 2026-10-16

- Enter usable context capacity directly; automatically invert the model's usable percentage.
- Set compaction as a percentage of usable capacity, with linked previews and 80/85/90% presets.
- Keep ratio selection when changing window presets; move reserve and retained-floor inputs to advanced settings.
- Show usable targets and compression ratios in Hook stats; retain legacy raw-policy compatibility.
- Verify exact runtime readback, native/controller arithmetic parity, integer limits and service reconnection during generation.

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
