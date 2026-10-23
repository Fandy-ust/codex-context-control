# Install on Windows

**English** | [简体中文](../INSTALL_WINDOWS.md) · [Home](../../README.md)

Windows 11 x64. Node and the interface runtime are bundled; no development tools are required. The single-file Setup uses embedded LZMA2 compression and updates the normal installation in place.

## Download and install

1. Install Codex Desktop.
2. [Download the Windows Setup.exe](https://github.com/Fandy-ust/codex-context-control/releases/latest). Run this single file directly; no GitHub sign-in, extraction or development tools are required. The ZIP in the release is for OTA updates.
3. Choose **Install / Update**. The installer checks the bundled files and installs for your user account.
4. After your current work finishes, fully quit and reopen Codex. Click the quota icon in the system tray; Windows may place it under the hidden-icons arrow.

Integration is enabled after its startup check passes. If that check fails, the interface still installs and preserves native Codex startup; open **Settings → Codex integration** to inspect or retry. Review the project's Stop hook in Codex if you want Hook stats.

The installer is not publisher-signed. Get the current build from [GitHub Releases](https://github.com/Fandy-ust/codex-context-control/releases/latest), alongside the matching Mac version. [Retained rollback builds and archived notes](../releases/archive/index.md).

## Use and update

Click the tray icon for recent chats, or open the main window. Settings are available from the gear in the sidebar header. The default global shortcut is **Ctrl + Shift + M**; record or edit it in Settings, or clear it to disable the shortcut.

**Quota activation** settings include native reset reminders, optional weekly probes and one-time activation schedules. [Details](../QUOTA_ACTIVATION.md). For an unconnected chat or repeated multiple-process warning, see [connection troubleshooting](../CONNECTION_TROUBLESHOOTING.md).

Update checks are automatic; installation requires a click. Check for updates stays available after finding a release, and installation refreshes the latest release first. Running a newer Setup.exe also updates the existing installation. Budgets, cached usage, language and shortcut preferences are preserved. Verified old program versions are removed once no running process needs them.

Uninstall through Windows Settings or the installer. Uninstallation preserves user data; files still used by Codex remain until they can be safely removed. The data directory is `%LOCALAPPDATA%\CodexContextControl`.

## Validation and development

The preview passed Windows build, interface-loading, isolated installation, same-version replacement, cross-version upgrade and OTA checks. These use a synthetic runtime; real Codex Desktop integration and Computer Use still require [manual acceptance](../WINDOWS_UI_CHECKLIST.md).

[Build both platforms](../CROSS_PLATFORM_BUILD.md) · [Shared-core architecture](../MULTIPLATFORM_DEVELOPMENT.md)
