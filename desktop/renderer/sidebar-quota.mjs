import {selectedQuota,quotaWindows,quotaStale,quotaLevel,quotaCountdown} from '../../src/quota-display.mjs';
import {creditRemaining} from '../../src/credit-baseline.mjs';

export function sidebarCredits({quota,pool,available=true,observation,t,escape:e,readOnly=false}){
  const bucket=selectedQuota(quota,pool),raw=bucket?.creditBalance;
  const known=raw!=null&&/^\d+(?:\.\d+)?$/.test(String(raw))&&Number.isFinite(Number(raw));
  if(!known&&!bucket?.unlimitedCredits)return '';
  const unlimited=bucket?.unlimitedCredits===true;
  const [integer,fraction]=String(raw).split('.');
  const full=unlimited?t('不限量','Unlimited'):integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');
  const short=unlimited?'∞':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(raw));
  const stale=quotaStale(quota,available),label=`Credits: ${full}${stale?' · '+t('上次记录，待刷新','Cached observation; refresh needed'):''}`;
  const remaining=unlimited?100:creditRemaining(raw,observation);
  const outline=quotaOutlinePath(44,44);
  const ring=`<svg class="quota-outline" data-remaining="${remaining}" viewBox="0 0 44 44" aria-hidden="true"><path class="quota-outline-track" d="${outline}"/><path class="quota-outline-value" d="${outline}" pathLength="100" stroke-dasharray="${remaining} 100" ${remaining===0?'visibility="hidden"':''}/><circle class="quota-outline-dot" r="2.5" ${remaining===0?'visibility="hidden"':''}/></svg>`;
  const tag=readOnly?'div':'button';
  return `<${tag} class="sidebar-credits ${quotaLevel(remaining)} ${stale?'stale':''}" ${readOnly?'role="img"':'data-action="quota-details" aria-haspopup="dialog"'} aria-label="${e(label)}" title="${e(label)}">${ring}<span>Credits</span><strong class="num">${e(short)}</strong></${tag}>`;
}

// A capsule whose 0/100% point is top center, travelling clockwise.
export function quotaOutlinePath(width,height){
  const inset=1.5,left=inset,top=inset,right=width-inset,bottom=height-inset,r=Math.max(0,Math.min((width-2*inset)/2,(height-2*inset)/2)),mid=width/2;
  return `M ${mid} ${top} H ${right-r} A ${r} ${r} 0 0 1 ${right-r} ${bottom} H ${left+r} A ${r} ${r} 0 0 1 ${left+r} ${top} H ${mid}`;
}

export function resizeQuotaOutline(svg){
  const {width,height}=svg.getBoundingClientRect();if(width<2||height<2)return;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  for(const path of svg.querySelectorAll('path'))path.setAttribute('d',quotaOutlinePath(width,height));
  const progress=svg.querySelector('.quota-outline-value'),dot=svg.querySelector('.quota-outline-dot');
  if(progress&&dot){const point=progress.getPointAtLength(progress.getTotalLength()*Number(svg.dataset.remaining)/100);dot.setAttribute('cx',String(point.x));dot.setAttribute('cy',String(point.y));}
}

export function quotaReset(window,{t,escape:e,language='zh',compact=false}){
  if(!window.resetsAt)return `<span>${e(t('重置时间暂不可用','Reset time unavailable'))}</span>`;
  const date=new Date(window.resetsAt*1000),locale=language==='zh'?'zh-CN':'en-US';
  const absolute=date.toLocaleString(locale,{...(compact&&window.windowDurationMins===300?{}:{month:'numeric',day:'numeric'}),hour:'2-digit',minute:'2-digit',hour12:false}).replace(',', '');
  return `<span title="${e(date.toLocaleString(locale))}">${e(compact?absolute:t('重置：{0}','Resets: {0}',absolute))}</span><span data-quota-reset="${window.resetsAt}" ${compact?'data-quota-compact="true"':''}>${e(quotaCountdown(window.resetsAt,t,Date.now(),compact))}</span>`;
}

export function quotaPeriod(window,t){
  const minutes=window.windowDurationMins;
  return minutes===10080?t('每周','Weekly'):!minutes?t('额度周期','Quota period'):minutes%1440===0?t('{0}天','{0} days',minutes/1440):minutes%60===0?t('{0}小时','{0} hours',minutes/60):t('{0}分钟','{0} minutes',minutes);
}

