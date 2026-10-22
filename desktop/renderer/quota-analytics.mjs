import {costCalendarView} from './cost-calendar.mjs';
import {quotaOutlookView} from './quota-outlook-view.mjs';
const COLORS = ['#6da0ff', '#c695ff', '#59c9b1', '#efb66b', '#e87e98', '#9da6b7'];
const safe = n => Number.isFinite(n) ? n : 0;
const span = (a, b) => a === b ? [Math.min(0, a), b || 1] : [a, b];
const ratioNumber=n=>Number(n.toFixed(6)).toLocaleString(undefined,{maximumFractionDigits:6});
const short = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + 'K' : Number(n.toFixed(2)).toLocaleString();
export function quotaPointText(point, chart, t) {
  const rows = [point.label, point.series ? t(point.series) : null,
    `${t(chart.yLabel)}: ${chart.yLabel==='USD / 1%'?ratioNumber(point.rawY??point.y):short(chart.kind === 'heatmap' ? point.value : point.rawY??point.y)}`];
  if (point.at) rows.push(new Date(point.at).toLocaleString());
  if(point.costUSD!=null)rows.push(`${t('区间预估费用')}: $${ratioNumber(point.costUSD)}`,`${t('额度消耗')}: ${ratioNumber(point.quotaPP)}%`,`${t('开始')}: ${new Date(point.intervalStart).toLocaleString()}`);
  if (point.tokens != null) rows.push(`Token: ${short(point.tokens)}`);
  if (point.weeklyPP != null) rows.push(`Weekly: ${short(point.weeklyPP)} pp`);
  if (point.fivePP != null) rows.push(`5h: ${short(point.fivePP)} pp`);
  if (point.weeklyPP >= 1 && point.tokens > 0) rows.push(`Token / pp: ${short((point.alignedTokens ?? point.tokens) / point.weeklyPP)}`);
  if (point.cacheRate != null) rows.push(`${t('缓存占比')}: ${Math.round(point.cacheRate * 100)}%`);
  if (point.partial) rows.push(t('部分窗口'));
  if (point.estimated) rows.push(t('断档期间的净变化') + (point.durationHours ? ` · ${short(point.durationHours)} h` : ''));
  return rows.filter(Boolean).join(' · ');
}
export function quotaChartSVG(chart, {e, t}) {
  const points = chart.points || [], width = 640, height = chart.kind === 'heatmap' ? Math.min(380, Math.max(230, (chart.rows?.length || 4) * 15 + 52)) : 230;
  const left = chart.kind === 'heatmap' ? 80 : 56, top = 14, right = chart.kind === 'dual' ? 54 : 18, bottom = 40;
  const w = width - left - right, h = height - top - bottom, kind = chart.kind;
  const xs = points.map(p => p.x), ys = points.flatMap(p => [p.y, p.high || 0]);
  let [xmin, xmax] = span(xs.reduce((a,b)=>Math.min(a,b),Infinity), xs.reduce((a,b)=>Math.max(a,b),-Infinity)), [ymin, ymax] = span(0, ys.reduce((a,b)=>Math.max(a,b),0));
  if (kind === 'bar' || kind === 'box') {xmin = -.6;xmax = Math.max(.6, points.length - .4);}
  if (chart.xMax != null) {xmin = chart.xMin ?? 0;xmax = chart.xMax;}
  if (chart.yMax != null) ymax = chart.yMax;
  if (kind === 'heatmap') {xmin = 0;xmax = chart.xMax || 7;ymin = 0;ymax = Math.max(1, chart.rows?.length || 1);}
  const x = value => left + (value - xmin) / (xmax - xmin) * w;
  const y = value => top + h - (value - ymin) / (ymax - ymin) * h;
  const groups = [...new Set(points.map(p => p.series || ''))], color = p => COLORS[Math.max(0, groups.indexOf(p.series || '')) % COLORS.length];
  const rightMax = points.reduce((max,p)=>Math.max(max,p.rightY||0),1);
  const dateX = kind === 'dual' || chart.timeAxis;
  const xlabel = value => chart.timeAxis==='elapsed'?short(value/(chart.xMax>86400000?86400000:3600000))+(chart.xMax>86400000?'d':'h'):chart.id==='token-cost' ? (chart.axisLabels?.[Math.round(value)]?.slice(5)||'') : dateX ? new Date(value).toLocaleString(undefined, chart.timeAxis === 'hours' ? {hour:'2-digit',minute:'2-digit'} : {month:'numeric',day:'numeric',...(chart.timeAxis ? {hour:'2-digit'} : {})}) : short(value);
  const grid = kind === 'heatmap' ? '' : Array.from({length: 5}, (_, i) => {
    const value = ymax * i / 4, yy = y(value);
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="#ffffff10"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end">${e(chart.yLabel==='USD / 1%'?Number(value.toPrecision(3)).toLocaleString(undefined,{maximumFractionDigits:6}):short(value))}</text>${kind === 'dual' ? `<text x="${width - right + 8}" y="${yy + 4}" fill="#efb66b">${short(rightMax * i / 4)}</text>` : ''}`;
  }).join('');
  const ticks = kind === 'bar' || kind === 'box' ? points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 7)) === 0).map(p => `<text x="${x(p.x)}" y="${height - 19}" text-anchor="middle">${e((p.label || short(p.x)).slice(0, 14))}</text>`).join('') : kind === 'heatmap' ? Array.from({length: xmax}, (_, i) => `<text x="${x(i + .5)}" y="${height - 19}" text-anchor="middle">${i + (xmax === 7 ? 1 : 0)}</text>`).join('') : Array.from({length: chart.id==='weekly'?8:5}, (_, i) => {const value = chart.id==='weekly'?i:xmin + (xmax - xmin) * i / 4;return `<text x="${x(value)}" y="${height - 19}" text-anchor="middle">${e(xlabel(value))}</text>`;}).join('');
  let marks = '';
  if (kind === 'line' || kind === 'dual') {
    const segments = new Map();for (const p of points) {const id = p.segment || p.series || 'main';if (!segments.has(id)) segments.set(id, []);segments.get(id).push(p);}
    for (const values of segments.values()) {values.sort((a, b) => a.x - b.x);marks += `<polyline points="${values.map(p => `${x(p.x)},${y(p.y)}`).join(' ')}" fill="none" stroke="${color(values[0])}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" ${values[0].projected?'stroke-dasharray="6 4"':''}/>`;}
    if (kind === 'dual') for(const values of segments.values()) marks += `<polyline points="${values.map(p => `${x(p.x)},${y((p.rightY || 0) / rightMax * ymax)}`).join(' ')}" fill="none" stroke="#efb66b" stroke-width="2" stroke-dasharray="6 4"/>`;
  }
  if (chart.fit && chart.fit.r2>=.3) {
    const y1 = chart.fit.intercept + chart.fit.slope * xmin, y2 = chart.fit.intercept + chart.fit.slope * xmax;
    marks += `<line x1="${x(xmin)}" y1="${y(y1)}" x2="${x(xmax)}" y2="${y(y2)}" stroke="#ffffff88" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  }
  const heatMax = Math.max(1, ...points.map(p => p.value || 0));
  if (kind === 'heatmap') {
    for (let row = 0; row < ymax; row++) {marks += `<text x="${left - 8}" y="${top + (row + .5) / ymax * h + 4}" text-anchor="end">${e((chart.rows?.[row] || '').slice(-10))}</text>`;
      for (let column = 0; column < xmax; column++) marks += `<rect x="${x(column) + 1}" y="${top + row / ymax * h + 1}" width="${w / xmax - 2}" height="${h / ymax - 2}" rx="3" fill="#ffffff05"/>`;
    }
  }
  points.forEach((p, index) => {
    const xx = x(p.x), yy = y(p.y), fill = color(p), title = e(quotaPointText(p, chart, t));let mark;
    if (kind === 'heatmap') mark = `<rect x="${x(p.x) + 1}" y="${top + p.y / ymax * h + 1}" width="${w / xmax - 2}" height="${h / ymax - 2}" rx="3" fill="#6da0ff" fill-opacity="${.15 + .85 * p.value / heatMax}"/>`;
    else if (kind === 'bar') {const bw = Math.max(2, Math.min(32, w / Math.max(1, points.length) * .7));mark = `<rect x="${xx - bw / 2}" y="${yy}" width="${bw}" height="${Math.max(1, top + h - yy)}" rx="3" fill="${fill}" fill-opacity=".85"/>`;}
    else if (kind === 'box') mark = `<path d="M${xx} ${y(p.low)}V${y(p.high)}M${xx - 8} ${y(p.low)}h16M${xx - 8} ${y(p.high)}h16" stroke="${fill}"/><rect x="${xx - 13}" y="${y(p.q3)}" width="26" height="${Math.max(1, y(p.q1) - y(p.q3))}" fill="${fill}" fill-opacity=".35" stroke="${fill}"/><line x1="${xx - 13}" x2="${xx + 13}" y1="${yy}" y2="${yy}" stroke="white"/>`;
    else mark = `<circle cx="${xx}" cy="${yy}" r="${kind === 'scatter' ? 3 : 1}" fill="${fill}" fill-opacity=".8"/><circle cx="${xx}" cy="${yy}" r="9" fill="transparent"/>`;
    marks += `<g tabindex="0" data-qa-point="${index}" data-qa-x="${kind==='heatmap'?x(p.x+.5):xx}" data-qa-y="${kind==='heatmap'?top+(p.y+.5)/ymax*h:yy}" data-qa-color="${fill}" data-detail="${title}">${mark}</g>`;
  });
  return `<svg class="qa-chart" viewBox="0 0 ${width} ${height}" data-qa-kind="${kind}" data-qa-left="${left}" data-qa-right="${width-right}" data-qa-top="${top}" data-qa-bottom="${top+h}" role="img" aria-label="${e(t(chart.title))}"><defs><clipPath id="clip-${chart.id}"><rect x="${kind==='heatmap'?0:left - 1}" y="${top}" width="${kind==='heatmap'?width:w + 2}" height="${h + 1}"/></clipPath></defs><g class="qa-axis">${grid}${ticks}</g><g clip-path="url(#clip-${chart.id})">${marks}</g><g class="qa-hover-guide" visibility="hidden" pointer-events="none" aria-hidden="true"><line y1="${top}" y2="${top+h}" stroke="#ffffff66" stroke-width="1" vector-effect="non-scaling-stroke"/><circle r="4" fill="#262626" stroke-width="2" vector-effect="non-scaling-stroke"/></g></svg>`;
}
function card(chart, context) {
  const {e, t,headerActions='',footer=''} = context, points = chart.points || [], groups = [...new Set(points.map(p => p.series).filter(Boolean))];
  const rows = chart.rows || [];
  const content = chart.kind === 'table' ? rows.length ? `<div class="table-scroll"><table><thead><tr><th>${e(t('类型'))}</th><th>${e(t('名称'))}</th><th>Token</th><th>${e(t('请求数'))}</th></tr></thead><tbody>${rows.map(p => `<tr><td>${e(t(p.category === 'chat' ? '对话' : p.category === 'project' ? '项目' : '日期'))}</td><td>${e(p.label)}</td><td class="num">${short(p.tokens)}</td><td class="num">${p.requests}</td></tr>`).join('')}</tbody></table></div>` : '' : points.length ? quotaChartSVG(chart, context) : '';
  return `<section class="qa-card ${chart.wide ? 'wide' : ''}" data-qa-chart="${chart.id}"><header><div class="qa-card-title"><h2>${e(t(chart.title))}</h2>${chart.guide?.length?`<details class="qa-help"><summary aria-label="${e(t('图表说明'))}">ⓘ</summary><div>${chart.guide.map(line=>`<p>${e(t(line))}</p>`).join('')}</div></details>`:''}</div><div class="qa-chart-options">${headerActions}<span class="tiny muted">${e(t(chart.yLabel))}</span></div></header>${content || `<div class="qa-empty">${e(t(chart.empty || '尚无足够的可比较记录'))}</div>`}${points.length ? `<div class="qa-axis-label">${e(t(chart.xLabel))}${chart.rightLabel ? ' · ' + e(t('右轴')) + ': ' + e(t(chart.rightLabel)) : ''}</div><div class="qa-chart-footer"><div class="qa-legend">${groups.slice(0, 8).map((name, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${e(t(name))}</span>`).join('')}</div>${footer}</div><div class="qa-readout" hidden></div>` : ''}${!points.length?footer:''}${chart.interpretation?`<p class="qa-interpretation">${e(t(chart.interpretation))}</p>`:''}${chart.reliability?`<p class="qa-reliability">${e(t(chart.reliability.label))}</p>`:''}${chart.summary?`<div class="qa-summary">${e(t('通常观测值'))} ${short(chart.summary.median)} · ${e(t('观测范围'))} ${short(chart.summary.min)}–${short(chart.summary.max)}</div>`:''}${chart.fit||chart.reliability?`<details class="qa-technical"><summary>${e(t('技术详情'))}</summary>${chart.fit?`<p>n=${chart.fit.count} · R²=${chart.fit.r2.toFixed(2)}</p>`:''}${chart.reliability?`<p>${e(t(chart.reliability.explanation))}</p><p>${e(t('可比较区间'))}: ${chart.reliability.samples}</p>`:''}</details>`:''}</section>`;
}
export function quotaAnalyticsView({report, section = 'overview', period = '', costPeriod = 'year', costMode = 'heatmap', analysisMode = 'simple', costDate = '', costStartText = '', costEndText = '', loading = false, error = '', days = 28, selectedScope = '', selectedModel = '',outlookStartText='',outlookEndText='',outlookMetric='cost',outlookOverlay=true,outlookOverlayCount=6,outlookSmoothing=0,forecastOverlay=false, e, t}) {
  const overview = report?.overview || {}, group = report?.sections.find(p => p.id === section) || report?.sections[0];
  const metric = (title, value, note = '') => `<div class="qa-metric"><span>${e(t(title))}</span><strong class="num">${e(value)}</strong>${note?`<small class="qa-reliability">${e(t(note))}</small>`:''}</div>`;
  const pending = report?.quality.progress?.pending || 0;
  const weekly = report?.capabilities?.weekly ?? true, five = report?.capabilities?.fiveHour ?? true;
  const advanced=analysisMode==='advanced';
  const chartIds=advanced?(group?.chartIds||[]):(report?.simpleChartIds||['weekly','windows','weeks','ranking']);
  const metrics = [weekly && metric('Weekly 已用', overview.weeklyUsed == null ? '—' : short(overview.weeklyUsed) + '%'), five && metric('5h 已用', overview.fiveUsed == null ? '—' : short(overview.fiveUsed) + '%'), metric('本周期本机 Token', short(overview.tokens)), weekly && advanced && metric('每 1% 每周额度对应 Token', short(overview.tokensPerPP),report?.reliability?.label||'仅供参考')].filter(Boolean);
  const heading = `<header class="qa-heading"><div class="row between"><button data-action="qa-close">← ${e(t('返回预算'))}</button><button data-action="qa-refresh" ${loading?'disabled':''}>↻ ${e(t(loading?'正在读取…':'刷新'))}</button></div></header><h1>${e(t('额度预测'))}</h1>`;
  const errors = error ? `<div class="banner-error" role="alert">${e(error)}</div>` : '';
  const pools = report?.dashboard?.pools || [];
  const outlook = `${pools.length>1?`<label class="qa-pool-label">${e(t('额度类型'))}<select id="qa-outlook-pool">${pools.map(p=>`<option value="${e(p.id)}" ${p.id===report.dashboard.pool?'selected':''}>${e(p.label)}</option>`).join('')}</select></label>`:''}${report?quotaOutlookView({report,period,e,t,renderChart:card,metric:outlookMetric,overlay:outlookOverlay,overlayCount:outlookOverlayCount,smoothing:outlookSmoothing,forecastOverlay,startText:outlookStartText,endText:outlookEndText}):`<div class="qa-empty">${e(t('正在读取额度历史…'))}</div>`}`;
  return `<section class="quota-analytics content" aria-label="${e(t('额度分析'))}">${heading}${errors}${outlook}<div class="qa-analysis-heading row between"><h2>${e(t('使用分析'))}</h2><nav class="qa-tabs" aria-label="${e(t('分析模式'))}">${[['simple','简洁模式'],['advanced','高级分析']].map(([id,label])=>`<button data-action="qa-mode" data-mode="${id}" class="${analysisMode===id?'active':''}" aria-pressed="${analysisMode===id}">${e(t(label))}</button>`).join('')}</nav></div><div class="qa-filters"><label>${e(t('模型'))}<select id="qa-model"><option value="" ${!selectedModel?'selected':''}>${e(t('全部模型'))}</option>${(report?.models||[]).map(p=>`<option value="${e(p.id)}" ${p.id===selectedModel?'selected':''}>${e(p.label)}</option>`).join('')}${selectedModel&&!(report?.models||[]).some(p=>p.id===selectedModel)?`<option value="${e(selectedModel)}" selected>${e(selectedModel)}</option>`:''}</select></label><label>${e(t('记录来源'))}<select id="qa-scope"><option value="" ${!selectedScope ? 'selected' : ''}>${e(t('自动'))}${report?.selection?.label ? ' · ' + e(t(report.selection.label)) : ''}</option>${(report?.scopes || []).map(p => `<option value="${e(p.id)}" ${p.id === selectedScope ? 'selected' : ''}>${e(t(p.label))}</option>`).join('')}</select></label><label>${e(t('额度类型'))}<select id="qa-pool">${(report?.pools || []).map(p => `<option value="${e(p.id)}" ${p.id === report.pool ? 'selected' : ''}>${e(p.label)}</option>`).join('')}</select></label><label>${e(t('时间范围'))}<select id="qa-days">${[28, 56, 84].map(n => `<option value="${n}" ${n === days ? 'selected' : ''}>${n / 7} ${e(t('周'))}</option>`).join('')}</select></label></div>${report?.modelNotice?`<p class="qa-model-notice tiny muted">${e(t(report.modelNotice))}</p>`:''}${pending ? `<div class="qa-progress" role="status">${e(t('正在增量导入历史'))} · ${pending} ${e(t('个文件待处理'))}</div>` : ''}<div class="qa-overview" style="--metric-count:${metrics.length}">${metrics.join('')}</div>${costCalendarView(report?.costCalendar,costPeriod,{e,t,mode:costMode,costDate,costStartText,costEndText,renderChart:c=>quotaChartSVG(c,{e,t})})}${overview.largestWindow ? `<div class="qa-highlight">${e(t('观测消耗最高窗口'))} · ${e(overview.largestWindow.label)} · ${short(overview.largestWindow.weeklyPP)} pp</div>` : ''}${advanced?`<nav class="qa-tabs" aria-label="${e(t('分析分类'))}">${(report?.sections || [{id: 'overview', title: '概览'}]).map(p => `<button data-action="qa-section" data-section="${p.id}" class="${section === p.id ? 'active' : ''}" aria-pressed="${section === p.id}">${e(t(p.title))}</button>`).join('')}</nav>`:''}${report ? `<div class="qa-grid">${chartIds.map(id => report.charts.find(p => p.id === id)).filter(Boolean).map(c => card(c, {e, t})).join('')}</div><details class="qa-quality"><summary>${e(t('数据覆盖与口径'))} · ${report.quality.snapshots} ${e(t('次额度观测'))}</summary>${report.quality.notes.map(n => `<p>${e(t(n))}</p>`).join('')}<p>${e(t('可比较区间'))}: ${report.quality.comparableIntervals} · ${e(t('重置或断档'))}: ${report.quality.discontinuities} · ${e(report.timeZone)}</p></details>` : `<div class="qa-empty">${e(t(loading ? '正在读取额度历史…' : '刷新以读取额度历史'))}</div>`}</section>`;
}
let bindings;
export function bindQuotaAnalytics(root) {
  bindings?.abort();bindings=new AbortController();const {signal}=bindings;
  let activeChart, pointCache=new WeakMap();
  const clearGuide=()=>{activeChart?.querySelector('.qa-hover-guide')?.setAttribute('visibility','hidden');activeChart=null;};
  const hide=()=>{document.getElementById('qa-hover-tooltip')?.remove();clearGuide();};hide();
  if(!root.querySelector('.quota-analytics'))return;
  let quietUntil=0;
  const show=event=>{
    if(performance.now()<quietUntil)return;
    const svg=event.target.closest('.qa-chart');
    let point=event.target.closest('[data-detail]');
    if(svg){
      let candidates=pointCache.get(svg);if(!candidates){candidates=[...svg.querySelectorAll('[data-qa-point]')];pointCache.set(svg,candidates);}
      if(event.type==='pointermove'){
        const matrix=svg.getScreenCTM();if(!matrix){hide();return;}
        const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
        if(local.x<+svg.dataset.qaLeft||local.x>+svg.dataset.qaRight||local.y<+svg.dataset.qaTop||local.y>+svg.dataset.qaBottom){hide();return;}
        const byX=['line','dual','bar'].includes(svg.dataset.qaKind);
        let best=Infinity,bestY=Infinity;
        for(const candidate of candidates){const dx=+candidate.dataset.qaX-local.x,dy=+candidate.dataset.qaY-local.y,distance=dx*dx+(byX?0:dy*dy);if(distance<best||(distance===best&&Math.abs(dy)<bestY)){point=candidate;best=distance;bestY=Math.abs(dy);}}
      }
      if(point){
        if(activeChart!==svg)clearGuide();activeChart=svg;
        const guide=svg.querySelector('.qa-hover-guide'),line=guide.querySelector('line'),dot=guide.querySelector('circle');
        guide.setAttribute('visibility','visible');line.setAttribute('x1',point.dataset.qaX);line.setAttribute('x2',point.dataset.qaX);
        dot.setAttribute('cx',point.dataset.qaX);dot.setAttribute('cy',point.dataset.qaY);dot.setAttribute('stroke',point.dataset.qaColor);
      }
    }else clearGuide();
    if(!point){hide();return;}
    const card=point.closest('.qa-card'),readout=card?.querySelector('.qa-readout');if(readout)readout.textContent=point.dataset.detail;
    let node=document.getElementById('qa-hover-tooltip');if(!node){node=document.createElement('div');node.id='qa-hover-tooltip';node.className='chart-hover-tooltip';document.body.append(node);}
    if(node.dataset.detail!==point.dataset.detail){node.dataset.detail=point.dataset.detail;node.replaceChildren();const rows=point.dataset.detail.split(' · '),heading=document.createElement('strong');heading.textContent=rows.shift();node.append(heading);
    const metrics=document.createElement('div');metrics.className='chart-tooltip-metrics';
    for(const row of rows){const item=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong'),split=row.indexOf(': ');label.textContent=split>=0?row.slice(0,split):'';value.textContent=split>=0?row.slice(split+2):row;item.append(label,value);metrics.append(item);}node.append(metrics);}
    const rect=point.getBoundingClientRect(),px=event.clientX??rect.right,py=event.clientY??rect.bottom,{width,height}=node.getBoundingClientRect();
    node.style.left=Math.max(12,Math.min(px+18+width>innerWidth?px-width-18:px+18,innerWidth-width-12))+'px';node.style.top=Math.max(12,Math.min(py+18+height>innerHeight?py-height-18:py+18,innerHeight-height-12))+'px';
  };
  root.addEventListener('pointermove',show,{signal});root.addEventListener('focusin',show,{signal});root.addEventListener('focusout',hide,{signal});root.addEventListener('pointerleave',hide,{signal});
  document.addEventListener('scroll',()=>{quietUntil=performance.now()+180;hide();},{capture:true,passive:true,signal});
  document.addEventListener('wheel',()=>{quietUntil=performance.now()+180;hide();},{capture:true,passive:true,signal});
  window.addEventListener('blur',hide,{signal});window.addEventListener('resize',hide,{signal});
}
