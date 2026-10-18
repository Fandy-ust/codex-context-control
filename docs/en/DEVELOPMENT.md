# Development

**English** | [简体中文](../DEVELOPMENT.md) · [Home](../../README.md)

Use Node.js 22.13+. Mac uses SwiftUI/AppKit and requires Apple Command Line Tools; Windows uses Electron with a native C# launcher. Build each platform on its own OS.

See [contribution rules](../../CONTRIBUTING.md), [shared-core boundaries](../MULTIPLATFORM_DEVELOPMENT.md), and [dual-platform builds](../CROSS_PLATFORM_BUILD.md) for the current workflow.

```sh
npm ci
npm run check:architecture
npm run test:ci
npm run build
```

On Mac, use `npm ci --ignore-scripts` to avoid downloading Electron. `build` selects the current platform. Installation is a separate action; see the platform installation guide.

## Layout

- `src/core/`: pure budget, inheritance, state and update rules.
- `src/contracts/`: shared control routes and generated native bindings.
- `src/platform/`: OS paths, processes, registration and installation lifecycle.
- Other `src/` modules: controller, runtime bridge, storage and statistics.
- `macos/`: SwiftUI/AppKit interface.
- `desktop/` and `windows/`: Electron interface and Windows native entry points.
- `packaging/` and `scripts/`: installers, builds and release validation.
- `test/`: isolated tests and shared behavior fixtures.

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
CONTEXT_CONTROL_TEST_INSTALLER_APP="$PWD/build/distribution/Install Context Manager.app" npm run test:distribution
```

Release packaging requires a clean tree and records its source revision. See [release details](RELEASING.md).

## License

Original project code is MIT licensed. Retain upstream notices for Node, js-tiktoken, its dependencies, and the separately distributed patched Codex runtime. See [third-party notices](../../THIRD_PARTY_NOTICES.md).
