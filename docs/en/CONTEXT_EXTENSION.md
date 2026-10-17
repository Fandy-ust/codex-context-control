# Optional context extension

**English** | [简体中文](../CONTEXT_EXTENSION.md) · [Home](../../README.md)

The independent **Extend context** toggle selects native model limits or a local ceiling of **920,000 usable tokens**. The original signed Codex app and its model cache are preserved.

| Setting | Extension off | Extension on |
| --- | --- | --- |
| Usable window | Native per-model limit | Up to 920K |
| Latest compaction threshold | Native safe limit | 904K or lower |
| Next-turn reserve | Respect the model and policy | At least 16K |
| Existing budget above the limit | Temporarily reduced | Restored unless edited while off |

The 920K ceiling is a locally enforced budget. It is not a universal server-side model capacity guarantee. Previously observed capacity tests are not repeated automatically.

## Activation states

- **Disabled:** native limits apply.
- **Enabled; waiting for Codex:** the preference is saved, with no connected core yet.
- **Restart required:** the installed preference differs from the running core.
- **Active:** supported connected cores report the expected extension configuration.

An enabled switch without a connected Codex process is not reported as active. A running core must be restarted after changing modes. While its mode is incompatible with the selected configuration, editing is blocked rather than showing a misleading capacity.

## Compaction and pending input

At the maximum window, compaction is capped at 904K to leave at least 16K for the next turn. The bridge also checks pending input. If history must be compacted, it waits for compaction and a usage update before continuing. A failed compaction, missing observation, or insufficient remaining space stops the pending input from being sent.

A single oversized input can still be rejected and must be split. The system does not promise a particular retained summary size.

## Budget restoration

Before disabling extension, the controller saves larger per-chat policies and global defaults. On re-enabling, it restores only values that were not explicitly edited while native mode was active. Stopping automatic application does not silently re-enable it. Revisions prevent late replies from overwriting newer settings.

## Compatibility

Full integration is verified with Codex 0.160.0. Unsupported runtimes fall back or report unavailable features. The early-compaction patched runtime is a separate feature and optional download.
