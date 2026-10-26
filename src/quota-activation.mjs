import {quotaWindow,resetConfirmed} from './core/quota-activation.mjs';
import {validActivationTime,localActivationTime,nextActivationAt,latestActivationAt} from './core/activation-schedule.mjs';

// Attempts and due dates are saved before model dispatch. An interrupted process
// never replays an uncertain send. All triggers share one serialized runner.
export function createQuotaActivation({load=()=>({}),save=()=>{},quota,probe,recommend=async()=>null,protection=()=>null,now=Date.now}={}){
  const saved=load();let config={notificationsEnabled:true,creditsNotificationsEnabled:true,stopOnCreditsEnabled:false,creditsTrigger:"both",weeklyEnabled:false,scheduledAt:null,toleranceMinutes:10,...saved.config};
  config.scheduleMode??=config.scheduledAt?'once':'off';
  config.scheduleTime??=config.scheduledAt?localActivationTime(config.scheduledAt):'08:00';
  let job=saved.job??null,lastWeekly=saved.lastWeekly??null,lastWindow=saved.lastWindow??null,scope=saved.scope??null;
  let busy=false,closed=false,abort=null,recommendation=null,recommendedAt=0;
  if(job?.status==='running')job={...job,status:'uncertain',message:'上次探测中断，未自动重发；请检查额度后再手动触发。'};
  const persist=()=>save({config,job,lastWeekly,lastWindow,scope});
  const state=()=>({config,job,busy,recommendation,creditsProtection:protection(),model:'gpt-6-luna',maxAttempts:3});
  function command(p){
    if(p.action==='configure'){
      const next={...config};
      for(const key of ['creditsNotificationsEnabled','stopOnCreditsEnabled'])if(p[key]!==undefined){if(typeof p[key]!=='boolean')throw Error('Invalid Credits protection switch');next[key]=p[key];}
      if(p.creditsTrigger!==undefined){if(!['both','either'].includes(p.creditsTrigger))throw Error('Invalid Credits trigger');next.creditsTrigger=p.creditsTrigger;}
      if(p.notificationsEnabled!==undefined){if(typeof p.notificationsEnabled!=='boolean')throw Error('Invalid notification switch');next.notificationsEnabled=p.notificationsEnabled;}
      if(p.weeklyEnabled!==undefined){if(typeof p.weeklyEnabled!=='boolean')throw Error('Invalid weekly switch');next.weeklyEnabled=p.weeklyEnabled;}
      if(p.scheduleMode!==undefined||p.scheduleTime!==undefined){
        const mode=p.scheduleMode??next.scheduleMode,time=p.scheduleTime??next.scheduleTime;
        if(!['off','once','daily'].includes(mode))throw Error('预约方式无效');
        if(!validActivationTime(time))throw Error('请选择有效的预约时间');
        next.scheduleMode=mode;next.scheduleTime=time;next.scheduledAt=mode==='off'?null:nextActivationAt(time,now(),{tomorrow:mode==='once'});
      }else if(p.scheduledAt!==undefined){if(p.scheduledAt!==null&&(!Number.isSafeInteger(p.scheduledAt)||p.scheduledAt<=now()||p.scheduledAt>now()+366*86400000))throw Error('请选择未来的触发日期与时间');next.scheduledAt=p.scheduledAt;next.scheduleMode=p.scheduledAt?'once':'off';if(p.scheduledAt)next.scheduleTime=localActivationTime(p.scheduledAt);}
      if(p.toleranceMinutes!==undefined){if(!Number.isInteger(p.toleranceMinutes)||p.toleranceMinutes<1||p.toleranceMinutes>60)throw Error('容差须为 1–60 分钟');next.toleranceMinutes=p.toleranceMinutes;}
      config=next;
    }else if(p.action==='run'){
      if(busy||['waiting','verifying'].includes(job?.status))throw Error('已有探测正在进行');
      job={kind:'manual',minutes:300,status:'waiting',attempts:0,nextAt:now()};
    }else if(p.action==='cancel'){
      abort?.abort();if(job)job={...job,status:'cancelled',message:'已停止探测'};config.scheduledAt=null;config.scheduleMode='off';
    }else throw Error('Unknown activation action');
    persist();return state();
  }
  async function tick(){
    if(busy||closed)return;busy=true;
    try{
      if(now()-recommendedAt>60000){recommendedAt=now();try{recommendation=await recommend();}catch{recommendation=null;}}
      if(!config.weeklyEnabled&&!config.scheduledAt&&!['waiting','verifying'].includes(job?.status))return;
      await quota.refresh();const q=quota.state();
      if(q.stale||!q.updatedAt||now()-q.updatedAt>30000)return;
      const currentScope=q.accountScope??null;
      if(scope!==currentScope){const changed=scope!==null;scope=currentScope;lastWindow=null;lastWeekly=null;if(changed){recommendation=null;recommendedAt=0;}if(changed&&['waiting','verifying'].includes(job?.status))job={...job,status:'cancelled',message:'账户已变化，请重新设置探测'};persist();}
      if(job?.status==='verifying'){
        if(q.updatedAt<=job.startedAt||now()<job.nextAt)return;
        if(resetConfirmed(q,job.minutes,job.startedAt,config.toleranceMinutes))job={...job,status:'confirmed',message:'已确认新的额度倒计时'};
        else job={...job,status:job.attempts>=3?'failed':'waiting',nextAt:now()+15000,message:job.probeError??'尚未确认新的重置时间'};
        persist();return;
      }
      const weekly=quotaWindow(q,10080),reset=weekly?.resetsAt;
      if(['scheduled','daily'].includes(job?.kind)&&job.status==='waiting'&&job.dueAt&&now()-job.dueAt>15*60000){job={...job,status:'missed',message:'已错过预约超过 15 分钟，不再补发本次探测'};persist();}
      if(!job||!['waiting','running','verifying'].includes(job.status)){
        if(config.scheduledAt&&now()>=config.scheduledAt){
          const daily=config.scheduleMode==='daily',due=daily?Math.max(config.scheduledAt,latestActivationAt(config.scheduleTime,now())):config.scheduledAt;
          config.scheduledAt=daily?nextActivationAt(config.scheduleTime,now()):null;if(!daily)config.scheduleMode='off';
          job={kind:daily?'daily':'scheduled',dueAt:due,minutes:300,attempts:0,status:now()-due<=15*60000?'waiting':'missed',nextAt:now(),message:now()-due>15*60000?'已错过预约超过 15 分钟，不再补发本次探测':null};persist();
        }else if(config.weeklyEnabled&&weekly&&lastWindow&&lastWeekly!==lastWindow.resetsAt&&
          ((lastWindow.resetsAt*1000<=now()&&now()-lastWindow.resetsAt*1000<=24*3600000)||
           (lastWindow.usedPercent>1&&weekly.usedPercent<=1))){
          lastWeekly=lastWindow.resetsAt;job={kind:'weekly',minutes:10080,attempts:0,status:'waiting',nextAt:now()};persist();
        }
      }
      if(reset&&(lastWindow?.resetsAt!==reset||lastWindow?.usedPercent!==weekly.usedPercent)){lastWindow={resetsAt:reset,usedPercent:weekly.usedPercent};persist();}
      if(job?.status!=='waiting'||job.nextAt>now())return;
      // A new timer may already have been started by normal use; no send needed.
      const w=quotaWindow(q,job.minutes);
      if(!w||!quotaWindow(q,300)){job.message='等待有效的 Codex 额度窗口';persist();return;}
      if(job.attempts===0&&w?.resetsAt*1000>now()&&w.usedPercent>0){job={...job,status:'already-active',message:'额度周期已启动，无需发送探测'};persist();return;}
      const primary=quotaWindow(q,300);
      if(job.minutes===300&&weekly?.usedPercent>=100&&weekly.resetsAt*1000>now()){job.nextAt=weekly.resetsAt*1000+1000;job.message='等待周额度恢复';persist();return;}
      if(primary?.usedPercent>=100&&primary.resetsAt*1000>now()){job.nextAt=primary.resetsAt*1000+1000;job.message='等待 5 小时额度恢复';persist();return;}
      const startedAt=now();job={...job,status:'running',attempts:job.attempts+1,startedAt,message:'正在发送最短探测，收到回复即停止'};persist();
      abort=new AbortController();let failure=null;
      try{await probe({signal:abort.signal});}catch(error){failure=error.message;}
      abort=null;if(closed||job.status==='cancelled')return;
      job={...job,status:'verifying',nextAt:now()+10000,probeError:failure,message:failure??'正在等待额度读回'};
      persist();
    }finally{busy=false;}
  }
  persist();
  return {state,command,tick,close(){closed=true;abort?.abort();}};
}
