# Package and release

**English** | [简体中文](../RELEASING.md) · [Home](../../README.md)

Follow the [dual-platform release workflow](../CROSS_PLATFORM_BUILD.md) to build and publish Mac and Windows together after validation. The sections below cover Mac packaging and signing.

## Mac build

```sh
npm ci --ignore-scripts
npm test
npm run package:mac -- --release
CONTEXT_CONTROL_TEST_INSTALLER_APP="$PWD/build/distribution/Install Context Manager.app" npm run test:distribution
```

The release flag requires a clean working tree. Package metadata records source revision, architecture, Node version, sizes, and actual signing status.

The Apple Silicon GUI installer bundles the compiled app, production controller code, shared translations, dependencies, notices, and a pinned Node archive verified against a fixed SHA-256. It rejects a prebuilt UI with the wrong version. The app and installer use the same icon and translation catalog.

It excludes personal settings, credentials, chat history, live probes, logs, test fixtures, and the large optional patched runtime.

## Validate

Distribution tests verify the payload’s exact file set and digests, reject tampering before installation, install with an empty developer-tool PATH, delete the downloaded installer, verify the retained runtime and wrapper, and uninstall in an isolated directory.

For a local update, compare budgets, global defaults, feature preferences, and language before and after. Confirm the menu bar app and controller report the new version. A bridge upgrade still requires the user to normally restart Codex.

Check both English and Chinese, plus automatic zone resolution. A language change must not alter a budget, chat name, model configuration, or hook authorization.

## Signing

Current previews use local signing, without Developer ID or Apple notarization. Do not label them notarized. With a Developer ID Application certificate, use `CONTEXT_CONTROL_SIGN_IDENTITY`, then the notarization script and a local keychain profile. See the [existing signing guide (Chinese)](../DEVELOPER_ID.md).

## Publish

The repository is public. Use **Build Windows and macOS** with `publish_release` enabled, or push the established `v<version>-preview.1` release tag. Both platform jobs must pass before the publishing job makes the draft public. Normal branch/PR validation does not publish a Release.

Publish the Mac DMG, Windows LZMA2 Setup.exe, Windows ZIP update package, corresponding checksums, package information, installation notes, and both update manifests. Keep `update.json` for legacy Mac clients and `update-v2.json` for platform-specific updates. Preserve third-party notices and include the MIT license.

Development artifacts expire after seven days. Keep the latest five normal releases and selected fallback milestones; archive retired notes before deleting older releases, preserve source tags, and protect referenced downloads. [Retention policy and maintenance commands](../RELEASE_POLICY.md).
