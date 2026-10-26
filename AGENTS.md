# Cross-platform changes

- Apply future product, behavior, and UI changes to both macOS (`macos/`) and Windows (`desktop/`, `windows/`) in the same change. Keep their shared program behavior aligned and assess both platform implementations for every change.
- Preserve each platform's strengths: use SwiftUI/AppKit and native macOS controls on Mac; use the existing Windows/Electron UI and Windows platform capabilities on Windows. Behavioral parity does not require identical rendering code.
- Keep a single shared product version for both platforms. Report platform-specific validation limits explicitly.

# Local release workflow

- Increment the shared patch version for every new user-facing change or fix. Keep package.json, package-lock.json, app metadata, installed service, and installer artifacts aligned; do not reuse a previously delivered version number.
- Verify the installed app version and executable hash against the new artifact after updating.
