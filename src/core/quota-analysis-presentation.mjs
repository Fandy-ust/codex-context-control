import {distribution} from './quota-statistics.mjs';

export function quotaReliability(intervals,{unknownAccount=false,pending=0}={}) {
  const values=intervals.filter(p=>p.tokens>0&&p.pp>=1),d=distribution(values.map(p=>p.tokens/p.pp));
  const estimated=values.filter(p=>p.estimated).length;
  const limited=unknownAccount||pending>0||estimated>0;
  const stable=values.length>=20&&!limited&&d?.q1>0&&d.q3/d.q1<=1.5;
  return {level:values.length<5?'insufficient':stable?'consistent':'limited',
    label:values.length<5?'数据不足':stable?'观测较稳定，仍非固定兑换率':'可信程度有限，仅供参考',
    explanation:values.length<5?'可比较记录太少，暂不能据此判断消耗规律。':limited?'断档、导入未完成或账户未识别会影响换算。':'百分比取整、缓存比例和任务差异会影响换算，不能视为官方兑换率。',
    samples:values.length,estimatedIntervals:estimated};
}
export function annotateQuotaCharts(charts) {
  for(const chart of charts){
    if(chart.fit)chart.interpretation=chart.fit.count<10?'观测样本较少，暂时不能可靠判断规律。':chart.fit.r2<0.3?'目前 Token 数量无法可靠预测额度消耗':chart.fit.r2<0.7?'Token 数量与额度消耗有一定关联，预测仍有较大误差':'这些记录中 Token 与额度变化较一致，仍不代表固定兑换率';
    else if(['weekly-scatter','five-hour-scatter'].includes(chart.id))chart.interpretation='目前 Token 数量无法可靠预测额度消耗';
  }
}
