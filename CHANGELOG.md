# Changes

## 0.25.0 — Real-budget compensation and update identity

- Recognize a running installation-owned Windows UI even when the install pointer has moved to a different version, so upgrades can close it before launching the replacement.
- Reject same-version, older and malformed offers again at the Windows prompt; use the native Mac bundle version for displayed versions and update eligibility.
- Separate the local accounting catalog from real context budgets so historical-reasoning compensation works near the configured capacity, with real-usage compaction at turn boundaries.
- Keep usage, capacity and rings based on the original budget on both desktops. Preserve the official Codex executable, existing settings and cloud-sync data.
- Verify an installed Windows controller from its recorded daemon script and bundled Node executable when Windows does not expose the process command line. Continue refusing to stop unidentified processes.

## 0.24.3 — Use the installed app version for update checks

- Run update discovery and verified installation from the desktop app, using its own product version as the authority. A stale or newer background controller can no longer offer the UI's current version as an update.
- Store desktop and controller update caches separately to prevent version races. Recheck against the desktop version immediately before installing on Windows and macOS.
- Keep the controller's own background update checks for service maintenance; its cached status no longer controls the desktop prompt or update button.

## 0.24.2 — Accounts and devices in cloud sync

- Identify Codex accounts automatically and keep each account's local and synced history separate, including after login or plan changes.
- Discover accounts and named devices through an encrypted directory. Share one private repository and sync key across accounts and devices.
- Choose current, all, or selected accounts, select devices for cost/token totals, and pause sync independently per account. Selections are local; unchecking preserves cached history.
- Preserve account-specific import caches and attribute requests using observed login periods. Unassigned older records remain available through an explicit display option.
- Windows and macOS share the same controls and accounting rules. Existing 0.24.1 numeric manifests remain readable; update all devices to 0.24.2 to discover accounts across devices.

## 0.24.1 — Copy saved cloud credentials and start sync directly

- Keep saved Token and key visibly masked and marked Saved on both platforms; dedicated copy buttons work after saving and reopening settings. Credentials remain in DPAPI / Keychain and are retrieved only on explicit copy.
- Remove the 16-character minimum for nonempty sync keys.
- Make Enable and sync / Save and sync available before the enabled setting has been saved, fixing the grey Mac sync button. Refresh account quota before syncing and verify credential writes by reading them back.

## 0.24.0 — Encrypted multi-device sync and persistent quota monitoring

- Add private repository / Secret Gist cloud sync to both desktop settings, with OS-protected credentials, encrypted numeric records, account isolation, response deduplication and configurable intervals. See [setup](docs/en/CLOUD_SYNC.md).
- Keep per-chat quota monitoring active after queues finish, protect later manual turns and add a global monitoring switch.
- Fix compensation action routing and Cloud sync tab navigation; preserve sidebar selection position and add scroll-edge blur, model/effort event lanes and response timestamps.

## 0.23.5 — Compaction compensation after interruption and message edits

- Recognize interrupted turns as persisted terminal events, so continuing after a pause can reserve historical reasoning overhead before applying a smaller context budget.
- Resolve inherited history by immutable rollout ID after message edits, including repeated edits of the same chat. Preserve byte and ordinal boundaries, reject ambiguous files and cycles, and reuse bounded history caches.
- Mark older running Codex bridges as needing a restart to load these compensation fixes.
- Validate the pause/shrink/continue path against the unmodified runtime with local mock responses, alongside history and cache regressions. Shared fixes apply to macOS and Windows.

## 0.23.4 — English extension skill and tighter sidebar spacing

- Place the sidebar scrollbar close to the divider instead of leaving a wide unused strip.
- Rewrite the bundled skill in English and describe Context Manager as a local Codex extension for context control and quota-aware task queues.
- Explain reserves, release stages and pause/resume scheduling around 5-hour and weekly quota windows, with the existing CLI entry points and installation method.
- Align English/Chinese introductions and CLI guides with this positioning.

