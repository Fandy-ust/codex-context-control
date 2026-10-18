# Cross-platform changes

- Apply future product, behavior, and UI changes to both macOS (`macos/`) and Windows (`desktop/`, `windows/`) in the same change. Keep their shared program behavior aligned and assess both platform implementations for every change.
- Preserve each platform's strengths: use SwiftUI/AppKit and native macOS controls on Mac; use the existing Windows/Electron UI and Windows platform capabilities on Windows. Behavioral parity does not require identical rendering code.
- Keep a single shared product version for both platforms. Report platform-specific validation limits explicitly.
