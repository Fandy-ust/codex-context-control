import {HOUR, DAY, WEEK, finite} from './quota-statistics.mjs';

const validPercent = value => finite(value) && value >= 0 && value <= 100;
const validReset = value => Number.isSafeInteger(value) && value > 0 && value < 8640000000000;
const MAX_GAP = HOUR / 2;
const round = value => Math.round(value * 10000) / 10000;

// The outlook belongs to the current account, independently of whichever
// historical source is selected for advanced charts. No unknown history is
// silently joined to a live account to make a prediction appear available.
export function buildQuotaOutlook(snapshots, {currentScope, pool, now} = {}) {
  const account = snapshots.filter(p => p.scope === currentScope && p.at <= now).sort((a, b) => a.at - b.at);
  const pools = [...new Set(account.map(p => p.bucket))];
  const selectedPool = pools.includes(pool) ? pool : pools.includes('codex') ? 'codex' : pools[0];
  const rows = account.filter(p => p.bucket === selectedPool), latest = rows.at(-1);
  const verified = typeof currentScope === 'string' && currentScope.startsWith('account:');
  const periods = [];
  for (const [id, title, duration, minimumHours, freshMs] of [
    ['five', '5 小时额度', 5 * HOUR, .25, HOUR / 4],
    ['weekly', 'Weekly 额度', WEEK, 1, HOUR / 2]
  ]) {
    const usedKey = id + 'Used', resetKey = id + 'Reset';
    if (!latest || !validPercent(latest[usedKey]) || !validReset(latest[resetKey])) continue;
    const resetAt = latest[resetKey] * 1000, used = latest[usedKey], remaining = 100 - used;
    // A changed reset or a falling reading marks a new run even if an old
    // reset identity later reappears. Missing samples do not become zeros.
    const cycle = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const p = rows[i], next = cycle.at(-1);
      if (p[resetKey] !== latest[resetKey] || !validPercent(p[usedKey]) || p.at < resetAt - duration) break;
      if (next && (p.at >= next.at || p[usedKey] > next[usedKey])) break;
      cycle.push(p);
    }
    cycle.reverse();
    const lookback = id === 'weekly' ? DAY : duration;
    let start = cycle.length - 1;
    while (start > 0 && cycle[start].at - cycle[start - 1].at <= MAX_GAP && latest.at - cycle[start - 1].at <= lookback) start--;
    const first = cycle[start], observedHours = first ? (latest.at - first.at) / HOUR : 0;
    const delta = first ? used - first[usedKey] : 0;
    let status = 'insufficient';
    if (resetAt <= now) status = 'awaiting_reset';
    else if (now - latest.at > freshMs) status = 'stale';
    else if (!verified) status = 'unidentified';
    else if (remaining === 0) status = 'exhausted';
    else if (observedHours >= minimumHours && delta >= 1) status = 'ready';
    else if (observedHours >= minimumHours && delta === 0) status = 'flat';
    const rate = status === 'ready' ? delta / observedHours : null;
    const depletionAt = rate > 0 ? latest.at + remaining / rate * HOUR : status === 'exhausted' ? latest.at : null;
    const projectedRemaining = rate > 0 ? Math.max(0, remaining - rate * (resetAt - latest.at) / HOUR) : status === 'exhausted' ? 0 : null;
    const result = {
      id, title, status, observedAt: latest.at, resetAt, remainingPercent: round(remaining),
      hoursUntilReset: Math.max(0, (resetAt - now) / HOUR), observedHours, minimumHours,
      ratePerHour: rate, hoursRemaining: depletionAt == null ? null : Math.max(0, (depletionAt - now) / HOUR),
      depletionAt, projectedRemaining: projectedRemaining == null ? null : round(projectedRemaining),
      finishesBeforeReset: depletionAt == null ? null : depletionAt <= resetAt,
      hoursBeforeReset: depletionAt == null ? null : Math.max(0, (resetAt - Math.max(now, depletionAt)) / HOUR),
      // This target includes time since the most recent observation, so it
      // doesn't pretend an old reading was measured at the current instant.
      targetRatePerHour: resetAt > latest.at ? remaining / ((resetAt - latest.at) / HOUR) : null
    };
    let segment = 0;
    const points = cycle.map((p, i) => {
      if (i && p.at - cycle[i - 1].at > MAX_GAP) segment++;
      return {id: id + ':' + p.at, x: p.at, y: 100 - p[usedKey], at: p.at, series: '实际观测', segment: 'observed:' + segment};
    });
    // Bound rendering while keeping every run's endpoints and gaps visible.
    const sampled = new Map();
    for (const p of points) {
      const key = p.segment + ':' + Math.floor(p.at / (id === 'five' ? 60000 : 15 * 60000));
      if (!sampled.has(key + ':first')) sampled.set(key + ':first', p);
      sampled.set(key + ':last', p);
    }
    const visible = [...new Map([...sampled.values()].map(p => [p.id, p])).values()].sort((a,b)=>a.at-b.at);
    if (rate > 0) {
      const end = Math.min(depletionAt, resetAt);
      visible.push({id:id+':projection-start',x:latest.at,y:remaining,at:latest.at,series:'按近期速度预计',segment:'projection',projected:true},
        {id:id+':projection-end',x:end,y:Math.max(0,remaining-rate*(end-latest.at)/HOUR),at:end,series:'按近期速度预计',segment:'projection',projected:true});
    }
    result.chart = {id:'outlook-'+id,title:'剩余额度走势',kind:'line',xLabel:'时间',yLabel:'剩余 %',wide:true,
      points:visible,xMin:Math.min(visible[0]?.x ?? latest.at,latest.at-60000),xMax:rate>0?resetAt:latest.at+60000,yMax:100,timeAxis:id==='five'?'hours':'days',empty:'等待当前周期的观测',
      note:'实线为本周期观测，虚线按近期速度延伸到用完或重置；不包含重置后新增额度'};
    periods.push(result);
  }
  return {pool:selectedPool ?? null,pools:pools.map(id=>({id,label:id})),verified,periods};
}