## 0.23.3 — Stable slim sidebar scrolling

- Keep a fixed narrow scrollbar gutter on both platforms, with a thin grey track and thumb that do not widen or flash white during interaction. Expanding Recent no longer changes the content width.
- Use thinner white outlines for project and Recent icons. Preserve native scrolling and drag controls.
- Simplify native speed formatting to avoid Swift type-checker timeouts without changing displayed values.

## 0.23.2 — Smaller Windows packages and fresh update checks

- Add a one-shot outline-then-fill quota icon intro, respecting reduced motion; enlarge the tray Apply button and remove its redundant cancel control. Show continuously refreshed observed response speed, a recent trend and direction arrows for running chats.
- Make Recent collapsible and persist its state; projects and recent chats share one scroll area with content-driven heights.
- Use open/closed folder icons without chevrons, highlight hovered project rows, and remove sidebar blur bands on both platforms.
- Show a compact update action beside the version in both sidebar headers, including the running update state.
- Keep Check for updates available after finding a release on both desktops; manual checks bypass the successful-result cache, and installation refreshes the release before launching. Failed refreshes preserve the offer without silently installing stale builds.
- Package only the supported English/Chinese Electron locales, preserve the graphics/runtime components and independent Node, and use stronger compatible ZIP/Deflate compression when 7-Zip is available at build time.
- Validate the packaged Windows interface in both languages as well as installation and OTA.
- Trim unused tokenizer encodings and duplicate bundles from Windows packages using the same packaging rule as macOS. Keep input-budget checks and statistics unchanged.

## 0.23.1 — One-command skill installation

- Install or update the bundled GitHub skill with `context-manager skill install` on both platforms, with a custom skills-directory option.
- Preserve local edits and unrelated files; require explicit `--force` to replace modified skill content.
- Document the skill’s purpose, CLI scope and installation in English and Chinese.

## 0.23.0 — Optional compaction compensation and agent queue CLI

- Add a bundled context-manager skill and global/chat CLI commands for defaults, visible context budgets and read-only speed analysis; no speed-mode switching.
- Add a JSON queue CLI backed by the existing controller, with revision checks, idempotent add requests, literal file/stdin input and bundled-runtime launchers for both platforms.
- Add an independent, default-off experimental switch on Mac and Windows. Preserve the official runtime and label the larger runtime window separately from the app's target budget.
- Reconstruct active reasoning lengths from bounded local-history caches, respecting compaction replacement and fork boundaries. Restore the original window when disabled; show unavailable or insufficient-headroom states without guessing.
- Keep logical budgets and incoming-input preflight unchanged while reserving native accounting headroom between turns. Preserve the preference across upgrades.
- Validate the original-runtime control reproduction, compensation, readback and restoration with isolated loopback fixtures; this does not establish live-provider or Computer Use acceptance.


## 0.22.5 — Task composer and quota graph improvements

- Fix Electron 44 image/file clipboard handling; align composer actions, remove the expand action and redundant model chevron, and place square attachments above the prompt.
- Keep the practical current-cycle forecast first, with optional cycle overlay disabled by default. Place USD per quota percentage point and historical comparisons below, with six-cycle overlays, compact dates alongside the legend and precise hover cards.
- Add configurable smoothing isolated by cycle/segment while preserving raw hover values and forecasts. Center period controls and slightly increase line weight.
- Include cumulative 0.22.1–0.22.4 task settings, background chat execution, compaction commands, budget startup fixes, finer quota sampling, Credits history and automatic queue archives. Keep queues marked EXP.
- Synchronize native SwiftUI/AppKit macOS UI and the Windows desktop; publish both platform installers together after Actions validation.

## 0.21.7 — Manual compaction and macOS parity audit

- Add a bordered Compact now action beside Apply on both platforms, available only for an idle connected chat. Use native compaction with runtime checks, duplicate protection and safe handling of input arriving during compaction.
- Align native cost range defaults with the selected calendar day, clear stale native chart hover selections when data changes, and include Token / pp in native hover details.
- Audit recent analytics parity across both native Swift Charts and Windows charts; macOS execution still requires a Mac.

