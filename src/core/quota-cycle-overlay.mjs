import {quotaCostPercentage} from './quota-cost-percentage.mjs';
import {HOUR,finite} from './quota-statistics.mjs';

export function quotaCycleOverlay(rows,requests,{role,duration,count=6,start,end,now,timeZone='UTC'}) {
  const groups=new Map(),reset=role+'Reset',used=role+'Used';
  for(const p of rows){
    if(!Number.isSafeInteger(p[reset])||!finite(p[used])||p[used]<0||p[used]>100)continue;
    const finish=p[reset]*1000,begin=finish-duration;
    if(p.at<begin||p.at>finish||start!=null&&p.at<start||end!=null&&p.at>end)continue;
    if(!groups.has(finish))groups.set(finish,[]);groups.get(finish).push(p);
  }
  const cycles=[...groups].sort((a,b)=>b[0]-a[0]).slice(0,count).reverse();
  const points=[],costPoints=[];const date=new Intl.DateTimeFormat('en-GB',{timeZone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(const [finish,values] of cycles){
    const begin=finish-duration,series=date.format(begin);let segment=0;
    for(let i=0;i<values.length;i++){
      const p=values[i];if(i&&(p.at-values[i-1].at>HOUR/2||p[used]<values[i-1][used]))segment++;
      points.push({id:role+':'+finish+':'+p.at,x:p.at-begin,y:100-p[used],at:p.at,series,segment:finish+':'+segment});
    }
    const cost=quotaCostPercentage(values,requests,{role,start:Math.max(begin,start??begin),end:Math.min(now,finish,end??finish),timeAxis:'elapsed'});
    costPoints.push(...cost.points.map(p=>({...p,x:p.at-begin,series,segment:finish+':'+p.segment})));
  }
  // Bound unchanged plateaus, retaining every observed percentage change.
  const bins=new Map();for(const p of points){const key=p.segment+':'+Math.floor(p.x/(role==='five'?60000:15*60000))+':'+p.y;if(!bins.has(key+':first'))bins.set(key+':first',p);bins.set(key+':last',p);}
  const visible=[...new Map([...bins.values()].map(p=>[p.id,p])).values()];
  const rangeStart=start??(cycles[0]?.[0]-duration),rangeEnd=end??cycles.at(-1)?.[0];
  const common={kind:'line',wide:true,xMin:0,xMax:duration,xLabel:'距周期开始',timeAxis:'elapsed',rangeStart:rangeStart??now-duration,rangeEnd:rangeEnd??now,cycleCount:cycles.length};
  const chart={...common,id:'outlook-overlay-'+role,title:'剩余额度走势',yLabel:'剩余 %',yMax:100,points:visible,empty:'所选范围暂无观测'};
  const costChart={...common,id:'outlook-cost-overlay-'+role,title:'每消耗 1% 的预估费用',yLabel:'USD / 1%',yMax:Math.max(.0001,costPoints.reduce((max,p)=>Math.max(max,p.y),0)*1.1),points:costPoints,empty:'暂无可比较的费用与额度记录',
    guide:['每个点：同一区间的本机 API 预估费用 ÷ 额度消耗百分点。','各条线按周期开始对齐；颜色代表不同周期。','仅含本机记录，可能遗漏其他设备的使用；仅供参考，不是订阅账单。']};
  return {chart,costChart};
}
