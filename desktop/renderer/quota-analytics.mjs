const COLORS = ['#6da0ff', '#c695ff', '#59c9b1', '#efb66b', '#e87e98', '#9da6b7'];
const safe = n => Number.isFinite(n) ? n : 0;
const span = (a, b) => a === b ? [Math.min(0, a), b || 1] : [a, b];
const short = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + 'K' : Number(n.toFixed(2)).toLocaleString();
export function quotaPointText(point, chart, t) {
  const rows = [point.label, point.series ? t(point.series) : null,
    `${t(chart.yLabel)}: ${short(chart.kind === 'heatmap' ? point.value : point.y)}`];
  if (point.at) rows.push(new Date(point.at).toLocaleString());
  if (point.tokens != null) rows.push(`Token: ${short(point.tokens)}`);
  if (point.weeklyPP != null) rows.push(`Weekly: ${short(point.weeklyPP)} pp`);
  if (point.fivePP != null) rows.push(`5h: ${short(point.fivePP)} pp`);
  if (point.weeklyPP >= 1 && point.tokens > 0) rows.push(`Token / pp: ${short((point.alignedTokens ?? point.tokens) / point.weeklyPP)}`);
  if (point.cacheRate != null) rows.push(`${t('缓存占比')}: ${Math.round(point.cacheRate * 100)}%`);
  if (point.partial) rows.push(t('部分窗口'));
  return rows.filter(Boolean).join(' · ');
}
export function quotaChartSVG(chart, {e, t}) {
  const points = chart.points || [], width = 640, height = chart.kind === 'heatmap' ? Math.min(380, Math.max(230, (chart.rows?.length || 4) * 15 + 52)) : 230;
  const left = chart.kind === 'heatmap' ? 80 : 56, top = 14, right = chart.kind === 'dual' ? 54 : 18, bottom = 40;
  const w = width - left - right, h = height - top - bottom, kind = chart.kind;
  const xs = points.map(p => p.x), ys = points.flatMap(p => [p.y, p.high || 0]);
  let [xmin, xmax] = span(Math.min(...xs), Math.max(...xs)), [ymin, ymax] = span(0, Math.max(...ys));
  if (kind === 'bar' || kind === 'box') {xmin = -.6;xmax = Math.max(.6, points.length - .4);}
  if (chart.xMax != null) {xmin = 0;xmax = chart.xMax;}
  if (chart.yMax != null) ymax = chart.yMax;
  if (kind === 'heatmap') {xmin = 0;xmax = chart.xMax || 7;ymin = 0;ymax = Math.max(1, chart.rows?.length || 1);}
  const x = value => left + (value - xmin) / (xmax - xmin) * w;
  const y = value => top + h - (value - ymin) / (ymax - ymin) * h;
  const groups = [...new Set(points.map(p => p.series || ''))], color = p => COLORS[Math.max(0, groups.indexOf(p.series || '')) % COLORS.length];
  const rightMax = Math.max(1, ...points.map(p => p.rightY || 0));
  const dateX = kind === 'dual';
  const xlabel = value => dateX ? new Date(value).toLocaleDateString(undefined, {month: 'numeric', day: 'numeric'}) : short(value);
  const grid = kind === 'heatmap' ? '' : Array.from({length: 5}, (_, i) => {
    const value = ymax * i / 4, yy = y(value);
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="#ffffff10"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end">${e(short(value))}</text>${kind === 'dual' ? `<text x="${width - right + 8}" y="${yy + 4}" fill="#efb66b">${short(rightMax * i / 4)}</text>` : ''}`;
  }).join('');
  const ticks = kind === 'bar' || kind === 'box' ? points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 7)) === 0).map(p => `<text x="${x(p.x)}" y="${height - 19}" text-anchor="middle">${e((p.label || short(p.x)).slice(0, 14))}</text>`).join('') : kind === 'heatmap' ? Array.from({length: xmax}, (_, i) => `<text x="${x(i + .5)}" y="${height - 19}" text-anchor="middle">${i + (xmax === 7 ? 1 : 0)}</text>`).join('') : Array.from({length: 5}, (_, i) => {const value = xmin + (xmax - xmin) * i / 4;return `<text x="${x(value)}" y="${height - 19}" text-anchor="middle">${e(xlabel(value))}</text>`;}).join('');
  let marks = '';
  if (kind === 'line' || kind === 'dual') {
    const segments = new Map();for (const p of points) {const id = p.segment || p.series || 'main';if (!segments.has(id)) segments.set(id, []);segments.get(id).push(p);}
    for (const values of segments.values()) {values.sort((a, b) => a.x - b.x);marks += `<polyline points="${values.map(p => `${x(p.x)},${y(p.y)}`).join(' ')}" fill="none" stroke="${color(values[0])}" stroke-width="2.5" stroke-linejoin="round"/>`;}
    if (kind === 'dual') for(const values of segments.values()) marks += `<polyline points="${values.map(p => `${x(p.x)},${y((p.rightY || 0) / rightMax * ymax)}`).join(' ')}" fill="none" stroke="#efb66b" stroke-width="2" stroke-dasharray="6 4"/>`;
  }
  if (chart.fit) {
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
    else mark = `<circle cx="${xx}" cy="${yy}" r="${kind === 'scatter' ? 4 : 2.5}" fill="${fill}" fill-opacity=".8"/><circle cx="${xx}" cy="${yy}" r="9" fill="transparent"/>`;
    marks += `<g data-qa-point="${index}" data-detail="${title}">${mark}<title>${title}</title></g>`;
  });
  return `<svg class="qa-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(t(chart.title))}"><defs><clipPath id="clip-${chart.id}"><rect x="${kind==='heatmap'?0:left - 1}" y="${top}" width="${kind==='heatmap'?width:w + 2}" height="${h + 1}"/></clipPath></defs><g class="qa-axis">${grid}${ticks}</g><g clip-path="url(#clip-${chart.id})">${marks}</g></svg>`;
}
function card(chart, context) {
  const {e, t} = context, points = chart.points || [], groups = [...new Set(points.map(p => p.series).filter(Boolean))];
  const rows = chart.rows || [];
  const content = chart.kind === 'table' ? rows.length ? `<div class="table-scroll"><table><thead><tr><th>${e(t('类型'))}</th><th>${e(t('名称'))}</th><th>Token</th><th>${e(t('请求数'))}</th></tr></thead><tbody>${rows.map(p => `<tr><td>${e(t(p.category === 'chat' ? '对话' : p.category === 'project' ? '项目' : '日期'))}</td><td>${e(p.label)}</td><td class="num">${short(p.tokens)}</td><td class="num">${p.requests}</td></tr>`).join('')}</tbody></table></div>` : '' : points.length ? quotaChartSVG(chart, context) : '';
  return `<section class="qa-card ${chart.wide ? 'wide' : ''}" data-qa-chart="${chart.id}"><header><h2>${e(t(chart.title))}</h2><span class="tiny muted">${e(t(chart.yLabel))}</span></header>${content || `<div class="qa-empty">${e(t(chart.empty || '尚无足够的可比较记录'))}</div>`}${points.length ? `<div class="qa-axis-label">${e(t(chart.xLabel))}${chart.rightLabel ? ' · ' + e(t('右轴')) + ': ' + e(t(chart.rightLabel)) : ''}</div><div class="qa-legend">${groups.slice(0, 8).map((name, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${e(t(name))}</span>`).join('')}</div><div class="qa-readout" aria-live="polite">${e(t('悬停查看观测值'))}</div>` : ''}${chart.fit ? `<div class="tiny muted">${e(t('经验拟合'))} · n=${chart.fit.count} · R²=${chart.fit.r2.toFixed(2)}</div>` : ''}${chart.summary ? `<div class="qa-summary">${e(t('中位数'))} ${short(chart.summary.median)} · ${e(t('范围'))} ${short(chart.summary.min)}–${short(chart.summary.max)}</div>` : ''}${chart.note ? `<details class="qa-note"><summary>${e(t('数据说明'))}</summary><p>${e(t(chart.note))}</p>${points.length ? `<div class="table-scroll"><table><tbody>${points.slice(-60).map(p => `<tr><td>${e(quotaPointText(p, chart, t))}</td></tr>`).join('')}</tbody></table></div>` : ''}</details>` : ''}</section>`;
}
export function quotaAnalyticsView({report, section = 'overview', loading = false, error = '', days = 28, e, t}) {
  const overview = report?.overview || {}, group = report?.sections.find(p => p.id === section) || report?.sections[0];
  const metric = (title, value) => `<div class="qa-metric"><span>${e(t(title))}</span><strong class="num">${e(value)}</strong></div>`;
  const pending = report?.quality.progress?.pending || 0;
  return `<section class="quota-analytics content" aria-label="${e(t('额度分析'))}"><header class="qa-heading"><div class="row between"><button data-action="qa-close">← ${e(t('返回预算'))}</button><button data-action="qa-refresh" ${loading ? 'disabled' : ''}>↻ ${e(t(loading ? '正在读取…' : '刷新'))}</button></div><h1>${e(t('额度分析'))}</h1><p class="muted">${e(t('账户额度变化 × 本机 Token 观测'))}</p>${overview.updatedAt?`<span class="tiny muted">${e(t('观测截止'))} · ${e(new Date(overview.updatedAt).toLocaleString())}</span>`:''}</header><div class="qa-filters"><label>${e(t('记录来源'))}<select id="qa-scope">${(report?.scopes || []).map(p => `<option value="${e(p.id)}" ${p.id === report.scope ? 'selected' : ''}>${e(t(p.label))}</option>`).join('')}</select></label><label>${e(t('额度类型'))}<select id="qa-pool">${(report?.pools || []).map(p => `<option value="${e(p.id)}" ${p.id === report.pool ? 'selected' : ''}>${e(p.label)}</option>`).join('')}</select></label><label>${e(t('时间范围'))}<select id="qa-days">${[28, 56, 84].map(n => `<option value="${n}" ${n === days ? 'selected' : ''}>${n / 7} ${e(t('周'))}</option>`).join('')}</select></label></div>${error ? `<div class="banner-error" role="alert">${e(error)}</div>` : ''}${pending ? `<div class="qa-progress" role="status">${e(t('正在增量导入历史'))} · ${pending} ${e(t('个文件待处理'))}</div>` : ''}<div class="qa-overview">${metric('Weekly 已用', overview.weeklyUsed == null ? '—' : short(overview.weeklyUsed) + '%')}${metric('5h 已用', overview.fiveUsed == null ? '—' : short(overview.fiveUsed) + '%')}${metric('本周期本机 Token', short(overview.tokens))}${metric('Token / Weekly 1%', short(overview.tokensPerPP))}</div>${overview.largestWindow ? `<div class="qa-highlight">${e(t('观测消耗最高窗口'))} · ${e(overview.largestWindow.label)} · ${short(overview.largestWindow.weeklyPP)} pp</div>` : ''}<nav class="qa-tabs" aria-label="${e(t('分析分类'))}">${(report?.sections || [{id: 'overview', title: '概览'}]).map(p => `<button data-action="qa-section" data-section="${p.id}" class="${section === p.id ? 'active' : ''}" aria-pressed="${section === p.id}">${e(t(p.title))}</button>`).join('')}</nav>${report ? `<div class="qa-grid">${(group?.chartIds || []).map(id => report.charts.find(p => p.id === id)).filter(Boolean).map(c => card(c, {e, t})).join('')}</div><details class="qa-quality"><summary>${e(t('数据覆盖与口径'))} · ${report.quality.snapshots} ${e(t('次额度观测'))}</summary>${report.quality.notes.map(n => `<p>${e(t(n))}</p>`).join('')}<p>${e(t('可比较区间'))}: ${report.quality.comparableIntervals} · ${e(t('重置或断档'))}: ${report.quality.discontinuities} · ${e(report.timeZone)}</p></details>` : `<div class="qa-empty">${e(t(loading ? '正在读取额度历史…' : '刷新以读取额度历史'))}</div>`}</section>`;
}
export function bindQuotaAnalytics(root) {
  for (const chart of root.querySelectorAll('.qa-card')) {
    chart.addEventListener('pointerover', event => {const point = event.target.closest('[data-detail]');const readout = chart.querySelector('.qa-readout');if (point && readout) readout.textContent = point.dataset.detail;});
  }
}
