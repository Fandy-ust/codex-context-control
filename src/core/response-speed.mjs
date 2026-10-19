export function speedLevel(rate) {
  if (!Number.isFinite(rate) || rate < 0) return 'unknown';
  return rate >= 40 ? 'green' : rate >= 30 ? 'yellow' : 'red';
}

export function latestObservedSpeed(responses = []) {
  const rate = r => r.eventType !== 'compaction' && r.timingKind === 'observed_generation' && Number.isFinite(r.outputTokens) && r.outputTokens >= 0 && Number.isFinite(r.durationMs) && r.durationMs > 0 ? r.outputTokens * 1000 / r.durationMs : null;
  const recent = responses.slice(-16), samples = recent.map(rate);
  for (let i = responses.length - 1; i >= 0; i--) {
    const r = responses[i];
    if (rate(r) == null) continue;
    let previous = null;
    for (let j = i - 1; j >= 0; j--) { previous = rate(responses[j]); if (previous != null) break; }
    const value = rate(r), change = previous == null ? null : Math.round(value * 10) - Math.round(previous * 10);
    return {tokensPerSecond: value, direction: change == null || change === 0 ? null : change > 0 ? 'up' : 'down', samples, responseId: r.id, turnId: r.turnId ?? null, timestamp: r.timestamp};
  }
  return null;
}

export function speedTrendPath(samples = [], width = 52, height = 14) {
  const values = samples.slice(-16), valid = values.filter(v => Number.isFinite(v) && v >= 0);
  if (valid.length < 2) return '';
  const low = Math.min(...valid), high = Math.max(...valid), span = high - low;
  let drawing = false, path = '';
  values.forEach((value, i) => {
    if (!Number.isFinite(value) || value < 0) { drawing = false; return; }
    const x = 1 + i / Math.max(1, values.length - 1) * (width - 2), y = span ? height - 1 - (value - low) / span * (height - 2) : height / 2;
    path += `${drawing ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`; drawing = true;
  });
  return path;
}
