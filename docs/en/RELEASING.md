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

The repository is public. A **draft** is a maintainer review artifact, not a public download. Publishing an app release is separate from uploading a demo video. Upload only the versioned ZIP, its `.sha256`, `package-info.json`, and installation notes for that build.

The **macOS installer** Actions workflow builds and validates artifacts but does not automatically publish a Release. Preserve third-party notices and include the project’s MIT license.
