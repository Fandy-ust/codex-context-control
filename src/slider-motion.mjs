export const SLIDER_MOTION_SECONDS=32;
export function sliderMotion({compact,window},maximum){
  const ratio=value=>Math.max(0,Math.min(1,Number.isFinite(value)&&maximum>0?value/maximum:0));
  const intensity=.8*ratio(compact)+.2*ratio(window);
  const rate=1+5*intensity**2;
  return {intensity,count:Math.round(6+38*intensity),duration:SLIDER_MOTION_SECONDS/rate,rate};
}