export function sidebarQuota({quota,pool,available=true,t,escape:e,language='zh',cached=false,readOnly=false}){
  const bucket=selectedQuota(quota,pool),windows=quotaWindows(bucket),stale=quotaStale(quota,available);
  const label=t('账户剩余额度','Remaining account quota');
  const rows=windows.map(window=>{
    const remaining=Math.max(0,Math.min(100,window.remainingPercent));
    const reset=window.resetsAt?t('重置：{0}','Resets: {0}',new Date(window.resetsAt*1000).toLocaleString(language==='zh'?'zh-CN':'en-US')):t('重置时间暂不可用','Reset time unavailable');
    const outline=quotaOutlinePath(180,44);
    return `<span class="sidebar-quota-window ${quotaLevel(remaining)}" title="${e(reset)}"><svg class="quota-outline" data-remaining="${remaining}" viewBox="0 0 180 44" preserveAspectRatio="none" aria-hidden="true"><path class="quota-outline-track" d="${outline}"/><path class="quota-outline-value" d="${outline}" pathLength="100" stroke-dasharray="${remaining} 100" ${remaining===0?'visibility="hidden"':''}/><circle class="quota-outline-dot" r="2.5" ${remaining===0?'visibility="hidden"':''}/></svg><span class="sidebar-quota-label"><span>${e(quotaPeriod(window,t))}</span><strong class="num">${Math.round(remaining)}%</strong></span><span class="quota-reset">${quotaReset(window,{t,escape:e,language,compact:true})}</span></span>`;
  }).join('');
  const empty=quota?.loading?t('正在读取额度…','Reading quota…'):bucket?.unlimitedCredits?t('额外额度不限量','Unlimited extra credits'):bucket?.creditBalance!=null?t('额外额度：{0}','Extra credits: {0}',bucket.creditBalance):bucket?.hasCredits?t('额外额度可用','Extra credits available'):t('额度暂不可用','Quota unavailable');
  const tag=readOnly?'div':'button';
  return `<${tag} class="sidebar-quota ${windows.length>1?'multiple':'single'} ${stale&&!cached?'stale':''}" ${readOnly?'role="group"':'data-action="quota-details" aria-haspopup="dialog"'} aria-label="${e(label)}" title="${e(bucket?.name||label)}">${rows||`<span class="sidebar-quota-empty">${e(empty)}</span>`}${stale&&bucket&&!cached?`<span class="sidebar-quota-stale">${e(t('上次记录，待刷新','Cached observation; refresh needed'))}</span>`:''}</${tag}>`;
}

export function accountQuotaSummary(options){
  const value={...options,quota:{...options.quota,stale:false,loading:false},readOnly:true,cached:true};
  return `<div class="sidebar-footer-row">${sidebarCredits({...value,observation:options.quota?.creditBaselines?.[selectedQuota(options.quota,options.pool)?.id]})}${sidebarQuota(value)}</div>`;
}

export function sidebarAccounts(options){
  const {quota,pool,t,escape:e}=options;
  const accounts=[...(quota?.accounts||[])].filter(a=>a.showQuota!==false).sort((a,b)=>Number(b.current)-Number(a.current));
  const row=(value,cached=false)=>sidebarCredits({...options,quota:value,observation:value?.creditBaselines?.[selectedQuota(value,pool)?.id]??(cached?undefined:options.observation)})+sidebarQuota({...options,quota:value,cached});
  if(!accounts.length)return quota?.accounts?.length?'':`<div class="sidebar-footer-row">${row(quota)}</div>`;
  return `<div class="sidebar-account-list">${accounts.map(account=>{
    const current=account.current, value=current?{...quota,buckets:quota.buckets?.length?quota.buckets:account.buckets,creditBaselines:account.creditBaselines}: {...account,stale:false,loading:false};
    const label=account.label||account.scope.slice(-8),observed=account.updatedAt?new Date(account.updatedAt).toLocaleString():'';
    const switchLabel=t('快速切换到 {0}','Quick switch to {0}',label);
    const quick=account.loginId&&!current?`<button class="sidebar-account-switch" data-action="login-switch" data-id="${e(account.loginId)}" data-name="${e(label)}" ${quota.accountSwitchBusy?'disabled':''} aria-label="${e(switchLabel)}" title="${e(switchLabel)}">⇄</button>`:'';
    return `<div class="sidebar-account ${current?'current':'inactive'}"><div class="sidebar-account-name" title="${e(label+(current?' · '+t('当前登录','Signed in'):' · '+t(account.remote?'其他设备同步缓存':'上次记录，待刷新',account.remote?'Cached observation from another device':'Cached observation; refresh needed')+' '+(account.sourceName||'')+' '+observed))}">${current?'<i aria-hidden="true"></i>':''}<span>${e(label)}${account.remote?' <small aria-hidden="true">☁</small>':''}</span>${quick}</div><div class="sidebar-footer-row">${row(value,!current)}</div></div>`;
  }).join('')}</div>`;
}
