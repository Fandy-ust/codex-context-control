# Early compaction compensation (experimental)

Enable **Early compaction compensation** in **Settings → General**. It defaults off and is independent of Context extension. It applies to chats with an enabled saved budget before their next turn or budget application.

**Codex may show a larger context window to reserve room for duplicate accounting. Use the target capacity shown in Context Manager.** Context Manager uses the original budget for capacity, percentages and tray displays. Request usage is never increased by the compensation estimate. The target is an application-managed budget, not a promise about the provider's capacity.

The controller reads the active local history, respects compaction replacements and fork boundaries, and reproduces the runtime's encrypted-reasoning length estimate. Only the required item types, identifiers and lengths are cached in memory. It does not persist reasoning payloads or conversation text.

Interrupted turns also count as finished for this check. Continuing after a pause recalculates compensation before sending input. After message edits, inherited history is resolved by immutable rollout ID rather than the chat's current file. Restart Codex when prompted after upgrading so its running bridge loads the fixes.

While the chat is idle, it adjusts the native window and threshold to reserve compensation space, preserving the saved logical budget. Incoming user input is checked against that target; native compaction can be requested first. Disabling restores the original window before the next turn of a chat with auto-apply enabled.

The feature preserves the official executable, usage receipts and chat history. It requires no extra model call. The estimate is not the real model reasoning-token count.

## Limits

- Missing or stale history/usage waits instead of guessing. Unrecognized rollback or incomplete compaction history is not compensated.
- A local catalog separates accounting headroom from the real budget, preserving the default context window and the app's editable limits. Internal accounting supports up to 16M tokens (or a larger original catalog maximum); this is not additional model capacity. Restart Codex normally after enabling or upgrading to load the catalog and bridge.
- With a 920K real budget, a 900K real trigger and 500K historical overhead, the internal trigger becomes 1400K. An 800K request remains displayed as 800K against 920K.
- New-input guards retain the real budget. After a completed turn reaches the real trigger, the bridge requests native compaction, including when the provider already counted reasoning. Failures stay visible.
- Temporary and parent-managed chats are excluded.
- Adjustments occur between turns. Provider accounting signals, new instruction boundaries within a turn, and future history/estimator changes may affect behavior. This is not a guarantee against all early compaction or a hard per-step limit during a running turn.
- Computer Use still requires real-machine acceptance; retaining the signed executable alone does not establish compatibility.

Tests cover history projection, bounds, target/readback separation, authenticated preferences and an original-runtime comparison with local synthetic responses, including restoration after disabling. The legacy binary-replacement patch remains disabled.
