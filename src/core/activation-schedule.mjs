export const validActivationTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function localActivationTime(at){const date=new Date(at);return [date.getHours(),date.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');}
// Construct each occurrence from the local calendar, not a fixed 24-hour offset.
export function nextActivationAt(time,now,{tomorrow=false}={}){
  if(!validActivationTime(time))throw Error('请选择有效的预约时间');
  const date=new Date(now),[hour,minute]=time.split(':').map(Number);
  const candidate=new Date(date.getFullYear(),date.getMonth(),date.getDate()+(tomorrow?1:0),hour,minute);
  if(candidate.getTime()<=now)return new Date(date.getFullYear(),date.getMonth(),date.getDate()+1,hour,minute).getTime();
  return candidate.getTime();
}
export function latestActivationAt(time,now){
  if(!validActivationTime(time))throw Error('请选择有效的预约时间');
  const date=new Date(now),[hour,minute]=time.split(':').map(Number);
  const today=new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour,minute);
  return today.getTime()<=now?today.getTime():new Date(date.getFullYear(),date.getMonth(),date.getDate()-1,hour,minute).getTime();
}
