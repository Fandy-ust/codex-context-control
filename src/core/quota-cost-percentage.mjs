import {finite,HOUR,lowerBound} from './quota-statistics.mjs';

// Match cumulative, rounded quota changes to local API estimates. Never divide
// by zero, join reset boundaries, or treat missing prices as free requests.
export function quotaCostPercentage(rows,requests,{role,start,end,timeAxis}) {
  const used=role+'Used',reset=role+'Reset';
  const valid=p=>finite(p[used])&&p[used]>=0&&p[used]<=100&&Number.isSafeInteger(p[reset])&&p[reset]>0;
  const source=[...new Map(requests.filter(r=>typeof r.id==='string'&&finite(r.at)&&r.at>start&&r.at<=end).map(r=>[r.id,r])).values()].sort((a,b)=>a.at-b.at);
  const points=[];let anchor=null,previous=null,segment=0,skipped=false;
  for(const row of rows){
    if(row.at<start||row.at>end)continue;
    if(!valid(row)){anchor=previous=null;segment++;continue;}
    if(!previous||row[reset]!==previous[reset]||row[used]<previous[used]||row.at<=previous.at||row.at-previous.at>HOUR/2){anchor=previous=row;segment++;continue;}
    const delta=Math.round((row[used]-anchor[used])*10000)/10000;
    if(delta>=1){
      const values=source.slice(lowerBound(source,anchor.at),lowerBound(source,row.at));
      if(values.length&&values.every(r=>finite(r.usd)&&r.usd>=0)){
        if(skipped){segment++;skipped=false;}
        const usd=values.reduce((total,r)=>total+r.usd,0),ratio=usd/delta;
        if(finite(ratio))points.push({id:'cost:'+role+':'+row.at,x:row.at,y:ratio,at:row.at,intervalStart:anchor.at,costUSD:usd,quotaPP:delta,series:'本机 API 估算',segment:'cost:'+segment});
      }else skipped=true;
      anchor=row;
    }
    previous=row;
  }
  return {id:'outlook-cost-'+role,title:'每消耗 1% 的预估费用',kind:'line',wide:true,xLabel:'时间',yLabel:'USD / 1%',timeAxis,xMin:start,xMax:end,
    yMax:Math.max(0.0001,points.reduce((max,p)=>Math.max(max,p.y),0)*1.1),points,empty:'暂无可比较的费用与额度记录',
    guide:['每个点：同一区间的本机 API 预估费用 ÷ 额度消耗百分点。','仅比较累计变化至少 1% 且费用完整的区间；重置、回退和断档分开显示。','仅含本机记录，可能遗漏其他设备的使用；仅供参考，不是订阅账单。']};
}
