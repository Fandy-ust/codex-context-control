# Behavioral parity

| Capability | Shared authority | Mac presentation | Windows presentation | Validation |
| --- | --- | --- | --- | --- |
| Quota analytics and credit baselines | core/quota-analytics, quota ledger, account-quota | Native charts and Credits ring | SVG charts and Credits ring | Shared report fixtures, HTTP, ledger and UI checks |
| Visible window and compaction | core/budget, budget-command, policy | Native sliders | Web/native tray sliders | Core fixtures + Swift parity |
| Default budgets and forks | core/new-chat-defaults, fork-budget | Floating control panel | Settings overlay | API and bridge tests |
| Fresh versus cached usage | store, thread-cache, confirmation | Labels and rings | Labels and rings | Cache, lifecycle and confirmation tests |
| Projects and Recent chats | project-catalog, store | Native expandable projects and all recent chats, 50/50 split | Expandable projects and all recent chats, 50/50 split | Native/legacy membership, migration, refresh and rendering tests |
| Quota and credits | account-quota, quota-display | Striped lightning | Taskbar-adapted icon | Normalization and native rendering tests |
| History and charts | context-history, context-statistics | Native Charts | Canvas/SVG charts | Shared statistics and timeline tests |
| Update selection | core/update-artifact, updates | Native installer | Native setup/updater | Manifest, platform and corruption tests |
| Data inheritance | upgrade-state, core/state-document | Preserved support directory | Preserved LocalAppData | Installer and schema tests |
| Old-version cleanup | platform lifecycle adapters | Node/core cleanup | Version/shim cleanup after use | Active/current/unknown installation tests |

Platform-only presentation (materials, window positioning, shortcut binding, tray size) is deliberately not required to match. Real Windows Codex startup, authentication, tool execution, and Computer Use are manual acceptance items unless a test explicitly provides a real Codex runtime. Build success alone does not satisfy those items.
