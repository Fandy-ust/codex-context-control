# Context Manager

A local extension for Codex: **context control and quota-aware task queues**, built around 5-hour and weekly quota windows. Available from your **Mac menu bar or Windows system tray**, with context windows up to **920K**.

## Download

| Platform | Installer | Requirements |
| --- | --- | --- |
| macOS | [Latest macOS DMG](https://github.com/Fandy-ust/codex-context-control/releases/latest) | Apple Silicon · macOS 14+ |
| Windows | [Latest Windows Setup.exe · LZMA2](https://github.com/Fandy-ust/codex-context-control/releases/latest) | Windows 11 · x64 |

Windows Setup is a single EXE with embedded LZMA2 compression. Run it to update the normal installation and preserve your data. The release ZIP is for automatic updates; you do not need it for a manual install.

[Previous installers and archived notes](docs/releases/archive/index.md) · [Release retention policy](docs/RELEASE_POLICY.md) · [Full changelog](CHANGELOG.md)

[Mac installation](docs/en/INSTALL_MAC.md) · [Windows installation](docs/en/INSTALL_WINDOWS.md) · [Release notes](https://github.com/Fandy-ust/codex-context-control/releases/latest) · [简体中文](README.zh-CN.md)

### Install

Install Codex Desktop first, then Context Manager for your platform.

- **Mac:** open the DMG, launch **Install Context Manager.app**, and choose **Install / Update**.
- **Windows:** download and run **Setup.exe**, then choose **Install / Update**. No extraction or development tools are required.

Fully quit and reopen Codex, then click the quota icon in your menu bar or system tray. Enable **Context extension** for up to 920K; restart Codex after switching.

## Demo

https://github.com/user-attachments/assets/da7d0fd3-1b86-46e6-ac8f-0abca71e1c94

## Features

- **Global shortcut:** Ctrl + Shift + M shows or hides the main window on either platform; customize or clear it in Settings.

- **Multi-device cloud sync:** encrypted analytics via GitHub private repositories or Secret Gist, with account isolation, response deduplication and configurable intervals. [UI and GitHub CLI setup](docs/en/CLOUD_SYNC.md).

- **Agent CLI + skill:** manage queues and context budgets, inspect global quota and analyze observed speed. [Usage](docs/en/CLI.md). [Install the skill](docs/en/CLI.md#install-the-skill) · [Skill source](skills/context-manager/SKILL.md).

- **Per-chat budgets:** adjust one compact slider group, then click Apply; set new-chat defaults and inherit budgets when forking.
- **Account quota:** view remaining quota and reset times, with a gradually emptying lightning indicator on Mac and a tray-adapted icon on Windows.
- **Reset notifications:** native Windows/macOS reminders for 5-hour, weekly or combined resets, with deduplication and an independent settings switch. Keep the manager running and allow system notifications.
- **Quota activation:** optional weekly reset probes, one-time local schedules and history-based suggestions for how long before waking to start a quota window. [Behavior and settings](docs/QUOTA_ACTIVATION.md).
- **Credits:** compact sidebar balance and a local progress baseline, with exact-value tooltips and manual baseline reset in quota settings.
- **Control panel:** open settings from the sidebar header, with matching sections and control order on both platforms.
- **Quota outlook:** independently estimate whether 5-hour and weekly allowances will be used before reset, how soon they may run out, and how much may remain. Historical charts stay in Advanced analysis.
- **Local cache:** see chats and recent usage at startup, with incremental background sync.
- **Project sidebar:** expandable local projects above a live Recent list of all chats, with project names, connection status, a shared scroll area and saved expansion preferences.
- **Updates:** automatic checks and click-to-install, preserving budgets and preferences. Windows also offers startup prompts, Skip this time and an automatic-check switch.
- **Usage statistics:** view context, cache, estimated cost and response speed directly below the budget controls.

Both platforms share the same core. No app-name or version allowlist; the official Codex runtime is preserved.

Connection ownership is checked separately from cached history. The current release cleans up its owned runtime when the client exits; a genuine multi-client conflict keeps budget changes disabled. [Connection troubleshooting](docs/CONNECTION_TROUBLESHOOTING.md).

The old core patch was retired because its modified runtime lacked the official signing identity required for Computer Use. External compaction compensation is also retired in 0.25.2 because it could not reliably track long-running turns. **Context settings up to 920K remain available; they do not guarantee compaction occurs at exactly 900K of reported usage.** [Details](docs/en/COMPACTION_COMPENSATION.md).

[Quota analytics](docs/QUOTA_ANALYTICS.md) · [Usage](docs/en/USAGE.md) · [Cross-platform development](docs/MULTIPLATFORM_DEVELOPMENT.md) · [Build and release](docs/CROSS_PLATFORM_BUILD.md) · [Contributing](CONTRIBUTING.md) · [Privacy](docs/en/PRIVACY.md)

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · Independent project, not affiliated with OpenAI.

### Passive quota sync

Quota displays now reuse account and rate-limit responses or notifications already produced by the connected ChatGPT/Codex client. Context Manager does not launch a separate runtime or send a quota request for automatic or manual quota refresh. Existing client notifications update local quota state immediately. Quota displays omit cached-reading warnings; automation continues to require recent observations. Restart ChatGPT/Codex after upgrading the bridge. Explicit quota activation probes and account sign-in remain separate actions. This shared service behavior applies on macOS and Windows.
