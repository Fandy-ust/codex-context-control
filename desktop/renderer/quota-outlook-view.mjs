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
export function depletionTimeText(period, t, now = Date.now()) {
  if(period.status!=='ready'||!period.finishesBeforeReset||!Number.isFinite(period.depletionAt))return '';
  const date=new Date(period.depletionAt),today=new Date(now),tomorrow=new Date(now);
  if(!Number.isFinite(date.getTime()))return '';
  tomorrow.setDate(tomorrow.getDate()+1);
  const sameDay=d=>date.toDateString()===d.toDateString();
  const day=sameDay(today)?t('今天'):sameDay(tomorrow)?t('明天'):date.toLocaleDateString(undefined,{year:'numeric',month:'numeric',day:'numeric'});
  return t(`预计 ${day} ${date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false})} 用完`);
}
export function quotaOutlookView({report, period, e, t, renderChart,metric='cost',overlay=true,overlayCount=6,smoothing=0,forecastOverlay=false,startText='',endText=''}) {
  const dashboard = report?.dashboard, periods = dashboard?.periods || [];
  const choices=[...periods,...(dashboard?.credits?[dashboard.credits]:[])];
  if (!choices.length) return `<div class="qa-empty">${e(t('等待当前账户额度，可在下方查看历史分析'))}</div>`;
  const current = choices.find(p => p.id === period) || choices[0];
  const overlapped=overlay&&current.id!=='credits';
  const chart=overlapped?(metric==='cost'?current.costOverlayChart:current.overlayChart)||current.chart:(metric==='cost'&&current.costChart?current.costChart:current.comparisonChart||current.chart);
  const picker=`<div class="qa-cycle-controls">${current.costChart?`<select class="qa-outlook-metric" id="outlook-metric" aria-label="${e(t('图表指标'))}"><option value="remaining" ${metric!=='cost'?'selected':''}>${e(t('剩余额度'))}</option><option value="cost" ${metric==='cost'?'selected':''}>${e(t('预估费用 / 1%'))}</option></select>`:''}<nav class="qa-tabs" aria-label="${e(t('选择额度周期'))}">${choices.map(p=>`<button data-action="qa-period" data-period="${p.id}" class="${current.id===p.id?'active':''}" aria-pressed="${current.id===p.id}">${p.id==='five'?'5hr':p.id==='weekly'?'Weekly':'Credits'}</button>`).join('')}</nav>${current.costChart?`<label class="qa-overlay-toggle"><input type="checkbox" role="switch" id="outlook-overlay" ${overlay?'checked':''}><span>${e(t('重叠'))}</span></label>${overlay?`<select id="outlook-overlay-count" class="qa-outlook-metric" aria-label="${e(t('重叠周期数'))}">${[3,6,12].map(n=>`<option value="${n}" ${n===overlayCount?'selected':''}>${n} ${e(t('周期'))}</option>`).join('')}</select>`:''}`:''}</div>`;
  const dateTime=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  const number = value => value == null ? '—' : Number(value.toFixed(1)) + '%';
  const stat = (label, value) => `<div><span>${e(t(label))}</span><strong>${e(value)}</strong></div>`;
  let cards = periods.map(p => `<article class="qa-outlook-card" data-qa-period="${p.id}"><header><h2>${e(t(p.title))}</h2><span title="${e(new Date(p.resetAt).toLocaleString())}">${e(quotaDuration(p.hoursUntilReset,t))} ${e(t('后重置'))}</span></header><div class="qa-outlook-metrics">${stat(['stale','awaiting_reset'].includes(p.status)?'上次剩余':'当前剩余', number(p.remainingPercent))}${stat('用完还需', quotaDuration(p.hoursRemaining,t))}${stat('重置时预计剩余', number(p.projectedRemaining))}</div><p class="qa-outlook-verdict ${p.finishesBeforeReset ? 'early' : ''}"><span>${e(outlookMessage(p,t))}</span>${depletionTimeText(p,t)?`<span class="qa-depletion-time">${e(depletionTimeText(p,t))}</span>`:''}</p></article>`).join('');
  if(dashboard?.credits)cards+=`<article class="qa-outlook-card" data-qa-credit data-qa-period="credits"><header><h2>Credits</h2></header><div class="qa-outlook-metrics">${stat('当前余额',dashboard.credits.balance.toLocaleString(undefined,{maximumFractionDigits:2}))}</div></article>`;
  const smoothingControl=current.id==='credits'?'':`<label class="qa-smoothing">${e(t('平滑'))}<select id="outlook-smoothing" aria-label="${e(t('平滑程度'))}" title="${e(t('仅平滑曲线，悬停显示原始观测'))}">${[0,3,5,9].map(n=>`<option value="${n}" ${n===smoothing?'selected':''}>${e(t(n===0?'关闭':n===3?'低':n===5?'中':'高'))}</option>`).join('')}</select></label>`;
  const dates=`${smoothingControl}<div class="compact-date-range qa-outlook-range"><input type="datetime-local" id="outlook-start" aria-label="${e(t('开始'))}" title="${e(t('开始'))}" value="${e(startText||dateTime(chart.rangeStart??current.chart.xMin))}"><span aria-hidden="true">–</span><input type="datetime-local" id="outlook-end" aria-label="${e(t('结束'))}" title="${e(t('结束'))}" value="${e(endText||dateTime(chart.rangeEnd??current.chart.xMax))}">${dashboard.customRange?`<button class="date-reset" data-action="outlook-cycle" title="${e(t('当前重置周期'))}" aria-label="${e(t('当前重置周期'))}">↶</button>`:''}</div>`;
  const forecastPicker=`<div class="qa-cycle-controls qa-forecast-controls"><nav class="qa-tabs" aria-label="${e(t('选择额度周期'))}">${choices.map(p=>`<button data-action="qa-period" data-period="${p.id}" class="${current.id===p.id?'active':''}">${p.id==='five'?'5hr':p.id==='weekly'?'Weekly':'Credits'}</button>`).join('')}</nav><label class="qa-overlay-toggle"><input type="checkbox" role="switch" id="forecast-overlay" ${forecastOverlay?'checked':''}><span>${e(t('重叠'))}</span></label>${forecastOverlay?`<select id="forecast-overlay-count" class="qa-outlook-metric" aria-label="${e(t('重叠周期数'))}">${[3,6,12].map(n=>`<option value="${n}" ${n===overlayCount?'selected':''}>${n} ${e(t('周期'))}</option>`).join('')}</select>`:''}</div>`;
  const forecast=renderChart(forecastOverlay&&current.id!=='credits'?(current.forecastOverlayChart||current.overlayChart||current.chart):current.chart,{e,t,headerActions:forecastPicker,...(current.id==='credits'?{footer:dates}:{})});
  const comparison=current.id==='credits'?'':renderChart({...chart,id:chart.id===current.chart.id?chart.id+'-comparison':chart.id},{e,t,headerActions:picker,footer:dates});
  return `<div class="qa-outlook-cards">${cards}</div>${forecast}${comparison}`;
}
