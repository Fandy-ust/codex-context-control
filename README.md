# Context Manager

Manage each Codex chat’s context from your Mac menu bar. Up to **920K**.

## [Download 0.17.0 for Mac ↓](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.17.0-preview.1/Context-Manager-0.17.0-macos-arm64.dmg)

Apple Silicon · macOS 14+ · DMG, 45 MB · English / 中文

[Release notes](https://github.com/Fandy-ust/codex-context-control/releases/latest) · [简体中文](README.zh-CN.md)

### Install

1. Install Codex Desktop, then download and open the DMG above.
2. Open **Install Context Manager.app** and choose **Install / Update**.
3. Restart Codex and click the menu bar ring. Enable **Context extension** for up to 920K; restart Codex after switching.

[Installation help](docs/en/INSTALL_MAC.md)

## Demo

https://github.com/user-attachments/assets/da7d0fd3-1b86-46e6-ac8f-0abca71e1c94

## Features

- **Local cache:** chats and recent usage appear at startup, with incremental background sync.
- **Updates:** automatic checks; install only when you click.

- Adjust each chat’s context window and compaction threshold.
- Set defaults for new chats; forks inherit their parent’s budget.
- Track usage, cache, estimated cost, and response speed.
- No app-name or version allowlist. Uses the official Codex runtime.

The early-compaction patch is disabled because its modified core lacks the official signing identity required for Computer Use. **920K stays available without modifying the core.**

[Usage](docs/en/USAGE.md) · [Development](docs/en/DEVELOPMENT.md) · [Privacy](docs/en/PRIVACY.md) · [Changelog](CHANGELOG.md)

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · Independent project, not affiliated with OpenAI.
