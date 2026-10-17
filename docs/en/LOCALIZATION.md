# English and Chinese localization

**English** | [简体中文](../LOCALIZATION.md) · [Home](../../README.md)

## User preference

The app and installer offer **Automatic (time zone)**, **中文**, and **English**. Selection is saved in `language.json` under the Context Manager support directory. Its values are `auto`, `zh`, or `en`.

Automatic resolves known mainland China, Hong Kong, Macao, and Taiwan identifiers to Chinese. Other identifiers resolve to English. Legacy aliases are included. The UTC offset is not used: `Asia/Singapore` and `Australia/Perth` remain English in automatic mode. The same rules are tested in Swift and Node.

A manual selection takes priority over timezone changes and survives updates and app restarts. Language selection does not change budgets, runtime configuration, usage records, or user-authored names.

## Shared catalog

`src/locales/en.json` maps stable Chinese source keys to English. Parameterized messages use numbered placeholders such as `{0}` and `{1}`. Keep the placeholder sets equal in both languages. Do not translate protocol identifiers, filesystem paths, model identifiers, or user data.

Swift calls `L(key, arguments…)`. Dynamic backend statuses are translated only at display boundaries. Known English status templates can also map back to Chinese when switching languages; captured user arguments are preserved. Shared static data is thread-safe for background chart presentation.

The app and installer embed a copy of this catalog as `localization-en.json`. The Stop hook uses the same source catalog and local preference. Core protocol responses remain stable.

## Live updates

Preference and system timezone notifications refresh the UI and native menu labels. Chart presentation revisions include the effective language so cached labels are rebuilt when necessary. Numeric context budgets are independent from UI language.

## Verification

`test/localization.test.mjs` checks timezone decisions, manual overrides, invalid preference fallback, placeholder parity, native source-key coverage, dynamic statuses, mixed-language arguments, and persistence across native process restarts. Native UI checks and installer distribution validation cover resource delivery and rendering.
