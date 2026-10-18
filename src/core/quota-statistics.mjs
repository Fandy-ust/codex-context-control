export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const sum = values => values.reduce((total, value) => total + value, 0);
export function quantile(values, fraction) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction, index = Math.floor(position);
  return sorted[index] + (sorted[Math.ceil(position)] - sorted[index]) * (position - index);
}
export function distribution(values) {
  const clean = values.filter(finite);
  return clean.length ? {count: clean.length, min: Math.min(...clean), q1: quantile(clean, .25), median: quantile(clean, .5), q3: quantile(clean, .75), max: Math.max(...clean)} : null;
}
export function fitLine(points) {
  const values = points.filter(p => finite(p.x) && finite(p.y));
  if (values.length < 3) return null;
  const x = sum(values.map(p => p.x)) / values.length, y = sum(values.map(p => p.y)) / values.length;
  const xx = sum(values.map(p => (p.x - x) ** 2));
  if (xx <= 0) return null;
  const slope = sum(values.map(p => (p.x - x) * (p.y - y))) / xx, intercept = y - slope * x;
  const total = sum(values.map(p => (p.y - y) ** 2));
  if (total <= 0 || !finite(slope) || slope <= 0) return null;
  const residual = sum(values.map(p => (p.y - (intercept + slope * p.x)) ** 2));
  return {slope, intercept, r2: Math.max(0, 1 - residual / total), count: values.length};
}
export function lowerBound(values, time) {
  let left = 0, right = values.length;
  while (left < right) {const middle = (left + right) >>> 1;if (values[middle].at <= time) left = middle + 1;else right = middle;}
  return left;
}
export function usageBetween(requests, start, end) {
  const values = requests.slice(lowerBound(requests, start), lowerBound(requests, end));
  const valid = values.filter(p => tokens(p.input) != null && tokens(p.output) != null);
  const models = [...new Set(valid.map(p => p.model || '未识别模型'))];
  const input = sum(valid.map(p => p.input)), output = sum(valid.map(p => p.output));
  const cacheKnown = valid.every(p => tokens(p.cached) != null && p.cached <= p.input);
  const cached = cacheKnown ? sum(valid.map(p => p.cached)) : null;
  return {tokens: input + output, input, output, cached, cacheRate: input > 0 && cached != null ? cached / input : null,
    requests: valid.length, unknownRequests: values.length - valid.length, model: models.length === 1 ? models[0] : models.length ? '多模型' : '未识别模型'};
}
