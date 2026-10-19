# Context Manager

Manage Codex chat context and account quota from your **Mac menu bar or Windows system tray**. Up to **920K**.

## Download

| Platform | Installer | Requirements |
| --- | --- | --- |
| macOS | [Download 0.23.1 · DMG](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.23.1-preview.1/Context-Manager-0.23.1-macos-arm64.dmg) | Apple Silicon · macOS 14+ |
| Windows | [Download 0.23.1 · Setup.exe](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.23.1-preview.1/Context-Manager-0.23.1-windows-x64-Setup.exe) | Windows 11 · x64 |

[Mac installation](docs/en/INSTALL_MAC.md) · [Windows installation](docs/en/INSTALL_WINDOWS.md) · [Release notes](https://github.com/Fandy-ust/codex-context-control/releases/latest) · [简体中文](README.zh-CN.md)

### Install

Install Codex Desktop first, then Context Manager for your platform.

- **Mac:** open the DMG, launch **Install Context Manager.app**, and choose **Install / Update**.
- **Windows:** download and run **Setup.exe**, then choose **Install / Update**. No extraction or development tools are required.

Fully quit and reopen Codex, then click the quota icon in your menu bar or system tray. Enable **Context extension** for up to 920K; restart Codex after switching.

## Demo

https://github.com/user-attachments/assets/da7d0fd3-1b86-46e6-ac8f-0abca71e1c94

## Features

- **Agent CLI + skill:** manage queues and context budgets, inspect global quota and analyze observed speed. [Usage](docs/en/CLI.md). [Install the skill](docs/en/CLI.md#install-the-skill) · [Skill source](skills/context-manager/SKILL.md).

- **Early compaction compensation (experimental):** an optional switch reserves accounting headroom while keeping the target budget visible. [Details](docs/en/COMPACTION_COMPENSATION.md).

- **Per-chat budgets:** adjust one compact slider group, then click Apply; set new-chat defaults and inherit budgets when forking.
- **Account quota:** view remaining quota and reset times, with a gradually emptying lightning indicator on Mac and a tray-adapted icon on Windows.
- **Credits:** compact sidebar balance and a local progress baseline, with exact-value tooltips and manual baseline reset in quota settings.
- **Control panel:** open settings from the sidebar header, with matching sections and control order on both platforms.
- **Quota outlook:** independently estimate whether 5-hour and weekly allowances will be used before reset, how soon they may run out, and how much may remain. Historical charts stay in Advanced analysis.
- **Local cache:** see chats and recent usage at startup, with incremental background sync.
- **Project sidebar:** expandable local projects above a live Recent list of all chats, with project names, connection status, a shared scroll area and saved expansion preferences.
- **Updates:** automatic checks and click-to-install, preserving budgets and preferences. Windows also offers startup prompts, Skip this time and an automatic-check switch.
- **Usage statistics:** view context, cache, estimated cost and response speed directly below the budget controls.

Both platforms share the same core. No app-name or version allowlist; the official Codex runtime is preserved.

The old core patch was retired because its modified runtime lacked the official signing identity required for Computer Use. The new experimental compensation reserves headroom externally. **920K stays available without modifying the core.**

[Quota analytics](docs/QUOTA_ANALYTICS.md) · [Usage](docs/en/USAGE.md) · [Cross-platform development](docs/MULTIPLATFORM_DEVELOPMENT.md) · [Build and release](docs/CROSS_PLATFORM_BUILD.md) · [Contributing](CONTRIBUTING.md) · [Privacy](docs/en/PRIVACY.md)

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · Independent project, not affiliated with OpenAI.
