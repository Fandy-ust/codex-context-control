# Historical reasoning accounting and budget application

Starting with 0.27.30, safe-boundary budget application first estimates retained historical reasoning from local ordinary or `.zst` records, then loads the window and compaction threshold with accounting headroom together. Cold resumes perform the estimate before applying their configuration. The bounded cache retains lengths rather than reasoning payloads; there is no additional Codex server or repeated model-list retrieval.

The real target stays within native model limits or the optional 920K extension. Extra estimates enlarge only the runtime accounting window and threshold. CLI `loaded` and `headroom` remain real-target values; `accounting` reports the additional estimate and runtime counters separately. Real-usage checks still protect the target and response reserve.

This boundary adjustment does not guarantee that a long turn will never compact early. Steering can change reasoning boundaries and generated content can grow; native capacity checks remain active. Unreadable history cannot be treated as zero overhead and reported as a successfully applied budget.

The old manual compensation switch and modified-runtime patch remain retired. This implementation passes configuration to the official executable and preserves the App → official Codex → Node bridge-child launch chain. It does not modify the official binary, signature checks or Chrome permissions. A normal Codex restart loads the new bridge; saved configuration and confirmed runtime readback remain distinct.
