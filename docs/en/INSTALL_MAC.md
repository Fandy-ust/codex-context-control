# Install on macOS

**English** | [简体中文](../INSTALL_MAC.md) · [Home](../../README.md)

The preview targets Apple Silicon (M-series) Macs with macOS 14 or later. Install Codex / ChatGPT Desktop first. 920K integration is verified with Codex 0.163.0-alpha.10.2 using local test fixtures. The current package does not include Intel or Windows builds.

## Install or update

1. [Download the 0.18.0 Apple Silicon DMG](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.18.0-preview.1/Context-Manager-0.18.0-macos-arm64.dmg) and open it.
2. Open **Install Context Manager.app**.
3. Select **Automatic (time zone)**, **中文**, or **English** if desired.
4. Choose **Install / Update**.
5. Fully quit and reopen Codex after the first installation or bridge upgrade.
6. Use the ring-and-three-bars icon in the macOS menu bar to open chat overview or the main window.

Users do not need Node, npm, Homebrew, Xcode, an administrator password, or an Apple developer membership. The installer copies the runtime to a stable user support directory, so deleting the downloaded installer does not break the app.

The 0.18.0 English / Chinese preview is published and publicly downloadable. The demo release contains a video, not an installer. Older drafts remain maintainer review artifacts.

## Opening a preview

The current preview is locally signed, without Developer ID signing or Apple notarization. If macOS blocks a trusted download, first attempt to open it, then use **System Settings → Privacy & Security → Open Anyway**. Device management may restrict this exception. [Apple’s instructions](https://support.apple.com/en-us/102445)

Checksums detect damaged or changed downloads; they do not establish a publisher’s identity. The app does not require disabling system security.

## Language and automatic startup

The installer and app share a local language preference. Automatic mode selects Chinese for mainland China, Hong Kong, Macao, and Taiwan zone names, and English elsewhere. Manual selection takes priority. It uses the system zone identifier locally, without location or network requests.

Codex starts the bridge automatically through the installed runtime entry. A menu bar companion provides the UI; you do not need to manually launch another app for every chat. For optional Hook stats, review the added Stop hook in Codex’s `/hooks`. Budget control does not depend on hook approval.

## Installed locations

| Item | Location |
| --- | --- |
| App | `~/Applications/Codex Context Control.app` |
| Controller, code, preferences, backups | `~/Library/Application Support/CodexContextControl` |
| Bundled Node | An immutable versioned path under the support directory’s `runtime/` |
| Language preference | `language.json` in the support directory |
| Stop hook | Added to `~/.codex/hooks.json`, preserving other hooks |

Updates stage the new code and app before replacing existing directories. Budgets, language, feature toggles, and backups are retained. The signed original Codex app is not modified.

## Uninstall

Open the installer again and choose **Uninstall**. This removes the app, automatic connection setup, and this project’s hook. Budgets and backups are retained. Developers can also run `npm run uninstall:local`.

The main installer does not include the large optional patched Codex runtime. Normal budget control, statistics, and context extension do not require that runtime.

## 920K / Computer Use

Enable context extension in Settings for up to 920K and restart Codex after changing it. The early-compaction fix is disabled because its modified core lacks the official Codex signing identity and can prevent Computer Use from working. 920K uses configuration only and preserves the official runtime. Updates preserve budgets and language but turn off the old early-compaction fix.

## Updates and local cache

Install 0.18.0 once to enable in-app updates. The app checks GitHub at startup (cached for six hours) and every six hours. Click Install update to download, verify, and install; restart Codex afterward. Budgets, language, and caches are retained. Local chats load at startup, update incrementally in the background, and can be refreshed with Sync local chats. Cached observations are historical, not a live connection. Missing remote-only histories remain unavailable until synchronized by Codex.

Successful updates replace the old app and code, remove unused bundled runtimes and the disabled patched core, and delete OTA downloads after installation. Runtimes still used by a process are retained temporarily and checked again every five minutes after the app starts. Budgets, language, chat caches, and user backups are preserved. Manually downloaded DMGs are not deleted.

Upgrade inheritance keeps unknown preference fields and all existing user data. Before a version change, one configuration snapshot is saved in `upgrade-backup/` under the support directory; it excludes apps, runtimes and chat caches. Same-version reinstalls reuse the existing snapshot.
