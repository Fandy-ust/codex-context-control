# Context Manager

Context Manager is a local companion for Codex Desktop on macOS and Windows.
Use it to adjust context budgets per chat, inspect usage and quota, and run
task queues around the 5-hour and weekly quota windows.

[简体中文](README.zh-CN.md)

## Install or update

Install Codex Desktop first. Download the installer from the
[latest release](https://github.com/Fandy-ust/codex-context-control/releases/latest).

| Platform | Installer | Requirements |
| --- | --- | --- |
| macOS | Open the DMG and run **Install Context Manager.app** | Apple Silicon · macOS 14+ |
| Windows | Run **Setup.exe** | Windows 11 · x64 |

Fully quit and reopen Codex after installation or an update. Open Context
Manager from the Mac menu bar or Windows system tray. On Windows, the release
ZIP is for automatic updates; use Setup.exe for manual installation.

[Mac installation](docs/en/INSTALL_MAC.md) · [Windows installation](docs/en/INSTALL_WINDOWS.md) · [Changelog](CHANGELOG.md) · [Older installers](docs/releases/archive/index.md)

## What it does

- **Context:** Set the usable window and compaction threshold for each chat, or
  set defaults for new chats. The optional extension allows a local budget of
  up to 920K. It requires a Codex restart and does not guarantee model capacity
  or an exact compaction point. [Compaction and accounting details](docs/en/COMPACTION_COMPENSATION.md)
- **Quota and queues:** View remaining quota, Credits and reset times, schedule
  tasks, and configure reset notifications. Quota displays reuse observations
  from the connected client. [Quota analytics](docs/QUOTA_ANALYTICS.md)
- **Usage:** Inspect context, cached tokens, estimated cost and observed response
  speed. [Usage guide](docs/en/USAGE.md) · [Optional encrypted sync](docs/en/CLOUD_SYNC.md)

https://github.com/user-attachments/assets/da7d0fd3-1b86-46e6-ac8f-0abca71e1c94

## CLI, skill and project policy

The [Context Manager CLI](docs/en/CLI.md) gives agents access to the same local
service as the desktop panel. Start with
`context-manager chat show current --summary` for a targeted snapshot. Budget changes apply at a safe turn
boundary; an explicit compaction request waits for the chat to become idle.

You can define your own policy in the project's root `AGENTS.md`: what evidence
to retain, when to inspect context, when to extend or compact, and how to
verify the result. The policy guides decisions; the CLI supplies measurements
and executes supported actions. The [bundled skill](skills/context-manager/SKILL.md)
is optional; see [how to install it](docs/en/CLI.md#install-the-skill).

Use targeted checks and reuse fresh observations. The CLI sends requests to
the local service; the desktop service also performs background quota, queue
and metadata work. See [runtime and resource checks](docs/RUNTIME-VALIDATION.md)
and [connection troubleshooting](docs/CONNECTION_TROUBLESHOOTING.md).

[Build and release](docs/CROSS_PLATFORM_BUILD.md) · [Contributing](CONTRIBUTING.md) · [Privacy](docs/en/PRIVACY.md) · [MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Independent project, not affiliated with OpenAI.
