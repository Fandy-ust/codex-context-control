import {quotaReliability,annotateQuotaCharts} from './quota-analysis-presentation.mjs';
import {HOUR, DAY, WEEK, finite, sum, distribution, fitLine, usageBetween} from './quota-statistics.mjs';
import {QUOTA_CHARTS, QUOTA_SECTIONS} from './quota-chart-catalog.mjs';
import {normalizeQuotaCycles} from './quota-observations.mjs';
import {buildQuotaOutlook} from './quota-outlook.mjs';
import {tokenCostCalendar} from './token-cost-calendar.mjs';
import {QUOTA_CHART_GUIDES} from './quota-chart-guides.mjs';

const validPercent = n => finite(n) && n >= 0 && n <= 100;
const reset = n => Number.isSafeInteger(n) && n > 0 && n < 8640000000000;
const round = n => Math.round(n * 10000) / 10000;
const cycleKey = (p, role) => reset(p[role + 'Reset']) ? String(p[role + 'Reset']) : null;
const MAX_GAP = 30 * 60000;
const dateLabel = (at, zone) => new Intl.DateTimeFormat('en-CA', {timeZone: zone, month: '2-digit', day: '2-digit'}).format(at);
function localParts(at, zone) {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'}).formatToParts(at).map(p => [p.type, p.value]));
  return {date: `${fields.year}-${fields.month}-${fields.day}`, hour: Number(fields.hour)};
}

// Positive deltas use a cumulative anchor: rounded zero-percent observations
// contribute tokens to the next change. Resets, backwards readings and gaps
// start a new anchor; none of those are reported as consumption.
export function quotaIntervals(snapshots, requests, role, {maxGap = MAX_GAP, minDelta = Number.EPSILON} = {}) {
  const result = []; let anchor = null, previous = null, skipped = 0, gapMs=0;
  for (const p of snapshots) {
    const key = cycleKey(p, role), value = p[role + 'Used'];
    if (!key || !validPercent(value)) {anchor = previous = null;gapMs=0;continue;}
    if (!previous || key !== cycleKey(previous, role) || p.at - previous.at > maxGap || p.at <= previous.at || value < previous[role + 'Used']) {
      if (previous) skipped++;
      anchor = previous = p;gapMs=0;continue;
    }
    if(p.at-previous.at>MAX_GAP)gapMs=Math.max(gapMs,p.at-previous.at);
    const delta = round(value - anchor[role + 'Used']);
    if (delta >= minDelta) {
      const usage = usageBetween(requests, anchor.at, p.at);
      result.push({id: `${role}:${anchor.at}:${p.at}`, start: anchor.at, end: p.at, cycle: key, pp: delta,
        fiveCycle: cycleKey(anchor, 'five') === cycleKey(p, 'five') ? cycleKey(p, 'five') : null,
        weeklyCycle: cycleKey(anchor, 'weekly') === cycleKey(p, 'weekly') ? cycleKey(p, 'weekly') : null,
        duration: p.at - anchor.at, estimated:gapMs>0, gapMs, ...usage});
      anchor = p;gapMs=0;
    }
    previous = p;
  }
  return {intervals: result, skipped};
}
export function observedQuotaPairs(snapshots, requests, role) {
  const pairs=[];
  for(let i=1;i<snapshots.length;i++){
    const a=snapshots[i-1],b=snapshots[i],key=cycleKey(a,role),delta=b[role+'Used']-a[role+'Used'];
    if(!key||key!==cycleKey(b,role)||!validPercent(a[role+'Used'])||!validPercent(b[role+'Used'])||b.at<=a.at||b.at-a.at>MAX_GAP||delta<0)continue;
    pairs.push({id:`pair:${role}:${a.at}:${b.at}`,start:a.at,end:b.at,cycle:key,pp:round(delta),duration:b.at-a.at,fiveCycle:cycleKey(a,'five')===cycleKey(b,'five')?cycleKey(b,'five'):null,...usageBetween(requests,a.at,b.at)});
  }
  return pairs;
}
function groupCycles(snapshots, role) {
  const groups = new Map();
  for (const p of snapshots) {
    const key = cycleKey(p, role);
    if (!key || !validPercent(p[role + 'Used'])) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups].sort((a, b) => Number(a[0]) - Number(b[0]));
}
function aggregateBy(values, key) {
  const groups = new Map();
  for (const value of values) {const id = key(value);if (!groups.has(id)) groups.set(id, []);groups.get(id).push(value);}
  return groups;
}
function requestRanking(requests) {
  const rows = [];
  for (const [kind, field] of [['chat', 'thread'], ['project', 'project']]) {
    for (const [id, values] of aggregateBy(requests, p => p[field] || '未分类')) {
      const total = sum(values.map(p => p.input + p.output));
      rows.push({id: kind + ':' + id, category: kind, label: kind === 'chat' ? values.at(-1).name || id.slice(0, 12) : id, tokens: total, requests: values.length});
    }
  }
  return rows.sort((a, b) => b.tokens - a.tokens).slice(0, 40);
}
function chartPoints(intervals) {
  return intervals.filter(p => p.tokens > 0 && !p.unknownRequests && p.pp >= 1).map(p => ({id: p.id, x: p.tokens, y: p.pp, series: p.model, at: p.end,
    tokens: p.tokens, pp: p.pp, estimated:p.estimated, durationHours:p.duration/HOUR, cacheRate: p.cacheRate, requests: p.requests, start: p.start, end: p.end}));
}

