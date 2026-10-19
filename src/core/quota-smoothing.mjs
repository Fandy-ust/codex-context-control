// Trailing observations, isolated by series/segment. Raw readings remain available
// for hover details; this never changes forecasts or the persisted observations.
export function smoothQuotaChart(chart,window=0){
 if(![0,3,5,9].includes(window))throw Error('Invalid smoothing window');
 if(!window)return chart;
 const runs=new Map();
 return {...chart,points:chart.points.map(point=>{
  const key=JSON.stringify([point.series,point.segment]);const run=runs.get(key)??[];
  if(run.length&&point.x<run.at(-1).x)run.length=0;
  run.push(point);if(run.length>window)run.shift();runs.set(key,run);
  const weighted=run.every(p=>Number.isFinite(p.costUSD)&&p.quotaPP>0);
  const y=weighted?run.reduce((n,p)=>n+p.costUSD,0)/run.reduce((n,p)=>n+p.quotaPP,0):run.reduce((n,p)=>n+p.y,0)/run.length;
  return {...point,rawY:point.y,y};
 })};
}
