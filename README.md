# Context Manager

Manage Codex chat context and account quota from your **Mac menu bar or Windows system tray**. Up to **920K**.

## Download

| Platform | Installer | Requirements |
| --- | --- | --- |
| macOS | [Download 0.19.6 · DMG](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.19.6-preview.1/Context-Manager-0.19.6-macos-arm64.dmg) | Apple Silicon · macOS 14+ |
| Windows | [Download 0.19.6 · Setup.exe](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.19.6-preview.1/Context-Manager-0.19.6-windows-x64-Setup.exe) | Windows 11 · x64 |

[Mac installation](docs/en/INSTALL_MAC.md) · [Windows installation](docs/en/INSTALL_WINDOWS.md) · [Release notes](https://github.com/Fandy-ust/codex-context-control/releases/latest) · [简体中文](README.zh-CN.md)

### Install

Install Codex Desktop first, then Context Manager for your platform.

- **Mac:** open the DMG, launch **Install Context Manager.app**, and choose **Install / Update**.
- **Windows:** download and run **Setup.exe**, then choose **Install / Update**. No extraction or development tools are required.

Fully quit and reopen Codex, then click the quota icon in your menu bar or system tray. Enable **Context extension** for up to 920K; restart Codex after switching.

## Demo

https://github.com/user-attachments/assets/da7d0fd3-1b86-46e6-ac8f-0abca71e1c94

## Features

- **Per-chat budgets:** adjust context windows and compaction thresholds; set new-chat defaults and inherit budgets when forking.
- **Account quota:** view remaining quota and reset times, with a gradually emptying lightning indicator on Mac and a tray-adapted icon on Windows.
- **Control panel:** open settings from the bottom left, with an interface tailored to each platform.
- **Local cache:** see chats and recent usage at startup, with incremental background sync.
- **Updates:** automatic checks, click-to-install, preserved budgets and preferences, and safe cleanup of unused versions.
- **Usage statistics:** track context, cache, estimated cost, and response speed.

Both platforms share the same core. No app-name or version allowlist; the official Codex runtime is preserved.

The early-compaction patch is disabled because its modified core lacks the official signing identity required for Computer Use. **920K stays available without modifying the core.**

[Usage](docs/en/USAGE.md) · [Cross-platform development](docs/MULTIPLATFORM_DEVELOPMENT.md) · [Build and release](docs/CROSS_PLATFORM_BUILD.md) · [Contributing](CONTRIBUTING.md) · [Privacy](docs/en/PRIVACY.md)

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · Independent project, not affiliated with OpenAI.