export function buildQuotaAnalytics({snapshots = [], requests = [], currentScope = null, progress = null} = {}, options = {}) {
  const now = finite(options.now) ? options.now : Date.now(), days = [28, 56, 84].includes(options.days) ? options.days : 28;
  let zone = options.timeZone || 'UTC';try {localParts(now, zone);} catch {zone = 'UTC';}
  const cutoff = now - days * DAY;
  const normalized=normalizeQuotaCycles(snapshots.filter(p=>finite(p.at)&&p.at<=now+60000&&p.at>=cutoff&&typeof p.scope==='string'&&typeof p.bucket==='string'));
  const all=normalized.snapshots.sort((a,b)=>a.at-b.at);
  const scopeIds=[...new Set(all.map(p=>p.scope))];
  const validRequests = requests.filter(p => finite(p.at) && p.at >= cutoff && p.at <= now && Number.isSafeInteger(p.input) && p.input >= 0 && Number.isSafeInteger(p.output) && p.output >= 0).sort((a, b) => a.at - b.at);
  const uniqueRequests = [...new Map(validRequests.map(p => [p.id, p])).values()].sort((a, b) => a.at - b.at);
  const profiles=scopeIds.map(id=>{
    const rows=all.filter(p=>p.scope===id),pools=[...new Set(rows.map(p=>p.bucket))];
    const pool=pools.includes(options.pool)?options.pool:pools.includes('codex')?'codex':pools[0];
    const selected=rows.filter(p=>p.bucket===pool);
    const score=quotaIntervals(selected,uniqueRequests,'weekly',{minDelta:1,maxGap:WEEK}).intervals.filter(p=>p.tokens>0&&!p.unknownRequests).length
      +quotaIntervals(selected,uniqueRequests,'five',{minDelta:1,maxGap:5*HOUR}).intervals.filter(p=>p.tokens>0&&!p.unknownRequests).length;
    return {id,pools,pool,selected,score};
  });
  const manual=profiles.find(p=>p.id===options.scope);
  const eligible=options.pool?profiles.filter(p=>p.pools.includes(options.pool)):profiles;
  const ranked=[...(eligible.length?eligible:profiles)].sort((a,b)=>b.score-a.score||Number(b.id===currentScope)-Number(a.id===currentScope)||b.selected.length-a.selected.length);
  const chosen=manual||ranked[0];
  const scope=chosen?.id||'history',poolIds=chosen?.pools||[],pool=chosen?.pool||'codex',selected=chosen?.selected||[];
  const model=typeof options.model==='string'?options.model:'';
  const modelName=p=>p.model||'未识别模型';
  const models=[...new Set(requests.filter(p=>p.at<=now&&p.at>=now-366*DAY).map(modelName))].sort().map(id=>({id,label:id}));
  const filteredRequests=model?uniqueRequests.filter(p=>modelName(p)===model):uniqueRequests;
  // Identify models BEFORE filtering requests: mixed intervals cannot be assigned
  // to a single model just because its peers were hidden by the picker.
  const forModel=result=>({...result,intervals:model?result.intervals.filter(p=>p.model===model&&!p.unknownRequests):result.intervals});
  const modelPairs=values=>model?values.filter(p=>p.model===model&&!p.unknownRequests):values;
  const weekly = forModel(quotaIntervals(selected, uniqueRequests, 'weekly')), five = forModel(quotaIntervals(selected, uniqueRequests, 'five'));
  const comparableWeekly=forModel(quotaIntervals(selected,uniqueRequests,'weekly',{minDelta:1,maxGap:WEEK})),comparableFive=forModel(quotaIntervals(selected,uniqueRequests,'five',{minDelta:1,maxGap:5*HOUR}));
  const accountWeeklyPairs=observedQuotaPairs(selected,uniqueRequests,'weekly');
  const weeklyPairs=modelPairs(accountWeeklyPairs),fivePairs=modelPairs(observedQuotaPairs(selected,uniqueRequests,'five'));
  const weeklyCycles = groupCycles(selected, 'weekly'), fiveCycles = groupCycles(selected, 'five');
  const latestWeekly = [...selected].reverse().find(p => validPercent(p.weeklyUsed) && reset(p.weeklyReset));
  const latestFive = [...selected].reverse().find(p => validPercent(p.fiveUsed) && reset(p.fiveReset));
  const currentWeek = latestWeekly?.weeklyReset * 1000 > now ? String(latestWeekly.weeklyReset) : null;
  const weekStart = currentWeek ? Number(currentWeek) * 1000 - WEEK : null;
  const currentUsage = weekStart == null ? null : usageBetween(filteredRequests, weekStart - 1, now);
  const windows = fiveCycles.map(([id, points]) => {
    const start = Number(id) * 1000 - 5 * HOUR, end = Number(id) * 1000;
    const observedStart = points[0].at, observedEnd = points.at(-1).at;
    const wk = weeklyPairs.filter(p => p.fiveCycle === id), fh = fivePairs.filter(p => p.cycle === id);
    const pairKeys=new Map(fh.map(p=>[p.start+':'+p.end,p]));
    const matched=wk.filter(p=>pairKeys.has(p.start+':'+p.end));
    const pairedWeeklyPP=sum(matched.map(p=>p.pp)),pairedFivePP=sum(matched.map(p=>pairKeys.get(p.start+':'+p.end).pp));
    const usage = usageBetween(filteredRequests, observedStart, observedEnd);
    const weeklyPP = wk.length ? sum(wk.map(p => p.pp)) : null;
    const fivePP = fh.length ? sum(fh.map(p => p.pp)) : null;
    return {id, start, end, observedStart, observedEnd, pairedWeeklyPP,pairedFivePP, weeklyCycle: wk[0]?.cycle || null, weeklyPP, fivePP,
      // Ratios use the tokens aligned with the same weekly deltas, not all tokens in the window.
      alignedTokens: sum(wk.map(p => p.tokens)), alignedFiveTokens: sum(fh.map(p => p.tokens)), ...usage,
      partial: observedStart - start > 5 * 60000 || Math.min(now, end) - observedEnd > 5 * 60000 || points.some((p,i)=>i>0&&p.at-points[i-1].at>MAX_GAP) || matched.length<fh.length,
      label: dateLabel(start, zone) + ' ' + new Intl.DateTimeFormat('en-GB', {timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false}).format(start)};
  });
  const comparable = comparableWeekly.intervals.filter(p => p.tokens > 0 && p.pp >= 1 && !p.unknownRequests);
  const weekComparable = comparable.filter(p => p.cycle === currentWeek);
  const largestWindow = windows.filter(p => p.weeklyCycle===currentWeek && p.weeklyPP != null).sort((a, b) => b.weeklyPP - a.weeklyPP)[0] || null;
  const capabilities={weekly:weeklyCycles.length>0,fiveHour:fiveCycles.length>0};
  const data = new Map(QUOTA_CHARTS.map(spec => [spec.id, {...spec, points: [], empty: '尚无足够的可比较记录'}]));
  const set = (id, points, extra = {}) => Object.assign(data.get(id), {points}, extra);

  const curve = [];
  weeklyCycles.forEach(([id, values], index) => {
    let prior = null, segment = 0;
    const sampled = new Map();
    // Keep the first/last observation of each hour and each discontinuity.
    for (const p of values) {
      if (prior && (p.at - prior.at > MAX_GAP || p.weeklyUsed < prior.weeklyUsed)) segment++;
      const hour = Math.floor(p.at / HOUR), key = segment + ':' + hour;
      if (!sampled.has(key + ':first')) sampled.set(key + ':first', {p, segment});
      sampled.set(key + ':last', {p, segment});prior = p;
    }
    const seen = new Set();
    for (const {p, segment: part} of sampled.values()) {
      if (seen.has(p.at)) continue;seen.add(p.at);
      const x = (p.at - (Number(id) * 1000 - WEEK)) / DAY;
      if (x < 0 || x > 7) continue;
      curve.push({id: id + ':' + p.at, x, y: p.weeklyUsed, series: dateLabel(Number(id) * 1000 - WEEK, zone), segment: id + ':' + part, at: p.at, current: index === weeklyCycles.length - 1});
    }
  });
  set('weekly', curve.sort((a, b) => a.at - b.at), {xMax: 7, yMax: 100, note: '按实际额度重置周期对齐；缺测处断开'});
  const windowPoint = (p, y, index) => ({id: p.id, x: index, y, label: p.label, at: p.start, tokens: p.tokens, alignedTokens: p.alignedTokens, weeklyPP: p.weeklyPP, fivePP: p.fivePP, partial: p.partial, series: '本机观测'});
  set('windows', windows.filter(p => p.weeklyPP != null).map((p, i) => windowPoint(p, p.weeklyPP, i)), {empty: fiveCycles.length ? '尚无可归入单个 5h 窗口的 Weekly 变化' : '该账户尚无 5h 窗口记录', note: '仅统计观测到的区间；跨重置的差值不分配给窗口'});
  for (const [id, intervals] of [['weekly-scatter', comparableWeekly.intervals], ['five-hour-scatter', comparableFive.intervals]]) {
    const points = chartPoints(intervals),role=id==='weekly-scatter'?'weekly':'five',values=selected.filter(p=>validPercent(p[role+'Used']));
    const unchanged=values.length>1&&new Set(values.map(p=>p[role+'Used'])).size===1;
    const empty=values.length<2?'还需要至少两次额度观测':unchanged?'已读取记录，但这段时间额度读数尚未变化':intervals.some(p=>p.pp>=1)?'有额度变化，但对应时段缺少本机 token 记录':'额度变化不足 1 个百分点，暂不计算换算率';
    set(id, points, {fit: fitLine(points),empty,note: '本机相关观测，并非官方 token 换算公式'});
  }
  const efficiencyPoints=windows.filter(p => p.weeklyPP >= 1 && p.alignedTokens > 0).map((p, i) => windowPoint(p, p.alignedTokens / p.weeklyPP, i));
  if(!fiveCycles.length)for(const [id,values] of aggregateBy(comparable,p=>p.cycle)){
    const totalTokens=sum(values.map(p=>p.tokens)),weeklyPP=sum(values.map(p=>p.pp));
    efficiencyPoints.push({id,x:efficiencyPoints.length,y:totalTokens/weeklyPP,label:dateLabel(Number(id)*1000-WEEK,zone),series:'本机观测',tokens:totalTokens,weeklyPP,at:Number(id)*1000-WEEK});
  }
  set('efficiency',efficiencyPoints,{xLabel:fiveCycles.length?'5h 窗口':'Weekly 周期',summary:distribution(efficiencyPoints.map(p=>p.y)),empty:data.get('weekly-scatter').empty,note:'使用与 Weekly 变化对齐的 token；不足 1 个百分点不换算'});
  const heat = [];
  weeklyCycles.forEach(([id], row) => {
    const start = Number(id) * 1000 - WEEK;
    const groups = aggregateBy(weeklyPairs.filter(p => p.cycle === id), p => Math.floor((p.end - start) / DAY));
    for (const [day, values] of groups) if (day >= 0 && day < 7) heat.push({id: id + ':' + day, x: day, y: row, value: sum(values.map(p => p.pp)), label: dateLabel(start, zone), series: 'Weekly 百分点'});
  });
  set('weeks', heat, {xMax: 7, rows: weeklyCycles.map(([id]) => dateLabel(Number(id) * 1000 - WEEK, zone)), note: '空格表示无可比较观测，不代表零消耗'});
  const cumulative = [];let tokenTotal = 0, ppTotal = 0, priorEnd=null,segment=0;
  for (const p of weeklyPairs.filter(p => p.cycle === (currentWeek || weeklyCycles.at(-1)?.[0]))) {
    if(priorEnd!==p.start){segment++;cumulative.push({id:p.id+':start',x:p.start,y:tokenTotal,rightY:ppTotal,at:p.start,segment:String(segment),series:'累计 token'});}
    tokenTotal += p.tokens;ppTotal += p.pp;priorEnd=p.end;
    cumulative.push({id: p.id, x: p.end, y: tokenTotal, rightY: ppTotal, at: p.end, segment:String(segment),series: '累计 token'});
  }
  set('cumulative', cumulative, {note: '仅累加可观测区间，断档期间不估算'});
  const modelPoints = [];
  for (const [model, values] of aggregateBy(comparable.filter(p => p.model !== '多模型' && p.model !== '未识别模型'), p => p.model)) {
    modelPoints.push({id: model, x: modelPoints.length, y: sum(values.map(p => p.pp)) / sum(values.map(p => p.tokens)) * 1e6, label: model, series: model, samples: values.length});
  }
  set('models', modelPoints, {empty:'尚无可识别的单模型比较区间',note: '仅汇总单模型区间；少量样本仅作参考，混合模型不强行归因'});
  set('cache', comparable.filter(p => p.cacheRate != null).map(p => ({id: p.id, x: p.cacheRate * 100, y: p.pp / p.tokens * 1e6, series: p.model, at: p.end, tokens: p.tokens})), {xMax: 100});
  const histogram = new Map();
  for (const p of windows.filter(p => p.weeklyPP != null)) {const bin = Math.floor(p.weeklyPP / 2) * 2;histogram.set(bin, (histogram.get(bin) || 0) + 1);}
  set('distribution', [...histogram].sort((a, b) => a[0] - b[0]).map(([bin, count], index) => ({id: String(bin), x: index, y: count, label: `${bin}–${bin + 2}`, series: '窗口数'})));
  const boxes = [];
  for (const [id, values] of aggregateBy(comparable, p => p.cycle)) {
    if (values.length < 3) continue;const d = distribution(values.map(p => p.tokens / p.pp));
    boxes.push({id, x: boxes.length, y: d.median, low: d.min, high: d.max, q1: d.q1, q3: d.q3, samples: d.count, label: dateLabel(Number(id) * 1000 - WEEK, zone), series: 'Token / Weekly 百分点'});
  }
  set('boxplot', boxes);
  const recent = accountWeeklyPairs.filter(p => p.cycle===currentWeek&&now-p.end<=DAY), hours=sum(recent.map(p=>p.duration))/HOUR;
  const forecast = [];
  if (latestWeekly && now - latestWeekly.at < HOUR && recent.filter(p=>p.pp>0).length >= 3 && hours >= 1) {
    // Quota percentages are often integer-quantized. A median of five-minute
    // deltas can be zero despite sustained usage; aggregate time first.
    const mean=sum(recent.map(p=>p.pp))/hours;
    const hourlyRates=[...aggregateBy(recent,p=>Math.floor(p.end/HOUR)).values()].map(values=>sum(values.map(p=>p.pp))*HOUR/sum(values.map(p=>p.duration)));
    const rates=distribution(hourlyRates);
    const horizon = Math.min(72, (Number(currentWeek) * 1000 - latestWeekly.at) / HOUR);
    for (const [label, rate] of [['较慢', Math.min(mean,rates?.q1??mean)], ['平均速度', mean], ['较快', Math.max(mean,rates?.q3??mean)]]) {
      if (!(rate >= 0)) continue;
      for (let i = 0; i <= 24; i++) {const x = horizon * i / 24;forecast.push({id: label + i, at:latestWeekly.at+x*HOUR, x, y: Math.min(100, latestWeekly.weeklyUsed + rate * x), series: label});}
    }
  }
  set('forecast', forecast, {yMax: 100, empty: '需要近期至少三个变化区间和一小时有效观测', note: '从最后一次观测按近期速度外推，非保证或统计置信区间'});
  const costs = windows.filter(p => p.weeklyPP >= 1 && p.alignedTokens > 0).map(p => p.weeklyPP / p.alignedTokens * 1e6), costDist = distribution(costs);
  const threshold = costDist && costDist.count >= 5 ? costDist.q3 + 1.5 * (costDist.q3 - costDist.q1) : null;
  set('anomalies', windows.filter(p => p.weeklyPP >= 1 && p.alignedTokens > 0).map(p => ({id: p.id, x: p.alignedTokens, y: p.weeklyPP, series: threshold != null && p.weeklyPP / p.alignedTokens * 1e6 > threshold ? '偏高' : '一般观测', label: p.label, at: p.start})), {note: '至少五个窗口后按四分位距标记偏高值'});
  const hourly = new Map();
  for (const p of weeklyPairs) {const part = localParts(p.end, zone), key = part.date + ':' + part.hour;const old = hourly.get(key);hourly.set(key, {...part, value: (old?.value || 0) + p.pp});}
  const dates = [...new Set([...hourly.values()].map(p => p.date))].sort();
  set('hours', [...hourly].map(([id, p]) => ({id, x: p.hour, y: dates.indexOf(p.date), value: p.value, label: p.date, series: 'Weekly 百分点'})), {xMax: 24, rows: dates, note: '差值记在观测结束的小时，不插值填补空白'});
  set('ratio', windows.filter(p => p.pairedWeeklyPP >= 1).map((p, i) => windowPoint({...p,weeklyPP:p.pairedWeeklyPP,fivePP:p.pairedFivePP}, p.pairedFivePP / p.pairedWeeklyPP, i)), {note: '同一窗口的观测增量之比，部分窗口不代表完整消耗'});
  Object.assign(data.get('ranking'), {rows: requestRanking(filteredRequests), note: '仅按本机 token 排序；账户额度无法精确归因到单个聊天'});
  const scopes = scopeIds.map((id, i) => ({id, label: id === 'history' ? '本机历史（账户未标识）' : id === 'unidentified' ? '未识别账户观测' : id === currentScope ? '当前账户观测' : 'Account ' + (i + 1)}));
  for(const chart of data.values()){chart.guide=QUOTA_CHART_GUIDES[chart.id].map(p=>p[0]);chart.modelScope=['weekly','forecast'].includes(chart.id)?'account':'selected';chart.totalPoints=chart.points.length;if(chart.points.length>2000&&chart.kind!=='heatmap'){const values=chart.points;chart.points=Array.from({length:2000},(_,i)=>values[Math.floor(i*(values.length-1)/1999)]);chart.sampled=true;}}
  const fiveOnly=new Set(['windows','five-hour-scatter','distribution','anomalies','ratio']);
  const supported=id=>(capabilities.fiveHour||!fiveOnly.has(id))&&(capabilities.weekly||['five-hour-scatter','ranking'].includes(id));
  for(const chart of data.values())chart.visible=supported(chart.id);
  if(model)for(const chart of data.values())if(chart.modelScope!=='account'&&chart.kind!=='table'&&!chart.points.length)chart.empty='该模型暂无可单独比较的区间；混合模型区间不分摊额度';
  const sections=QUOTA_SECTIONS.map(s=>({...s,title:s.id==='windows'&&!capabilities.fiveHour?'明细':s.title,chartIds:s.chartIds.filter(supported)}));
  if(!sections[0].chartIds.length)sections[0].chartIds=['ranking'];
  const visibleSections=sections.filter(s=>s.chartIds.length);
  const reliability=quotaReliability(weekComparable,{unknownAccount:scope==='history'||scope==='unidentified',pending:progress?.pending||0});
  for(const c of data.values())if(['efficiency','boxplot','models','cache','ratio','anomalies','weekly-scatter','five-hour-scatter'].includes(c.id))c.reliability=quotaReliability(comparable,{unknownAccount:scope==='history'||scope==='unidentified',pending:progress?.pending||0});
  annotateQuotaCharts([...data.values()]);
  const simpleChartIds=['weekly','windows','weeks','ranking',...(data.get('models').points.length>=2?['models']:[])].filter(supported);
  return {simpleChartIds,reliability,costCalendar:tokenCostCalendar(requests,{now,timeZone:zone,model,costDate:options.costDate,costStart:options.costStart,costEnd:options.costEnd}),model,models,modelNotice:model?'已按模型筛选本机 Token；额度对比只使用单模型区间，混合区间不归因。账户已用百分比与预测仍为账户整体。':'当前汇总全部模型；不同模型的 Token 与额度消耗关系可能不同，可选择模型分别比较。',dashboard:buildQuotaOutlook(normalizeQuotaCycles(snapshots.filter(p=>finite(p.at)&&p.at<=now&&p.at>=now-366*DAY)).snapshots,{currentScope,pool:options.pool,now,requests,timeZone:zone,outlookOverlayCount:options.outlookOverlayCount,outlookSmoothing:options.outlookSmoothing,outlookStart:options.outlookStart,outlookEnd:options.outlookEnd}),schemaVersion: 1, generatedAt: now, timeZone: zone, days, scope, pool, capabilities,selection:{mode:manual?'manual':'auto',label:scopes.find(p=>p.id===scope)?.label||'本机记录'},scopes, pools: poolIds.map(id => ({id, label: id})), sections: visibleSections, charts: [...data.values()],
    overview: {weeklyUsed: currentWeek ? latestWeekly.weeklyUsed : null, fiveUsed: latestFive?.fiveReset * 1000 > now ? latestFive.fiveUsed : null,
      tokens: currentUsage?.requests ? currentUsage.tokens : !capabilities.weekly&&filteredRequests.length?sum(filteredRequests.map(p=>p.input+p.output)):null, tokensPerPP: weekComparable.length ? sum(weekComparable.map(p => p.tokens)) / sum(weekComparable.map(p => p.pp)) : null,
      updatedAt: selected.at(-1)?.at || null, largestWindow: largestWindow ? {label: largestWindow.label, weeklyPP: largestWindow.weeklyPP} : null},
    quality: {snapshots: selected.length, requests: filteredRequests.length, comparableIntervals: comparable.length,estimatedIntervals:comparable.filter(p=>p.estimated).length,resetTimeAdjustments:normalized.adjusted,discontinuities: weekly.skipped + five.skipped, unknownAccount: scope === 'history' || scope === 'unidentified', progress,
      notes: [...(comparable.some(p=>p.estimated)?['较长间隔按两次读数的净变化计算，不推断中间消耗时间']:[]),...(progress?.unreadable?['部分聊天记录不在本机，相关 token 可能缺失']:[]),'额度来自账户观测；token 仅涵盖本机记录，多设备使用可能使两者不匹配', '缓存 token 已包含在输入中，推理 token 已包含在输出中，不重复相加', '百分比取整、延迟、额度重置和缺测会影响换算；这里展示相关性，不提供固定兑换率']}};
}
