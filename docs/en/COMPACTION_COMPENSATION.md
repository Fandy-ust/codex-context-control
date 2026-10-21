# Early compaction compensation is retired

Starting with 0.25.2, both desktops remove the switch, reject reactivation and migrate an enabled legacy preference to off. Native context windows, compaction thresholds, manual compaction and saved chat budgets remain available.

The runtime's compaction counter can include additional historical-reasoning estimates that are absent from displayed request usage. User input during a running turn changes the reasoning boundary. External compensation can update the window only at safe turn boundaries, so it cannot reliably cover an entire long-running turn.

Older versions could also forget the applied compensation state on resume even when the runtime retained its old window. Disabling could then incorrectly appear complete. Version 0.25.2 retains applied state, retries restoration and reports pending restoration explicitly.

A 920K target does not guarantee compaction waits for 900K of displayed usage. Disabling compensation does not remove the runtime's additional accounting rules. Short synthetic tests establish only their tested scenarios, not live-provider or long-turn guarantees.

Updates preserve budgets and do not actively compact chats. Restore the original parameters at a safe idle boundary; normally restart Codex to load the updated bridge. Restoration is confirmed only when the runtime window matches the target, not merely when the preference says off. Historical compensation fixtures remain isolated test-only inputs; the production UI and API cannot re-enable compensation.

The older binary patch remains retired because a modified runtime lacks the official signing identity required for Computer Use. This update leaves the official Codex executable unchanged.