## 0.21.6 — Reliable slider handle dragging

- Fix Windows maximum-window handle hit testing: the visible outer half now receives pointer input. Pick the actual pressed handle and retain its grab offset throughout dragging.
- Keep linked compression scaling and model limits. Improve macOS close-handle selection and retain the grab offset; native handles already fit within their control bounds.
- Verify a real mouse drag from the outer edge at maximum capacity, including no initial jump and linked threshold reduction.

## 0.21.5 — Simpler analysis and date selection

- Add historical date selection and exact custom start/end times to the Token cost calendar on macOS and Windows.
- Default to Simple mode for practical quota and usage charts; keep statistical charts in Advanced analysis, with model comparisons shown in Simple only when at least two models have comparable data.
- Replace prominent fit statistics with plain-language interpretations. Collapse technical details and mark conversion ratios as insufficient, limited, or relatively consistent observations rather than official exchange rates.
- Move chart reading guidance into title info controls and hide weak fit lines.

## 0.21.4 — Token cost calendar

- Add local Token API cost estimates as a contribution-style heatmap or line chart on macOS and Windows, with day/week/month/year views and model filtering. Yearly lines aggregate the latest 12 calendar months.
- Reuse chat Standard pricing and cache-write assumptions; show missing and unpriced records separately. Retain up to 366 days and backfill available local logs.
- Match analytics hover cards to the conversation chart tooltip style and hide them during scrolling.
- Keep bordered return controls visible while scrolling in analytics and native defaults settings.

## 0.21.3 — One quota page

- Show quota predictions first, followed directly by advanced analysis on the same scrollable page on Mac and Windows.
- Remove the Advanced analysis / Back to prediction navigation toggle; retain the bordered Back to budget button.
- Keep model filters, chart categories, and reading guidance directly available below the outlook, preserving scroll position when filters change.

## 0.21.2 — Model-specific advanced analysis

- Add a model selector to advanced quota analysis on macOS and Windows, filtering local Token totals, rankings, and comparable intervals together.
- Calculate model quota relationships only from single-model intervals; keep account usage curves and forecasts labelled as account-wide.
- Replace expandable chart data dumps with shared reading guidance explaining each graph and how to interpret comparisons.

## 0.21.1 — Compact project sidebar

- Remove the main sidebar quota analytics entry on both platforms; keep analytics available in quota settings.
- Place the version before Settings and tighten project heading and project row spacing.
- Preserve Recent chat spacing and quota footer height, with native SwiftUI/AppKit on Mac and the existing Windows UI.
- Show quota analytics across the full application content area with the standard bordered Back button.
- Suspend chart hover updates during scrolling on both platforms; defer Windows page replacement until scrolling is idle.

## 0.21.0 — Quota outlook for 5-hour and weekly limits

- Make remaining quota, time to use it all, and expected unused quota at reset the default analytics view on both platforms.
- Forecast each reported cycle independently from fresh observations of the current account; keep unknown historical accounts separate.
- Display a single current-cycle curve with actual timestamps and dashed projections, ending at depletion or reset.
- Move historical comparison charts into Advanced analysis; explain unavailable predictions instead of inventing a result.

## 0.20.3 — Inline details and useful quota history

- Show context details directly below one compact budget editor on both platforms; Apply remains explicit and dragging never saves.
- Remove redundant main-panel actions while retaining backend safety checks.
- Automatically select useful observation history, preserve manual source choices, and hide unsupported 5h metrics and charts.
- Normalize reset countdown jitter and support labelled same-cycle net changes across recording gaps, without fabricating hourly usage.

## 0.20.2 — Quota projection under rounded readings

- Base the central quota projection on consumption per observed hour, with hourly aggregation for slower/faster scenarios.
- Prevent long stretches of unchanged integer percentages from producing a flat forecast despite ongoing usage.
- Retain 0.20.1 worker lifecycle fixes and the shared cross-platform analytics UI.

