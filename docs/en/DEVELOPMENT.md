# Development

**English** | [简体中文](../DEVELOPMENT.md) · [Home](../../README.md)

Use Node.js 22.13+; the installer pins Node 22.23.3. Native UI compilation requires Apple Command Line Tools and macOS. The first distribution targets Apple Silicon with macOS 14+.

```sh
npm ci --ignore-scripts
npm test
npm run build:mac
npm run install:local
```

## Layout

- `src/`: controller, runtime bridge, policy rules, local statistics, and shared translations.
- `macos/`: native SwiftUI/AppKit UI and chart interaction.
- `packaging/`: GUI installer and runtime pin metadata.
- `scripts/`: local installation, packaging, validation, and opt-in research tools.
- `test/`: isolated regression and integration checks.
- `docs/en/`: English guides; Chinese guides remain in `docs/`.

## Isolation and testing

Most integration tests use temporary homes, synthetic history, and a loopback model fixture. Do not stress a real user’s chat to test control logic.

```sh
node --test --test-concurrency=4 test/*.test.mjs
npm run test:stress -- --large
node scripts/chart-fixture.mjs
node scripts/check-chart-interaction.mjs
```

Optional install/UI/runtime package checks use the environment flags documented in the validation reports. Live context-capacity probes are separate opt-in tools and may incur model cost; they are not part of ordinary tests.

Useful isolation variables include `CONTEXT_CONTROL_HOME`, `CONTEXT_CONTROL_CODEX_HOME`, `CONTEXT_CONTROL_REAL_CODEX`, and `CONTEXT_CONTROL_APPLICATIONS`. Keep these pointed at test directories for destructive or crash-recovery tests.

## Localization

[Localization guide](LOCALIZATION.md) explains the shared catalog, source placeholders, timezone mapping, persistence, and UI refresh. Add English entries whenever adding Chinese UI text. Keep protocol identifiers, model names, tool names, chat names, numeric policies, and stored usage data unchanged.

## Building an installer

```sh
npm run package:mac -- --release
version=$(node -p "require('./package.json').version")
CONTEXT_CONTROL_TEST_INSTALLER_ZIP="$PWD/build/distribution/Context-Manager-$version-macos-arm64.zip" npm run test:distribution
```

Release packaging requires a clean tree and records its source revision. See [release details](RELEASING.md).

## License

Original project code is MIT licensed. Retain upstream notices for Node, js-tiktoken, its dependencies, and the separately distributed patched Codex runtime. See [third-party notices](../../THIRD_PARTY_NOTICES.md).
