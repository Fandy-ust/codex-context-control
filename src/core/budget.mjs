import {tokenNumber} from './policy.mjs';

export function effectiveWindow(raw,percent){return Number(BigInt(raw)*BigInt(percent)/100n);}
export function ratioBasisPoints(value){
  const match=String(value).trim().match(/^(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/);
  if(!match)throw new Error('压缩比例请输入最多两位小数的百分比');
  const basisPoints=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  if(basisPoints<1||basisPoints>10000)throw new Error('压缩比例必须大于 0% 且不超过 100%');
  return basisPoints;
}
export function calculateBudget(input,model){
  const usableWindow=tokenNumber(input.usableWindow,'实际可用窗口');
  if(usableWindow<1000)throw new Error('实际可用窗口至少为 1,000 tokens');
  const percent=model?.effective_context_window_percent,maximum=model?.max_context_window;
  if(!Number.isInteger(percent)||percent<1||percent>100||!Number.isSafeInteger(maximum)||maximum<1)throw new Error('等待当前模型的可用比例与上限，暂不猜测换算');
  const maximumUsableWindow=effectiveWindow(maximum,percent);
  if(usableWindow>maximumUsableWindow)throw new Error(`当前模型最多可用 ${maximumUsableWindow.toLocaleString('en-US')} tokens`);
  const window=Number((BigInt(usableWindow)*100n+BigInt(percent)-1n)/BigInt(percent));
  const maximumCompact=Math.min(effectiveWindow(window,90),model.context_compact_ceiling??Number.MAX_SAFE_INTEGER);
  const maxBasisPoints=Math.min(10000,Number(((BigInt(maximumCompact)+1n)*10000n-1n)/BigInt(usableWindow)));
  const basisPoints=ratioBasisPoints(input.compactPercent??90);
  if(basisPoints>maxBasisPoints)throw new Error(`这个窗口最多可设置 ${maxBasisPoints/100}% 的压缩比例`);
  const compact=Number(BigInt(usableWindow)*BigInt(basisPoints)/10000n);
  return {usableWindow,window,compact,compactPercent:basisPoints/100,maximumUsableWindow,maxCompactPercent:maxBasisPoints/100,effectivePercent:percent};
}
export function savedBudget(policy,model){
  const percent=model?.effective_context_window_percent;
  if(!policy||!Number.isInteger(percent)||percent<1||percent>100)return null;
  const usableWindow=effectiveWindow(policy.window,percent);
  if(usableWindow<1)return null;
  const compact=Math.min(policy.compact,effectiveWindow(policy.window,90));
  return {usableWindow,compact,compactPercent:Math.round(compact/usableWindow*10000)/100};
}