## 0.20.1 — Reliable analytics worker restarts

- Close the quota ledger before retiring its worker and wait for that worker to exit before opening another one.
- Apply SQLite lock waiting before switching journal mode, preventing transient Windows startup failures.
- Exercise repeated idle/restart cycles and inspect privacy only after the ledger is closed.

## 0.20.0 — Cross-platform quota analytics

- Align Mac with the current Windows sidebar, Credits indicator, settings entry and details toolbar.
- Add six primary quota charts and advanced trends, model/cache comparisons, distributions, projections, anomalies and token rankings from one shared analytics report.
- Backfill numeric observations from local history, deduplicate response usage, and resume bounded incremental scans in a worker with a persistent ledger.
- Separate account observations, missing cycles, resets and gaps; present token/percentage relationships as local correlations rather than official exchange rates.
- Share and preserve Credits baseline preferences, including compatible Windows legacy baselines.

## 0.19.20 — Credits balance and context details

相较于 0.19.18，本版本改进 Windows 侧栏与上下文详情：

- **Credits 余额**：设置入口移至侧栏顶部版本号左侧；底部新增两行圆形余额入口。大额使用 K/M 等缩写，悬停显示完整数额，点击进入账户额度详情。标签为灰色小字，数字为白色，并留足圈内空间。
- **Credits 进度**：复用额度胶囊的边框粗细、顶部中点顺时针起始、端点圆点与告警颜色。首次读到余额和每次观察到余额增加时，以当前数额建立新基准；消费后按当前余额占基准的比例显示，基准在本机保存。此进度为本机观察值，不代表官方提供的总额度。
- **手动重置基准**：设置的账户额度页新增「重置 Credits 基准」，可将当前余额设为新的 100%；余额为零时保持空圈。未知余额不当作零，读取失败或缓存过期时需先刷新。
- **上下文详情布局**：返回预算和刷新按钮使用一致的带框样式；标题放到按钮行下方，增加留白，并移除聊天名称副标题。

本次界面改动面向 Windows；macOS 保持现有界面，两端继续使用同一产品版本。更新保留预算、缓存与偏好。

Compared with 0.19.18, this release refines the Windows sidebar and context details:

- Move Settings beside the version in the sidebar header. Add a two-line circular Credits balance with K/M abbreviations, an exact-value tooltip and a shortcut to account quota details.
- Match the Credits ring to quota outlines, clockwise progress from top center, endpoint dots and warning colors. The first balance and each observed increase establish a locally saved baseline; spending reduces the displayed ratio. This is a local observation, not an official total-credit allowance.
- Add **Reset Credits baseline** in account quota settings to use the current balance as the new 100%. Zero stays empty; missing balances remain unknown, and stale observations must be refreshed before resetting.
- Give Back to budget and Refresh matching bordered buttons, move the context-details title below the toolbar, and remove its chat-name subtitle.

These UI changes target Windows. macOS retains its existing interface and shares the same product version. Updates preserve budgets, caches and preferences.

## 0.19.18 — Projects, quota and update prompts

相较于 0.19.6，本版本统一包含以下更新：

- **项目与最近聊天**：新增可展开的项目侧栏；最近聊天包含项目内和独立聊天，按最新活动实时排序。聊天副标题显示项目名与接入状态。
- **额度显示**：新增侧栏额度、重置时间和实时倒计时；仅显示账户实际返回的周期。剩余低于 20% 显示黄色，低于 5% 显示红色，并兼容仅每周额度及积分账户。
- **Windows 界面**：等宽额度胶囊以顺时针边框和端点圆点显示剩余比例；调整侧栏比例、字体、设置按钮和聊天背景，列表底部使用柔和渐隐。
- **上下文详情**：详情回到主窗口右侧，切换聊天时直接查看对应统计。Windows 保留滚动位置和未保存的预算输入。
- **统计事件**：悬浮卡和选中详情显示模型、思考深度的前后变化，以及 ⚡ Fast / ⚡⚡ Ultrafast 标记。
- **Windows 快捷键**：窗口被其他窗口遮挡时，按一次即可置前；只有已聚焦时才隐藏。
- **Windows 更新提示**：启动发现新版本时可选择更新、本次跳过或关闭自动检查；设置中可重新开启或手动检查。macOS 保留原有后台检查和手动更新流程。

