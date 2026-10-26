// Stop only the current turns in registered runtimes; never terminate a host app.
export async function stopForCredits({queues,quota,bridges},scope){
  const resume=await queues.suspend();
  try{
    if(quota.state().accountScope!==scope)throw Error('Account changed');
    queues.command({action:'monitoring',enabled:false});queues.command({action:'disable-all'});
    const peers=[...bridges.entries()];
    const results=await Promise.allSettled(peers.map(async([peer,bridge])=>{
      if(bridge.creditsStopVersion!==1)throw Error('Runtime restart required');
      return peer.call('credits-stop',{},15000);
    }));
    const failed=results.filter(r=>r.status==='rejected').length+results.reduce((sum,r)=>sum+(r.status==='fulfilled'?(r.value?.failed??0):0),0);
    const targeted=results.reduce((sum,r)=>sum+(r.status==='fulfilled'?(r.value?.targeted??0):0),0);
    return {targeted,failed,status:failed?'partial':'requested',message:failed?'部分会话未能停止，请重开 Codex 后检查；队列已暂停':'已请求停止当前任务，队列已暂停'};
  }finally{resume();}
}
