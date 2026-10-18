# Contributing

One repository, one `main`, one shared core, two native platform experiences.

## Branches and review

Start short-lived feature branches from current `main` and merge through a PR. Sync frequently; do not maintain independent Mac and Windows product histories. Apply product and UI changes to both platforms together, while preserving native SwiftUI/AppKit features on Mac and existing Windows platform capabilities on Windows. The Windows maintainer reviews Windows integration and packaging; the Mac maintainer reviews SwiftUI/AppKit. Changes to shared rules, persisted data, contracts, and releases need review from both platform maintainers.

Keep each PR focused. State the behavior change, affected platforms, migration impact, and actual validation. A skipped test is not a pass. Do not merge a Windows port by overwriting the Mac directory or replace shared core changes with a platform copy.

## Boundaries

- `src/core/`: authoritative, platform-independent business rules. No filesystem, processes, networking, UI framework, or imports from outer layers.
- `src/contracts/`: versioned control routes. `control-api.json` is the source of truth; run `npm run generate:contracts` after editing it. Commit the generated Swift bindings.
- `src/presentation/`: UI-independent display helpers; never decide whether a budget is safe to apply.
- `src/platform/`: OS paths, IPC, process inspection, registration, Windows installation and cleanup.
- Remaining `src/` modules coordinate runtime/IO. Existing root imports remain compatibility entry points during migration.
- `macos/` and `desktop/`: separate UIs. They submit the desired usable budget; the core performs raw-window conversion and final validation. Older raw-policy clients remain supported.

Use shared fixtures under `test/fixtures/contracts/` for behavior visible on both platforms. Native preview calculations may differ in implementation for responsiveness, but must satisfy these fixtures; they are not the authoritative policy writer.

## Validation

```sh
npm ci --ignore-scripts
npm run check:architecture
npm run test:ci
```

Windows builds additionally require the pinned Electron runtime (`npm ci`, then `npm run build:win`). The reusable desktop workflow runs both OS builds, UI smoke tests, package/update tests, and installer validation. Setup/update tests use a synthetic Codex executable in isolated directories. They do not prove real Desktop login, Computer Use, or remote-host integration; those require platform-owner acceptance.

## Releases and user data

Mac and Windows always use the same product version from root `package.json`. A UI-only fix increments the shared patch version; release both platforms together even when one platform has no behavior change. Build IDs are internal identifiers, not separate public UI versions.

Use one product version and publish Mac DMG, Windows Setup EXE, and Windows updater ZIP together after both jobs pass. Pushing a `v<version>-preview.1` tag runs `Build Windows and macOS`, which creates and publishes the release automatically after validation. Manual dispatch with publishing enabled is also supported. A platform-only packaging run must not replace Latest with a partial release.

Do not rename/delete persisted fields casually. Preserve budgets, defaults, language, unknown fields, and caches. Version changes keep one configuration snapshot. Never delete a current or active installation. Windows cleanup waits while a desktop can still reference old shims. Keep `update.json` for 0.18.x Mac clients and `update-v2.json` for multi-platform clients.