预算、缓存和偏好会在更新时保留；只有选择更新后才下载安装。

Compared with 0.19.6:

- Expandable projects and a live Recent list covering all chats, with project names and connection status.
- Sidebar quota with actual reset cycles, reset times and live countdowns; yellow below 20%, red below 5%, including weekly-only and credit-only accounts.
- Refined Windows sidebar, equal-width quota capsules with clockwise outlines and endpoint dots, clearer chat cards and soft list fades.
- Context details in the main pane; Windows preserves per-chat scroll positions and unsaved budget input.
- Model/reasoning transitions and ⚡ Fast / ⚡⚡ Ultrafast markers in chart details.
- A Windows shortcut that raises a covered window in one press and hides it only when focused.
- A Windows startup update prompt with Update, Skip this time and Disable automatic checks, plus settings controls. macOS retains background checks and manual installation.

Updates preserve budgets, caches and preferences. Downloads and installation require choosing Update.

## 0.19.6 — Shared core and cross-platform maintenance

- Integrate main 0.18.3 update recovery and approved Mac quota/control-panel design with the Windows 0.19.5 port.
- Separate pure budget/state/update rules, control API contracts, presentation and OS adapters; both interfaces submit visible budgets to the same authority.
- Generate native API routes from one specification and check JS/Swift budget parity with shared fixtures.
- Preserve future state fields and reject corrupt state instead of silently resetting it; replace stale same-version services and reclaim verified unused Windows installations.
- Require Linux core checks, native Mac build/package validation, and Windows build, installation, same-version rebuild, cross-version upgrade and OTA checks.
- Publish both platforms together with platform-specific update manifests while preserving the 0.18.x Mac update feed.

## 0.19.5 — Synchronized slider and progressive motion

- Remove fill-width transitions so the blue fill, headroom and handles follow the same drag frame.
- Accelerate particles progressively toward the right with the existing 80/20 budget weighting, keeping randomized drift and pacing.
- Adjust playback speed without restarting phases, and batch animation reads instead of rewriting every particle during drag.

## 0.19.4 — Continuous trends and inline chart values

- Join available chart measurements across missing intervals with straight lines on Windows and macOS.
- Add left-axis values, compact color legends and a pointer-following Windows data card so interval values can be read without scrolling down.
- Keep missing values, interval statistics, EMA resets and raw-record details unchanged; preserve native Apple chart rendering within measured intervals.

## 0.19.3 — One-command Windows EXE build

- Make build:win compile and compress the payload into a self-contained Setup.exe by default.
- Keep directory-only builds and explicit update-ZIP packaging available as separate commands.
- Upload the Windows installer and update archive as separate Actions artifacts to avoid downloading two copies for installation.

## 0.19.2 — Compact Windows budget layout

- Put context details beside the saved budget summary and remove the redundant instruction below the slider.
- Use equal-sized main action buttons, with Apply to this chat to the right of Stop auto apply.
- Reduce main-page spacing at the default window height so budget actions are easier to reach.
- Slow slider particles with independent randomized speed, position, size and gentle drift; preserve 80/20 budget weighting and animation continuity across refreshes.

## 0.19.1 — Apple-led cross-platform interaction

- Align Windows budget control order, percentage/window preset rows, model readiness, minimums and strict readback confirmation with the native Apple interface.
- Open context details in a modal sheet with preserved budget drafts, matching summary/chart/category ordering, smoothing controls and record selection.
- Match hover-versus-pin behavior, stale-request handling and inline tray save/cancel feedback; keep floating settings and the larger chat sidebar.
- Preserve all Apple native view sources, materials and Liquid Glass; retain the shared core and dual-platform build workflow.

