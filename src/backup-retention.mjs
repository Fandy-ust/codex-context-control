// Use local calendar dates on both platforms; weeks start on Monday.
const dayNumber=date=>Math.floor(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000);
export function retainedCalendarPoints(points,now,{monthlyMonths=3}={}){
 const today=dayNumber(now),cutoff=new Date(now),date=cutoff.getDate();cutoff.setDate(1);cutoff.setMonth(cutoff.getMonth()-monthlyMonths);const lastDay=new Date(cutoff.getFullYear(),cutoff.getMonth()+1,0).getDate();cutoff.setDate(Math.min(date,lastDay));
 const buckets=new Set(),keep=new Set();
 for(const point of [...points].sort((a,b)=>b.at.localeCompare(a.at))){const at=new Date(point.at);if(!Number.isFinite(at.getTime())||at>now||at<cutoff)continue;
  const day=dayNumber(at),age=today-day;
  const key=age<7?'day:'+day:age<31?'week:'+(day-((day+3)%7)):'month:'+at.getFullYear()+'-'+at.getMonth();
  if(!buckets.has(key)){buckets.add(key);keep.add(point.id);}
 }
 return keep;
}
