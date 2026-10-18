# Cross-platform development

The product shares rules, not pixels. Mac uses SwiftUI/AppKit; Windows uses Electron and native C# entry points. Both call the same local controller and preserve the official Codex runtime.

## Change ownership

| Change | Owner / review |
| --- | --- |
| Mac layout and interactions | Mac maintainer |
| Windows tray, shortcuts and installation | Windows maintainer |
| Budget math, compaction safety, fork/default inheritance, cache semantics | Shared-core review from both maintainers |
| Persisted data, API routes and release manifests | Both maintainers, with upgrade tests |

## Shared contract

`src/contracts/control-api.json` defines routes; generated `macos/ControlAPI.swift` and the Electron main process use it. State includes `apiVersion` and capabilities. New clients submit visible-token budgets when `capabilities.visibleBudget` is available; the controller converts them using `src/core/budget-command.mjs`. Legacy raw-policy requests still work.

The authoritative checks stay in `src/core/`: actual capacity, compaction limits, reservation, stale usage, active turns and revision conflicts. UI drafts are only previews. The shared fixtures in `test/fixtures/contracts/budgets.json` verify JavaScript and native Swift against the same examples.

## Platform boundaries

Windows uses user-protected data directories and authenticated named pipes. macOS uses its native support directory and local sockets. Platform entry points handle OS mechanisms; pure core modules must not import them. `npm run check:architecture` enforces that dependency direction and checks generated bindings.

## Maintenance flow

Branch from current main, make a focused change, run local core tests, open a PR, and let the reusable desktop workflow validate both platforms. Merge the tested commit rather than maintaining separate long-lived product branches. UI redesigns should be separate from platform/core fixes.

Both installers inherit user data. Windows installs immutable version directories because active executables may be locked, then reclaims verified inactive versions. Unknown or live installations remain untouched. A same-version rebuild must compare build identity, not only the version string.

## Release flow

Build both systems with `.github/workflows/build-desktop.yml`. Regression and installer tests are mandatory. A version tag automatically creates and publishes the release only after both platform jobs succeed. The release contains DMG, Setup EXE, updater ZIP, checksums, and two public update manifests: schema 1 for existing Mac clients and schema 2 for platform-specific selection.

Both platforms share the version in root `package.json`. UI-only changes bump the shared patch version and ship for both platforms; public UI versions do not diverge.
