import {DAY} from './quota-statistics.mjs';

// Costs come from the existing API price estimator in the worker layer.
export function tokenCostCalendar(requests, {now, timeZone, model = '', costDate = '', costStart, costEnd}) {
  const format = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23'});
  const parts = at => Object.fromEntries(format.formatToParts(at).map(p=>[p.type,p.value]));
  const key = p => `${p.year}-${p.month}-${p.day}`;
  const today = key(parts(now)), selectedDate=costDate||today;
  const customRange=Number.isFinite(costStart)&&Number.isFinite(costEnd);
  const lastDate=customRange?key(parts(Math.min(now,costEnd-1))):selectedDate;
  const end = Date.parse(lastDate+'T00:00:00Z');
  const blank = date => ({date, tokens:0, requests:0, priced:0, unpriced:0, usd:null});
  const firstDate=customRange?key(parts(costStart)):'';
  const daily = Array.from({length:365},(_,i)=>blank(new Date(end-(364-i)*DAY).toISOString().slice(0,10))).filter(p=>!customRange||p.date>=firstDate);
  const byDate = new Map(daily.map(p=>[p.date,p]));
  const hourly = Array.from({length:24},(_,hour)=>({...blank(selectedDate),hour}));
  const add = (p,r) => {p.tokens+=r.input+r.output;p.requests++;if(Number.isFinite(r.usd)&&r.usd>=0){p.usd=(p.usd??0)+r.usd;p.priced++;}else p.unpriced++;};
  const seen = new Set();
  for(const r of requests){
    if(seen.has(r.id)||!Number.isFinite(r.at)||r.at>now||!Number.isSafeInteger(r.input)||r.input<0||!Number.isSafeInteger(r.output)||r.output<0||model&&(r.model||'未识别模型')!==model)continue;
    seen.add(r.id);if(customRange&&(r.at<costStart||r.at>=costEnd))continue;
    const p=parts(r.at),date=key(p),day=byDate.get(date);if(day)add(day,r);
    if(date===selectedDate)add(hourly[Number(p.hour)],r);
  }
  const months=new Map();
  for(const day of daily){const key=day.date.slice(0,7);if(!months.has(key))months.set(key,blank(key));const m=months.get(key);m.tokens+=day.tokens;m.requests+=day.requests;m.priced+=day.priced;m.unpriced+=day.unpriced;if(day.usd!=null)m.usd=(m.usd??0)+day.usd;}
  return {currency:'USD',today,selectedDate,customRange,rangeStart:costStart??null,rangeEnd:costEnd??null,daily,hourly,monthly:customRange?[...months.values()]:[...months.values()].slice(-12)};
}
