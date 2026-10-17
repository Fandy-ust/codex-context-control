export function sliderMotion({compact,window},maximum){
  const ratio=value=>Math.max(0,Math.min(1,Number.isFinite(value)&&maximum>0?value/maximum:0));
  const intensity=.8*ratio(compact)+.2*ratio(window);
  return {intensity,count:Math.round(6+38*intensity),duration:30-16*intensity};
}
