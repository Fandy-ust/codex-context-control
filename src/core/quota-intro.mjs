export const QUOTA_INTRO_MS = 3200;
export function quotaIntroFrame(elapsedMs = QUOTA_INTRO_MS, reducedMotion = false) {
  const smooth = value => { const p = Math.max(0, Math.min(1, value)); return p * p * (3 - 2 * p); };
  if (reducedMotion || elapsedMs == null || elapsedMs >= QUOTA_INTRO_MS) return {outline: 1, fill: 1, finished: true};
  return {outline: smooth(elapsedMs / 1800), fill: smooth((elapsedMs - 1800) / 1400), finished: false};
}
