import {runningThread} from './tray-state.mjs';

// Read incrementally in the existing statistics workers, only for active chats.
// State responses stay immediate; repeated polls share work and cached results.
export function createRunningSpeedCache(read, {now = Date.now, intervalMs = 2000, maxConcurrent = 2, maxEntries = 64} = {}) {
  const entries = new Map(); let pending = 0, closed = false;
  return {
    get(id) { return entries.get(id)?.value ?? null; },
    observe(threads) {
      if (closed) return;
      const active = threads.filter(runningThread).sort((a, b) => (entries.get(a.id)?.checkedAt ?? -Infinity) - (entries.get(b.id)?.checkedAt ?? -Infinity));
      for (const thread of active) {
        let entry = entries.get(thread.id);
        if (entry?.pending || (entry && now() - entry.checkedAt < intervalMs)) continue;
        if (pending >= maxConcurrent) break;
        if (!entry) {
          if (entries.size >= maxEntries) {
            const oldest = [...entries].find(([, item]) => !item.pending);
            if (!oldest) break;
            entries.delete(oldest[0]);
          }
          entry = {value: null, checkedAt: -Infinity}; entries.set(thread.id, entry);
        }
        entry.pending = true; pending++;
        Promise.resolve().then(() => read(thread.id)).then(value => { if (!closed) entry.value = value; }, () => { entry.value = null; })
          .finally(() => { entry.pending = false; entry.checkedAt = now(); pending--; });
      }
    },
    close() { closed = true; entries.clear(); }
  };
}
