export const timelinePlot=Object.freeze({width:720,height:130,padding:8});
const inset=timelinePlot.padding/timelinePlot.width;
export function timelineX(position,upperBound,width=timelinePlot.width){
  if(!Number.isFinite(position)||!Number.isFinite(upperBound)||upperBound<=0||!Number.isFinite(width)||width<=0)return null;
  return width*(inset+Math.max(0,Math.min(1,position/upperBound))*(1-2*inset));
}
export function timelinePosition(x,upperBound,width){
  if(!Number.isFinite(x)||!Number.isFinite(upperBound)||upperBound<=0||!Number.isFinite(width)||width<=0)return null;
  const left=width*inset,right=width*(1-inset);
  if(x<left||x>right)return null;
  return Math.max(0,Math.min(upperBound,(x-left)/(right-left)*upperBound));
}
