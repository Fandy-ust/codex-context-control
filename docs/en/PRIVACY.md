# Privacy and local data

**English** | [简体中文](../PRIVACY.md) · [Home](../../README.md)

Context Manager processes local Codex state and history on your Mac. Context statistics, token estimates, chart aggregation, and language selection do not call a remote model service.

The normal Codex client still connects to its own model service. Requesting native compaction can use the same model allowance as Codex normally would.

## Stored locally

The support directory stores per-chat budgets, global defaults, feature preferences, the language selection, observed metadata, controller connection information, and installation backups. The language file contains a schema version and `auto`, `zh`, or `en`; it does not contain your time-zone history or location.

Automatic language selection reads the system time-zone identifier locally. It makes no IP lookup, geolocation request, or permission request. Chat names and user text are never translated.

The statistics service reads local retained history to compute aggregates. It does not persist separate message or reasoning transcripts. Bounded in-memory caches and idle worker retirement limit retained analysis state. Opaque reasoning and compaction content is not decoded into a measured chain-of-thought size.

## Local interfaces

The UI uses an authenticated loopback controller and local IPC. The connection file includes a local token; do not publish it. The controller rejects missing or invalid authentication and browser-origin requests on its HTTP interface. Malformed IPC connections are isolated and bounded.

## Distribution

App installers include only allowed production code, dependencies, compiled UI, the pinned Node runtime, and notices. They exclude the author’s credentials, chat history, live state, research probes, test data, and the large optional patched Codex core.

The original signed Codex app is preserved. Installation backs up hook configuration and does not create fake hook trust records. Uninstall preserves budgets and backups unless you remove those files separately.

## Update checks and summary cache

Automatic update checks contact this public GitHub repository for release metadata; downloads occur only after clicking Install update. No chat content or credentials are sent. The persistent thread cache stores local file fingerprints, read offsets, model names, last reported usage, and window capacity. It contains no message bodies. Initial history reads use a bounded 256 KiB tail; subsequent reads process complete appended records and reuse unchanged files.

The quota indicator reads account rate limits through a short-lived official Codex app-server session. It does not open chats or request model output. Only quota percentages, window lengths, and reset times are retained in memory, with a five-minute refresh interval; authentication remains inside the official runtime.

When the official API supplies a numeric credit balance, it is shown in the account menu and cached only in memory. No generic availability message is substituted for a missing balance.
