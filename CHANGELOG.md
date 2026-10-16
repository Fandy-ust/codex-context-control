# Changes

## 0.14.0 — 2026-10-16

- Add an independent context-extension toggle with off, waiting-for-Codex, pending-restart and active states, plus in-app explanation and repository documentation.
- Remove the misleading 920K activation banner when no Codex connection exists.
- Restore per-model native slider limits when disabled, including global defaults; preserve smaller budgets and clamp oversized ones without changing the running engine in place.
- Keep global defaults and fork inheritance working in native mode; fresh installs default off and upgrades preserve the previously enabled extension.

## 0.13.0 — 2026-10-16

- Add global defaults for newly created user chats with K-precision sliders and a copy-from-current-chat action.
- Read and inject a frozen default budget before thread creation, then persist it independently for that chat.
- Keep forks on parent inheritance, existing chats on their saved budgets, and temporary/managed sessions outside global-default application.
- Report when a running desktop bridge still needs the one-time upgrade restart; subsequent default changes apply without restarting.

## 0.12.1 — 2026-10-16

- Fix desktop startup config precedence: consolidate caller overrides after the app-server subcommand, then append the 920K catalog settings.
- Reproduce the real desktop argument shape in native integration tests and verify resolved configuration plus the 920K token-usage event.
- Identify older connections that missed the catalog, require restart before budget changes, and preserve converted budget display for unloaded chats.

## 0.12.0 — 2026-10-16

- Add a 920K local input ceiling across models through a separate startup catalog; preserve existing visible budgets during migration.
- Limit total-mode auto-compaction to 904K, compact at turn completion, and guard large next inputs before forwarding. Failed or insufficient compaction holds the request.
- Show a purple animated progress bar in MAX CONTEXT mode, with a hard slider endpoint and reduced-motion support; keep window and card backgrounds unchanged.
- Keep old runtime connections on their original metadata until restart; do not claim the extension is already active.
- Wait for automatic startup registration to finish before returning, so its delayed job cannot overwrite a subsequent external setting.

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
