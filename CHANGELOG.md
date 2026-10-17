# Changes


## 0.18.0 — Account quota ring and floating control panel

- Consolidate sidebar settings in a bottom-left floating control panel, including inline navigation to global defaults.
- Add a separate monochrome quota ring beside the context ring in the macOS menu bar.
- Show actual remaining percentages and reset times; render two concentric rings only when two windows are available.
- Show extra-credit availability separately from periodic quota percentages.
- Support multiple usage pools without inventing missing values; unavailable and stale observations are labeled.
- Read quotas through the official runtime without opening chats or generating model output. Cache for five minutes and offer manual refresh.


## 0.17.2 — Complete OTA cleanup

- Retry delayed macOS disk-image detach operations before deleting downloaded files.
- Record interrupted cleanup and retry after startup; never recursively remove a mounted installer volume.
- Includes 0.17.1 upgrade inheritance, single configuration snapshot, and obsolete runtime cleanup.


## 0.17.1 — Upgrade inheritance and runtime cleanup

- Preserve existing and unknown settings fields across upgrades; keep one lightweight pre-upgrade configuration snapshot without copying runtimes or chat caches. Same-version reinstalls do not duplicate snapshots.
- Preserve newer state schema versions instead of silently downgrading their version marker.
- Replace app/code as before; now remove unused older bundled Node binaries and their obsolete licenses after a successful install.
- Remove the disabled legacy patched core when no process is using it.
- Defer in-use runtime cleanup until processes exit; retry at startup and every five minutes.
- Preserve budgets, language, chat caches, user backups, unknown files, and symlink targets.


## 0.17.0 — Local chat cache and click-to-install updates

- Discover local chats at startup without the 30-chat discovery limit; restore last usage from a persistent, bounded-tail cache.
- Skip unchanged files and read appended records only; refresh in the background or with Sync local chats.
- Show cached chats separately from live connections; preserve live readback and compaction safeguards.
- Check GitHub for updates automatically every six hours. Download and install only after an explicit click, verifying checksums and native installer payload integrity.
- Preserve budgets, language, and caches during updates. Keep the official Codex runtime and 920K support.


## 0.16.2 — Forward-compatible 920K and lightweight distribution

- Remove app-name and runtime-version allowlists; retain runtime identity checks and per-chat window readback.
- Enable 920K with the native 0.163.0-alpha.10.2 runtime; verify compaction guards, native/extended transitions, defaults, and forks using local integration fixtures.
- Recognize prerelease runtime versions without selecting a patched runtime.
- Disable the optional early-compaction runtime fix, including previously enabled preferences. The early-compaction fix is disabled because it replaces the Codex core with a modified binary lacking the official Codex signing identity, which can prevent Computer Use from working. The 920K extension only changes configuration and keeps the official runtime.
- Ship a DMG with only the o200k tokenizer dictionary, preserving standalone installation.

## 0.16.0 — 2026-10-17

- Add English and Chinese UI across the menu bar, main settings, context details, charts, runtime notices, hooks, and installer.
- Add a saved Automatic / Chinese / English preference; automatic selection uses named China, Hong Kong, Macao, and Taiwan time zones, with English elsewhere. Manual selection takes precedence.
- Refresh native menus and chart presentation after language or timezone changes without changing budgets or user-authored names.
- Add linked English and Chinese READMEs, English usage/development guides, and shared localization documentation.
- Adopt the MIT license as selected by the owner; retain third-party licenses and notices.

## 0.15.6 — 2026-10-17

- Keep a statistics-only event projection in the bounded parser cache; omit duplicated tool-completion bodies, encrypted reasoning payloads and image data while preserving accounting fields and event ordinals.
- Budget the parser cache by retained projected data, allowing large active histories to stay incremental without increasing its limit.
- Add equivalence tests across timing, pricing, compaction, steering, images, rollback and fork boundaries.
- Add a repeatable isolated append benchmark and 160-request multi-chat cache rotation/recovery test.
- Retry a helper version-probe timeout once during installation; distinguish persistent timeouts from incompatible versions.

## 0.15.5 — 2026-10-17

- Prevent malformed IPC envelopes from terminating the service and bound frames before a newline arrives.
- Fix event-only chart aggregation creating empty buckets and crashing on uneven record counts.
- Select native metadata databases by numeric schema version.
- Reuse statistics after parsed-history cache eviction by checking source file and index dependencies.
- Avoid cloning unchanged worker results and reserializing unchanged HTTP statistics.
- Retry transient runtime version checks instead of permanently caching an unavailable runtime.
- Pause the MAX gradient when its main panel is inactive or its control is disabled.
- Add regression coverage for corrupt frames, uneven event counts, cache eviction and repeated abrupt service restarts.

## 0.15.4 — 2026-10-17

- Apply the new app icon to the app bundle and installer; match the menu-bar glyph to its ring and three bars while preserving live usage.
- Give app icon resources content-based names to avoid stale icon cache entries.
- Reject packaging a prebuilt panel from a different version.
- Explicitly isolate the details view to the UI actor for the macOS CI toolchain.
- Consolidate download, installation, update and release-status documentation.

## 0.15.3 — 2026-10-16

- Fix horizontal-axis hover being ignored and stale highlights remaining after pointer exit.
- Cache chart scale mapping, coalesce pointer bursts to display-rate updates, and render crosshairs independently from detail selection.
- Preformat bucket summaries off the UI thread; construct raw-record rows only when expanded.
- Give chart interaction priority over automatic data refresh and apply deferred results after pointer exit.

## 0.15.1 — 2026-10-16

- Sort chats by real activity rather than the time a bridge snapshot was received; running chats lead, then recent starts/completions.
- Backfill activity from native recency and turn timestamps without reading message bodies; record lifecycle timestamps on new bridge connections.
- Keep recently completed user chats in the menu after unload or disconnect, while excluding temporary and managed sessions.
- Preserve stable tie ordering and existing hover/drag row freezing.

## 0.15.0 — 2026-10-16

- Schedule UI refreshes according to visibility and activity, with immediate wake-up when opened and bounded service-recovery attempts.
- Coalesce observation persistence while retaining synchronous budget/config writes; improve statistics worker affinity and release idle workers earlier.
- Add an Apple Silicon GUI installer with a pinned, checksummed Node runtime and precompiled panel; no end-user developer tools required.
- Install runtime binaries under immutable paths and replace application/code directories only after complete staging.
- Add package-integrity and empty-PATH installation tests, private artifact workflow, and signing/notarization documentation.

## 0.14.1 — 2026-10-16

- Fix extension off/on permanently shrinking 920K budgets to 828.4K. Restore pre-disable values unless explicitly edited while native mode was active.
- Refresh untouched menu drafts after restored policies arrive; distinguish draft targets from actual/last observed windows.
- Preserve legacy native-budget percentages on first extension activation and tolerate malformed RPC/input shapes without crashing the bridge.
- Add offline load, mode-fuzz, backpressure, recovery, native UI and chart interaction stress coverage.

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
