import {speedTrendPath,speedLevel} from '../../src/core/response-speed.mjs';
export function responseSpeedContent(speed) {
  const rate = speed?.tokensPerSecond, direction = ['up', 'down'].includes(speed?.direction) ? speed.direction : '';
  const trend = speedTrendPath(speed?.samples);
  return `<span class="tray-speed-value speed-${speedLevel(rate)}">${Number.isFinite(rate) && rate >= 0 ? (Math.floor(rate*10)/10).toFixed(1).replace(/\.0$/, '') : '—'} tok/s</span><span class="speed-direction ${direction}" aria-hidden="true">${direction === 'up' ? '↑' : direction === 'down' ? '↓' : ''}</span>${trend ? `<svg class="speed-trend" viewBox="0 0 52 14" aria-hidden="true"><path d="${trend}"/></svg>` : ''}`;
}
