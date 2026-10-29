# Documentation

**English** | [简体中文](../../README.zh-CN.md) · [Home](../../README.md)

## English guides

- [Install, update, and uninstall](INSTALL_MAC.md)
- [Use budgets, charts, global defaults, and language selection](USAGE.md)
- [Context extension](CONTEXT_EXTENSION.md)
- [Privacy and local data](PRIVACY.md)
- [Architecture](ARCHITECTURE.md)
- [Development](DEVELOPMENT.md)
- [Packaging and releases](RELEASING.md)
- [Quota activation and reset notifications](../QUOTA_ACTIVATION.md)
- [Connection troubleshooting](../CONNECTION_TROUBLESHOOTING.md)
- [Retained downloads and historical notes](../releases/archive/index.md)
- [Release retention policy](../RELEASE_POLICY.md)
- [Localization](LOCALIZATION.md)
- [MIT license](../../LICENSE) and [third-party notices](../../THIRD_PARTY_NOTICES.md)

## Research and validation

These detailed historical reports remain in their original Chinese; the English guides above describe current behavior.

- [Performance scheduling and measurements](../PERFORMANCE.md)
- [Projected and incremental statistics cache](../STATISTICS_CACHE_2026-10-17.md)
- [Chart aggregation and interaction](../CHART-PERFORMANCE.md)
- [Stress tests and fixes, October 17](../STRESS_TEST_2026-10-17.md)
- [Earlier stress tests, October 16](../STRESS_TEST_2026-10-16.md)
- [Validation history](../VALIDATION.md)
- [Cache writes](../CACHE-WRITE-RESEARCH.md)
- [Cache and speed](../CACHE-SPEED-RESEARCH.md)

### Passive quota sync

Quota displays now reuse account and rate-limit responses or notifications already produced by the connected ChatGPT/Codex client. Context Manager does not launch a separate runtime or send a quota request for automatic or manual quota refresh. A reading supplied by a still-connected client stays current in the display even during quiet periods. Cached readings from disconnected clients remain marked stale; automation continues to require recent observations. Restart ChatGPT/Codex after upgrading the bridge. Explicit quota activation probes and account sign-in remain separate actions. This shared service behavior applies on macOS and Windows.
