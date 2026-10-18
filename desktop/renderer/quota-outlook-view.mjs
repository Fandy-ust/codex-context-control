export function quotaDuration(hours, t) {
  if (hours == null || !Number.isFinite(hours)) return '—';
  const minutes = Math.max(0, Math.round(hours * 60));
  if (minutes < 1) return t('不足 1 分钟');
  const days = Math.floor(minutes / 1440), h = Math.floor(minutes % 1440 / 60), m = minutes % 60;
  return [days ? `${days} ${t('天')}` : '', h ? `${h} ${t('小时')}` : '', !days && m ? `${m} ${t('分钟')}` : ''].filter(Boolean).join(' ');
}
export function outlookMessage(period, t) {
  if (period.status === 'ready') return period.finishesBeforeReset
    ? period.hoursBeforeReset < 1/60 ? t('预计接近重置时用完') : `${t('预计提前')} ${quotaDuration(period.hoursBeforeReset, t)} ${t('用完')}`
    : `${t('预计重置时还有')} ${Number(period.projectedRemaining.toFixed(1))}% ${t('未使用')}`;
  return t({exhausted:'额度已用完，等待重置',stale:'观测已过期，刷新后再预测',awaiting_reset:'已到重置时间，等待新读数',unidentified:'账户尚未识别，暂时无法预测',flat:'近期额度读数未变，暂时无法预测',insufficient:'观测还不够，暂时无法预测'}[period.status] || '暂时无法预测');
}
export function quotaOutlookView({report, period, e, t, renderChart}) {
  const dashboard = report?.dashboard, periods = dashboard?.periods || [];
  if (!periods.length) return `<div class="qa-empty">${e(t('等待当前账户额度，历史记录可在高级分析查看'))}</div>`;
  const current = periods.find(p => p.id === period) || periods[0];
  const number = value => value == null ? '—' : Number(value.toFixed(1)) + '%';
  const metric = (label, value) => `<div><span>${e(t(label))}</span><strong>${e(value)}</strong></div>`;
  const cards = periods.map(p => `<article class="qa-outlook-card" data-qa-period="${p.id}"><header><h2>${e(t(p.title))}</h2><span title="${e(new Date(p.resetAt).toLocaleString())}">${e(quotaDuration(p.hoursUntilReset,t))} ${e(t('后重置'))}</span></header><div class="qa-outlook-metrics">${metric(['stale','awaiting_reset'].includes(p.status)?'上次剩余':'当前剩余', number(p.remainingPercent))}${metric('用完还需', quotaDuration(p.hoursRemaining,t))}${metric('重置时预计剩余', number(p.projectedRemaining))}</div><p class="qa-outlook-verdict ${p.finishesBeforeReset ? 'early' : ''}">${e(outlookMessage(p,t))}</p></article>`).join('');
  return `<div class="qa-outlook-cards">${cards}</div><div class="qa-outlook-heading"><span>${e(t('按近期速度估算，使用节奏变化后会更新'))}</span>${periods.length>1?`<nav class="qa-tabs" aria-label="${e(t('选择额度周期'))}">${periods.map(p=>`<button data-action="qa-period" data-period="${p.id}" class="${current.id===p.id?'active':''}" aria-pressed="${current.id===p.id}">${e(t(p.title))}</button>`).join('')}</nav>`:''}</div>${renderChart(current.chart,{e,t})}`;
}
