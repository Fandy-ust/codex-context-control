import {exhaustedQuota} from './core/credits-protection.mjs';

// Persist the one-shot claim before interruption. An uncertain stop is never
// replayed after restart; only a fresh recovered quota rearms that account.
export function createCreditsProtection({load=()=>({}),save=()=>{},quota,config,stop,now=Date.now}={}){
  const saved=load();let accounts=saved.accounts??{},event=saved.event??null,result=saved.result??null,busy=false;
  if(result?.status==='stopping')result={...result,status:'uncertain',message:'部分任务未能确认停止，请检查会话；本次不会自动重试'};
  const persist=()=>save({accounts,event,result});
  const state=()=>({event:event?.scope===quota.state().accountScope?event:null,result:result?.scope===quota.state().accountScope?result:null,busy});
  async function tick(){
    if(busy)return;const q=quota.state(),c=config(),exhausted=exhaustedQuota(q,c.creditsTrigger,now());if(exhausted===null)return;
    const scope=q.accountScope,previous=accounts[scope];if(previous?.at>q.updatedAt)return;
    if(!exhausted){if(previous?.active){accounts[scope]={...previous,active:false,at:q.updatedAt};persist();}return;}
    let row=previous;
    if(!row?.active){
      row={active:true,at:q.updatedAt,id:`credits:${scope}:${now()}`,stopped:false};accounts[scope]=row;
      event={id:row.id,scope,at:now(),deliverAfter:now(),roles:['credits']};result=null;persist();
    }
    if(!c.stopOnCreditsEnabled||row.stopped)return;
    busy=true;row.stopped=true;result={scope,status:'stopping',message:'正在停止当前任务并暂停队列'};
    try{persist();const receipt=await stop({scope,episodeId:row.id});result={scope,status:'requested',...receipt,message:receipt?.message??'已请求停止当前任务，队列已暂停'};}
    catch{result={scope,status:'error',message:'部分任务未能确认停止，请检查会话；本次不会自动重试'};}
    finally{busy=false;persist();}
  }
  return {state,tick};
}
