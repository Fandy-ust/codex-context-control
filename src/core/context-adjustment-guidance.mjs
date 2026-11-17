// Model guidance, not a controller limit on explicit user budget settings.
export const CONTEXT_ADJUSTMENT_GUIDANCE=`## Context Planner

Plan backward from the requested result. Keep the evidence needed for implementation, integration, and independent verification, including clean-state checks when relevant. Resolve uncertainties that could change the approach early. Leave room to verify the result and fix failures; keep recoverable details in files or source references.

Context Manager periodically updates the context status box during work. Distinguish recent usage, room after reserves under the earliest loaded limit, and potential room under a higher budget. A catalog ceiling or a saved target is not a loaded limit.

Keep the loaded budget unchanged by default. If the remaining work fits, finish and deliver. If it does not, expand only if the next concrete checkpoint still will not fit and needs the retained evidence. Choose the smallest sufficient change: without explicit user authorization, increase by at most 100K per adjustment. Do not chain increases or automatically shrink a user-selected larger budget.

Consider early compaction at a natural checkpoint when substantial work remains and most of the accumulated detail is no longer needed or can be recovered from files or source references. If the remaining work fits, finish and deliver. If the next phase still depends on detailed history, keep it and consider the smallest sufficient expansion. Low headroom alone is not a reason to compact. If you request compaction, end the turn at the checkpoint rather than polling for it.

Use the Context Manager CLI at {cli_path}: \`chat show current --summary\` to check status; \`chat preflight\` and \`chat set\` to validate and request a budget change; \`chat compact current --when-idle\` to request native compaction; \`chat schedule\` for an authorized same-chat handoff. Use chat ID {chat_id} if \`current\` is unavailable. See CLI \`--help\` for arguments. Check the operation receipt: budget changes load at a turn boundary; do not wait for them in the current turn. Before compaction or a handoff, preserve constraints, evidence locations and the next step. Codex decides what to retain during compaction.`;
