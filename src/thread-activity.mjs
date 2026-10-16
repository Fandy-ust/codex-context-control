import fs from 'node:fs';
import path from 'node:path';
const active=status=>status==='active'||status==='inProgress';
export function timestampMs(value){
 if(typeof value==='string'){const n=Date.parse(value);return Number.isFinite(n)&&n>0?n:null;}
 if(!Number.isFinite(value)||value<=0)return null;
 const n=value<100000000000?value*1000:value;return Number.isSafeInteger(n)?n:null;
}
export function activityTime(thread){return Math.max(0,...['lastStartedAt','lastCompletedAt','nativeStartedAt','nativeCompletedAt','nativeActivityAt','createdAt'].map(k=>Number.isSafeInteger(thread?.[k])?thread[k]:0));}
export function mergeActivity(previous,incoming,{now=Date.now(),allowLegacyTransition=true}={}){
 const update={};
 for(const k of ['lastStartedAt','lastCompletedAt']){const n=incoming[k];if(Number.isSafeInteger(n)&&n>0&&n<=now+60000)update[k]=Math.max(previous?.[k]||0,n);}
 // Older bridges have no lifecycle timestamps. Infer only a live transition,
 // never the first snapshot replayed after reconnecting.
 if(incoming.lastStartedAt==null&&incoming.lastCompletedAt==null&&allowLegacyTransition){
  if(active(incoming.status)&&typeof incoming.turnId==='string'&&incoming.turnId!==previous?.turnId)update.lastStartedAt=now;
  if(incoming.status==='idle'&&active(previous?.status))update.lastCompletedAt=now;
 }
 return update;
}
export function compareThreadActivity(a,b){
 const running=t=>t.connected&&active(t.status)?1:0;
 return running(b)-running(a)||activityTime(b)-activityTime(a)||String(a.id).localeCompare(String(b.id));
}

// Read timestamps only; never scan messages or encrypted reasoning for ordering.
export function readNativeTurnActivity(home,ids,DatabaseSync){
 const result=new Map();let db;
 try{
  const file=fs.readdirSync(home).filter(n=>/^thread_history_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];
  if(!file||!ids.length)return result;
  db=new DatabaseSync(path.join(home,file),{readOnly:true});
  const columns=new Set(db.prepare('PRAGMA table_info(thread_turns)').all().map(r=>r.name));
  if(!['thread_id','started_at','completed_at'].every(c=>columns.has(c)))return result;
  for(let offset=0;offset<ids.length;offset+=200){const batch=ids.slice(offset,offset+200);const rows=db.prepare(`SELECT thread_id,MAX(started_at) AS started,MAX(completed_at) AS completed FROM thread_turns WHERE thread_id IN (${batch.map(()=>'?').join(',')}) GROUP BY thread_id`).all(...batch);
   for(const row of rows)result.set(row.thread_id,{nativeStartedAt:timestampMs(row.started),nativeCompletedAt:timestampMs(row.completed)});
  }
 }catch{/* Lifecycle notifications and the native recency index remain usable. */}
 finally{db?.close();}
 return result;
}
