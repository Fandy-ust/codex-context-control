import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {preflight} from './policy.mjs';
import {inheritedForkPolicy,forkConfig} from './fork-budget.mjs';

const blockedMethods=new Set(['turn/start','thread/resume','thread/settings/update','thread/unsubscribe','thread/archive','thread/delete','thread/fork']);
const resumeFields=['model','modelProvider','cwd','approvalPolicy','approvalsReviewer','sandbox','permissions','baseInstructions','developerInstructions','serviceTier','runtimeWorkspaceRoots'];
const stickyFields=['model','effort','summary','serviceTier','cwd','sandboxPolicy','approvalPolicy','approvalsReviewer','collaborationMode','disabledPluginIds','environments','permissions','runtimeWorkspaceRoots'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const key=id=>JSON.stringify(id);

export class Bridge {
  constructor(child,input,output,publish=async()=>({}),resolveFork=async()=>null) {
    this.child=child;this.input=input;this.output=output;this.publish=publish;this.records=new Map();this.internal=new Map();this.external=new Map();this.sequence=0;this.prefix=`context-control:${randomUUID()}:`;
    this.resolveFork=resolveFork;
    this.frontLines=readline.createInterface({input,crlfDelay:Infinity});this.backLines=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
    this.frontLines.on('line',line=>this.fromClient(line));this.backLines.on('line',line=>this.fromServer(line));
    child.once('exit',()=>{for(const item of this.internal.values()){clearTimeout(item.timer);item.reject(new Error('Codex 运行时已退出'));}this.internal.clear();});
  }
  writeBackend(line){if(!this.child.stdin.write(line+'\n')){this.input.pause();this.child.stdin.once('drain',()=>this.input.resume());}}
  writeFrontend(line){if(!this.output.write(line+'\n')){this.child.stdout.pause();this.output.once('drain',()=>this.child.stdout.resume());}}
  fromClient(line,preparedFork=null) {
    let m;try{m=JSON.parse(line);}catch{this.writeBackend(line);return;}
    const id=m.params?.threadId;const record=this.records.get(id);
    if(m.method==='turn/start'&&record&&!record.locked&&record.status==='idle'&&record.policy&&record.appliedRevision!==record.policy.revision){
      // Acquire the reload lock synchronously before letting a new turn use an
      // intermediate budget; apply() still performs the normal safety checks.
      this.apply(record).catch(()=>{});
    }
    if(record?.locked&&blockedMethods.has(m.method)){
      if(record.queue.length>=128||record.queueBytes+line.length>128*1024*1024){if(m.id!=null)this.writeFrontend(JSON.stringify({id:m.id,error:{code:-32000,message:'Context Control is applying a change; retry this request.'}}));return;}
      record.queue.push(line);record.queueBytes+=line.length;return;
    }
    if(m.method==='thread/fork'&&m.id!=null&&!preparedFork){
      this.prepareFork(m).catch(error=>this.writeFrontend(JSON.stringify({id:m.id,error:{code:-32000,message:`Context Control: ${error.message}`}})));return;
    }
    if(m.method&&m.id!=null){
      const seed=pick(m.params||{},[...resumeFields,...stickyFields,'config','ephemeral']);
      this.external.set(key(m.id),{method:m.method,threadId:id,seed,fork:preparedFork});
    }
    if(m.method==='turn/start'&&record)record.usageFresh=false;
    this.writeBackend(line);
  }
  async prepareFork(message){
    const params=message.params||{},parentId=params.threadId;
    let source=null,model=null;
    // A path overrides threadId in the native protocol; never inherit from a
    // different parent, or persist settings for ephemeral/managed children.
    if(typeof parentId==='string'&&!params.path&&!params.ephemeral){
      const resolved=await this.resolveFork(parentId,params.model);
      const parent=this.records.get(parentId);
      source=resolved?.policy??parent?.policy;
      model=resolved?.model??(!params.model||params.model===parent?.model?parent?.modelInfo:null);
    }
    const policy=inheritedForkPolicy(source,parentId);
    if(policy&&params.model&&!model)throw new Error('无法核对分支模型的窗口上限，请先加载该模型信息再 fork。');
    if(policy&&Number.isSafeInteger(model?.max_context_window)&&policy.window>model.max_context_window)throw new Error('父对话预算超过分支模型上限，请先调整预算再 fork。');
    const prepared={parentId,source:policy?structuredClone(source):null,policy,model};
    this.fromClient(JSON.stringify(policy?{...message,params:forkConfig(params,policy)}:message),prepared);
  }
  record(id){
    if(!this.records.has(id))this.records.set(id,{id,status:'idle',freshUsage:false,seed:{},sticky:{},queue:[],queueBytes:0,locked:false});
    return this.records.get(id);
  }
  fromServer(line) {
    let m;try{m=JSON.parse(line);}catch{this.writeFrontend(line);return;}
    if(!m.method&&this.internal.has(key(m.id))){const item=this.internal.get(key(m.id));this.internal.delete(key(m.id));clearTimeout(item.timer);m.error?item.reject(new Error(m.error.message)):item.resolve(m.result);return;}
    if(!m.method&&m.id!=null){
      const pending=this.external.get(key(m.id));this.external.delete(key(m.id));
      if(pending&&!m.error){
        const t=m.result?.thread;
        if(t?.id&&['thread/start','thread/resume','thread/fork'].includes(pending.method)) {
          const record=this.record(t.id);record.seed={...record.seed,...pending.seed,config:{...record.seed.config,...pending.seed.config}};
          Object.assign(record,pick(t,['name','cwd','model','ephemeral','canAcceptDirectInput']));
          record.model=m.result.model||record.model;record.status=t.status?.type||'idle';record.snapshot=m.result;
          if(pending.method==='thread/fork'&&pending.fork?.policy&&t.id!==pending.threadId&&!t.ephemeral&&t.canAcceptDirectInput!==false){
            const {policy,source,parentId,model}=pending.fork;
            record.forkedFromId=parentId;record.forkPolicy=source;
            record.policy=policy;record.policyVersion=policy.revision;record.appliedRevision=policy.revision;record.revision=policy.revision;
            record.configuredWindow=policy.window;record.modelInfo=model;
            const percent=model?.effective_context_window_percent;
            record.expectedWindow=Number.isInteger(percent)?Math.floor(policy.window*percent/100):null;
            record.freshUsage=false;record.usageFresh=false;record.phase='awaiting_runtime_confirmation';
            record.message='已继承父对话预算；等待分支首次请求读回窗口。';
          }else if(t.forkedFromId){record.forkedFromId=t.forkedFromId;}
          this.notify(record);
        }else if(pending.threadId&&['turn/start','thread/settings/update'].includes(pending.method)){
          const record=this.record(pending.threadId);Object.assign(record.sticky,pick(pending.seed,stickyFields));
          const nextModel=pending.seed.collaborationMode?.settings?.model||pending.seed.model;
          if(nextModel&&nextModel!==record.model){record.model=nextModel;record.modelInfo=null;record.freshUsage=false;record.usageFresh=false;record.expectedWindow=null;record.appliedRevision=null;this.notify(record);}
        }
      }
    }
    const p=m.params||{};const id=p.threadId||p.thread_id;
    if(id){
      const record=this.records.get(id);
      if(record){
        if(m.method==='thread/tokenUsage/updated'){
          record.observedWindow=p.tokenUsage.modelContextWindow;record.lastUsage=p.tokenUsage.last;record.freshUsage=true;record.usageFresh=true;
          if(record.expectedWindow!=null&&record.policy&&record.revision===record.policy.revision){record.phase=record.observedWindow===record.expectedWindow?'confirmed':'mismatch';record.message=record.phase==='confirmed'?'下一轮窗口已读回确认。':'实际窗口与目标不一致；请查看运行时或模型目录。';}
          this.notify(record);
        }
        if(m.method==='thread/status/changed'){record.status=p.status.type;this.notify(record);if(record.status==='idle')this.schedule(record);}
        if(m.method==='turn/started'){record.status='active';record.turnId=p.turn.id;record.usageFresh=false;this.notify(record);}
        if(m.method==='turn/completed'){record.status='idle';record.turnId=p.turn.id;this.notify(record);this.schedule(record);}
        if(m.method==='thread/name/updated'){record.name=p.name;this.notify(record);}
      }
    }
    this.writeFrontend(line);
  }
  publicRecord(record){return pick(record,['id','name','cwd','model','status','ephemeral','canAcceptDirectInput','observedWindow','expectedWindow','configuredWindow','lastUsage','freshUsage','usageFresh','phase','message','turnId','revision','forkedFromId','forkPolicy']);}
  notify(record){
    Promise.resolve(this.publish(this.publicRecord(record))).then(reply=>{
      if(reply?.model?.slug===record.model)record.modelInfo=reply.model;
      if(reply?.policy&&reply.policy.revision>(record.policyVersion||0)){
        if(reply.policy.enabled)this.setPolicy(record.id,reply.policy,reply.model);
        else this.clearPolicy(record.id,reply.policy.revision);
      }
    }).catch(()=>{});
  }
  rpc(method,params,timeout=20000){
    const id=this.prefix+(++this.sequence);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.internal.delete(key(id));reject(new Error(`${method} 超时`));},timeout);this.internal.set(key(id),{resolve,reject,timer});this.writeBackend(JSON.stringify({id,method,params}));});
  }
  setPolicy(id,policy,model){
    const r=this.records.get(id);if(!r)throw new Error('此连接尚未加载聊天');
    if(policy.revision<(r.policyVersion||0)||(policy.revision===r.policyVersion&&!r.policy))return {ignored:true};
    if(policy.revision===r.policyVersion){if(model)r.modelInfo=model;this.schedule(r);return {queued:r.appliedRevision!==policy.revision};}
    r.policy=policy;r.policyVersion=policy.revision;if(model)r.modelInfo=model;
    const plan=preflight(r,policy,r.modelInfo);
    r.phase=r.locked?'reloading':plan.allowed?'queued':plan.code;
    r.message=r.locked?'已收到最新预算；正在完成重新加载。':plan.allowed?'等待轮次结束与预检。':plan.message;
    this.notify(r);this.schedule(r);return {queued:true};
  }
  clearPolicy(id,revision){const r=this.records.get(id);if(r){const next=revision??(r.policyVersion||0)+1;if(next<(r.policyVersion||0))return {ignored:true};r.policyVersion=next;r.policy=null;r.phase='saved';r.message='已停止自动应用；当前窗口保持现值。';this.notify(r);}return {ok:true};}
  schedule(record){if(record.locked||!record.policy||record.appliedRevision===record.policy.revision||record.status!=='idle')return;queueMicrotask(()=>this.apply(record).catch(()=>{}));}
  async compact(id){const r=this.records.get(id);if(!r||r.status!=='idle'||r.locked)throw new Error('请等待当前轮次结束后再压缩');r.freshUsage=false;r.usageFresh=false;await this.rpc('thread/compact/start',{threadId:id});return {started:true,message:'已请求原生压缩；完成后请等待下一轮用量记录。'};}
  async apply(record){
    if(record.locked||!record.policy||record.appliedRevision===record.policy.revision||record.status!=='idle')return;
    record.usageFresh??=record.freshUsage;
    record.locked=true;
    try{
      while(record.policy&&record.appliedRevision!==record.policy.revision){
        const policy={...record.policy};
        const plan=preflight(record,policy,record.modelInfo);
        if(!plan.allowed){record.phase=plan.code;record.message=plan.message;break;}
        record.phase='reloading';record.message='正在重新加载当前聊天。';this.notify(record);
        if(!await this.reload(record,policy,plan))break;
      }
      if(!record.policy){record.phase='saved';record.message='已停止自动应用；当前窗口保持现值。';}
    }finally{
      record.locked=false;this.notify(record);
      const queued=record.queue.splice(0);record.queueBytes=0;for(const line of queued)this.fromClient(line);
    }
  }
  async reload(record,policy,plan){
    let detached=false,originalParams;
    try {
      const before=await this.rpc('thread/resume',{threadId:record.id,excludeTurns:true});
      if(before.thread.status?.type!=='idle'||before.thread.canAcceptDirectInput===false||before.thread.ephemeral)throw new Error('聊天状态已改变，请稍后重试');
      const resume={...pick(record.seed,resumeFields),threadId:record.id,excludeTurns:true,config:{...record.seed.config}};
      for(const k of ['model','modelProvider','cwd','approvalPolicy','approvalsReviewer','serviceTier','runtimeWorkspaceRoots'])if(Object.hasOwn(before,k))resume[k]=before[k];
      const mode={readOnly:'read-only',workspaceWrite:'workspace-write',dangerFullAccess:'danger-full-access'}[before.sandbox?.type];
      if(before.activePermissionProfile?.id){resume.permissions=before.activePermissionProfile.id;delete resume.sandbox;}
      else if(mode){resume.sandbox=mode;delete resume.permissions;}
      else throw new Error('当前沙盒策略无法无损恢复，已取消调整');
      originalParams=structuredClone(resume);
      Object.assign(resume.config,{model_context_window:policy.window,model_auto_compact_token_limit:policy.compact,model_auto_compact_token_limit_scope:'total'});
      await this.rpc('thread/unsubscribe',{threadId:record.id});detached=true;
      const after=await this.rpc('thread/resume',resume);
      const restore={threadId:record.id,effort:before.reasoningEffort??null,disabledPluginIds:before.disabledPluginIds||[],...pick(record.sticky,['summary'])};
      if(before.collaborationMode)restore.collaborationMode=before.collaborationMode;
      if(!resume.permissions)restore.sandboxPolicy=before.sandbox;
      await this.rpc('thread/settings/update',restore);
      if(after.model!==before.model||after.modelProvider!==before.modelProvider)throw new Error('模型或提供方发生意外变化，已停止确认');
      record.seed={...record.seed,...resume};record.snapshot=after;record.appliedRevision=policy.revision;record.revision=policy.revision;
      record.configuredWindow=policy.window;record.expectedWindow=plan.expectedWindow;record.freshUsage=false;
      record.phase='awaiting_runtime_confirmation';record.message='已重新加载；等待下一轮实际窗口读回。';
      return true;
    }catch(error){
      if(detached&&originalParams){try{await this.rpc('thread/resume',originalParams);}catch{}}
      record.phase='error';record.message=error.message;record.appliedRevision=policy.revision;
      return false;
    }
  }
}