## 0.19.0 — Unified Windows and macOS codebase

- Merge upstream 0.18 quota support with the Windows adaptation and keep both platform shells on one shared core and product version.
- Standardize floating settings into General, Global defaults, Account quota, Codex integration and Shortcut sections, opened by a bottom-left gear.
- Keep native SwiftUI/AppKit controls and materials on macOS, including Liquid Glass on supported SDKs and systems.
- Add Windows quota bars and percentage, remaining amounts, reset times, multiple quota pools, stale states and manual refresh.
- Package nested platform modules in the macOS installer and provide one workflow that builds Windows x64 and macOS arm64 from the same commit.

## 0.17.4 — Window toggle, slider motion and Windows history paths

- Toggle the main window with the configured global shortcut, including Ctrl+Shift+M by default.
- Increase slider particle count and speed with 80% compaction-threshold and 20% context-window weighting, updating live while dragging.
- Resolve Windows extended-length rollout paths through the native filesystem API and normalize drive/UNC namespaces for local-history containment checks.
- Enable integration by default after its startup check; retain explicit user choices and preserve native startup if automatic activation fails.
- Explain the disabled legacy early-compaction patch while retaining native automatic compaction and configurable thresholds.

## 0.17.3 — Windows sidebar and launch diagnostics

- Display native chat names in the sidebar, budget view, statistics and tray instead of falling back to IDs.
- Move sidebar controls into a floating Settings dialog opened by a bottom-left gear, with general, defaults, integration and shortcut tabs.
- Flush each native stdio write so short initialization messages reach Node before EOF; add rotating stage/timing/byte-count logs and an Open integration logs action.

- Install only the tray and interface by default; make desktop integration an explicit Settings action, with a startup probe before registration and restoration on disable.
- Give the installer, tray and service stable working directories so launched processes do not hold the extracted payload directory open.
- Prevent a late service attachment from keeping an already-closed runtime wrapper alive.

- Align trend cursors, selected points, event markers and pointer hit testing with one padded horizontal scale.
- Add configurable global show-window shortcut, defaulting to Ctrl+Shift+M, with recording, conflict handling and saved preferences.
- Unify control corners at 10px and prevent the information button from stretching with the heading.
- Make the three-chat synthetic preview explicit and add an entry to open real local chats.
- Package Windows as a self-contained Setup.exe with an embedded, checksum-verified payload and automatic temporary-file cleanup, reusing the existing installation and upgrade flow.


## 0.18.3 — Resilient update checks

- Prefer the public release manifest instead of depending on anonymous GitHub REST API requests; retain API fallback for older releases.
- Distinguish rate limiting, access refusal, network failure, and invalid metadata. Honor per-source retry/reset times and coalesce/throttle repeated checks.
- Offer retry timing and a manual release-page download link without asking users for tokens.
- Bind downloads to the manifest checksum as well as the existing sidecar and installer payload checks.


## 0.18.2 — Compact menu item and concrete credits

- Reduce the menu item width from 56 to 44 points and trim unused image canvas, without shrinking the bolt or percentage text.
- Replace the generic extra-credit availability message with the reported numeric credit balance. Hide the line when no finite balance is provided.


## 0.18.1 — Striped lightning quota indicator

- Apply the approved B design: vertical stripes form a lightning bolt, progressively emptying as remaining quota decreases.
- Bring the transparent percentage label 2.5 points closer to the bolt, keeping its lower-right placement.
- Preserve the shared dropdown, floating control panel, budgets, preferences, and caches.


## 0.18.0 — Quota indicator and floating control panel

- Consolidate sidebar settings in a bottom-left floating control panel, including inline navigation to global defaults.
- Replace the old menu-bar logo with stepped bars and a remaining-percentage label. Bars progressively become hollow as quota decreases.
- Integrate remaining quota and reset times into the existing chat menu; no extra quota window or ring.
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
