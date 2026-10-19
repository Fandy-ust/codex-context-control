# Install on Windows

**English** | [简体中文](../INSTALL_WINDOWS.md) · [Home](../../README.md)

Windows 11 x64 · Context Manager 0.23.5 preview. Node and the interface runtime are bundled; no development tools are required.

## Download and install

1. Install Codex Desktop.
2. [Download the Windows Setup.exe](https://github.com/Fandy-ust/codex-context-control/releases/latest). Run this single file directly; no GitHub sign-in, extraction or development tools are required. The ZIP in the release is for OTA updates.
3. Choose **Install / Update**. The installer checks the bundled files and installs for your user account.
4. After your current work finishes, fully quit and reopen Codex. Click the quota icon in the system tray; Windows may place it under the hidden-icons arrow.

Integration is enabled after its startup check passes. If that check fails, the interface still installs and preserves native Codex startup; open **Settings → Codex integration** to inspect or retry. Review the project's Stop hook in Codex if you want Hook stats.

This preview is not publisher-signed. It is available from [GitHub Releases](https://github.com/Fandy-ust/codex-context-control/releases/tag/v0.23.5-preview.1), alongside the matching Mac version.

## Use and update

Click the tray icon for recent chats, or open the main window. Settings are available from the gear in the sidebar header. The default global shortcut is **Ctrl + Shift + M** and can be changed in Settings.

Update checks are automatic; installation requires a click. Check for updates stays available after finding a release, and installation refreshes the latest release first. Running a newer Setup.exe also updates the existing installation. Budgets, cached usage, language and shortcut preferences are preserved. Verified old program versions are removed once no running process needs them.

Uninstall through Windows Settings or the installer. Uninstallation preserves user data; files still used by Codex remain until they can be safely removed. The data directory is `%LOCALAPPDATA%\CodexContextControl`.

## Validation and development

The preview passed Windows build, interface-loading, isolated installation, same-version replacement, cross-version upgrade and OTA checks. These use a synthetic runtime; real Codex Desktop integration and Computer Use still require [manual acceptance](../WINDOWS_UI_CHECKLIST.md).

[Build both platforms](../CROSS_PLATFORM_BUILD.md) · [Shared-core architecture](../MULTIPLATFORM_DEVELOPMENT.md)
