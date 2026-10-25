import readline from 'node:readline';
import {taskCommand} from './core/task-command.mjs';
import fs from 'node:fs';
import {normalizeTaskSettings,taskInput,inheritedTaskEffort} from './core/task-settings.mjs';
import {randomUUID} from 'node:crypto';
import {Tiktoken} from 'js-tiktoken/lite';
import ranks from 'js-tiktoken/ranks/o200k_base';
import {ceilingConfig,ceilingModel,migrateCeilingPolicy,policyForModel,MAX_CONTEXT_INPUT,MAX_CONTEXT_COMPACT,MIN_CONTEXT_RESERVE} from './context-ceiling.mjs';
import {isNewUserChat} from './new-chat-defaults.mjs';
import {timestampMs} from './thread-activity.mjs';
import {preflight} from './policy.mjs';
import {inheritedForkPolicy,forkConfig} from './fork-budget.mjs';
import {compensationBudget} from './core/compaction-compensation.mjs';

const blockedMethods=new Set(['turn/start','thread/resume','thread/settings/update','thread/unsubscribe','thread/archive','thread/delete','thread/fork']);
const resumeFields=['model','modelProvider','cwd','approvalPolicy','approvalsReviewer','sandbox','permissions','baseInstructions','developerInstructions','serviceTier','runtimeWorkspaceRoots'];
const stickyFields=['model','effort','summary','serviceTier','cwd','sandboxPolicy','approvalPolicy','approvalsReviewer','collaborationMode','disabledPluginIds','environments','permissions','runtimeWorkspaceRoots'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const key=id=>JSON.stringify(id);
let inputEncoder;
function incomingTokens(input=[]){if(!Array.isArray(input)||input.some(item=>!item||typeof item!=='object'||typeof item.type!=='string'||(item.type==='text'&&typeof item.text!=='string')))return null;inputEncoder??=new Tiktoken(ranks);return input.reduce((n,item)=>n+(item.type==='text'?inputEncoder.encode(item.text??'').length:16000),0);}

export class Bridge {
  constructor(child,input,output,publish=async()=>({}),resolveFork=async()=>null,options={}) {
    this.child=child;this.input=input;this.output=output;this.publish=publish;this.records=new Map();this.internal=new Map();this.external=new Map();this.sequence=0;this.prefix=`context-control:${randomUUID()}:`;
    this.resolveFork=resolveFork;this.contextCeiling=options.contextCeiling===1;this.resolveNewChatBudget=options.resolveNewChatBudget;this.nativeBudgetSupport=options.nativeBudgetSupport===true;
    this.resolveCompensation=options.resolveCompensation;this.accountingWindowLimit=options.accountingWindowLimit;
    this.frontLines=readline.createInterface({input,crlfDelay:Infinity});this.backLines=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
    this.frontLines.on('line',line=>this.fromClient(line));this.backLines.on('line',line=>this.fromServer(line));
    child.once('exit',()=>{for(const item of this.internal.values()){clearTimeout(item.timer);item.reject(new Error('Codex 运行时已退出'));}this.internal.clear();});
  }
  writeBackend(line){if(!this.child.stdin.write(line+'\n')){this.input.pause();this.child.stdin.once('drain',()=>this.input.resume());}}
  writeFrontend(line){if(!this.output.write(line+'\n')){this.child.stdout.pause();this.output.once('drain',()=>this.child.stdout.resume());}}
  fromClient(line,preparedFork=null,guarded=false,compensationPrepared=false) {
    let m;try{m=JSON.parse(line);}catch{this.writeBackend(line);return;}
    if(!m||typeof m!=='object'||Array.isArray(m)){this.writeBackend(line);return;}
    if(this.resolveNewChatBudget&&m.method==='thread/start'&&m.id!=null&&isNewUserChat(m.params)&&!preparedFork?.newChat){this.prepareNewChat(m).catch(error=>this.rejectTurn(m,error.message));return;}
    if((this.contextCeiling||this.nativeBudgetSupport)&&m.method==='thread/resume'&&m.id!=null&&m.params?.threadId&&!m.params?.path&&!m.params?.ephemeral&&!preparedFork?.resume){this.prepareResume(m).catch(error=>this.rejectTurn(m,error.message));return;}
    if(this.contextCeiling&&['thread/start','thread/resume'].includes(m.method)&&!m.params?.ephemeral){m.params={...m.params,config:ceilingConfig(m.params?.config)};line=JSON.stringify(m);}
    const id=m.params?.threadId;const record=this.records.get(id);
    if(m.method==='turn/start'&&record?.automaticTask?.status==='starting'){this.rejectTurn(m,'队列正在提交任务，请稍后再发送。');return;}
    if(m.method==='turn/start'&&record&&!record.locked&&record.status==='idle'&&record.policy&&record.appliedRevision!==record.policy.revision){
      // Acquire the reload lock synchronously before letting a new turn use an
      // intermediate budget; apply() still performs the normal safety checks.
      this.apply(record).catch(()=>{});
    }
    if((record?.locked||record?.initializing)&&blockedMethods.has(m.method)){
      if(record.queue.length>=128||record.queueBytes+line.length>128*1024*1024){if(m.id!=null)this.writeFrontend(JSON.stringify({id:m.id,error:{code:-32000,message:'Context Control is applying a change; retry this request.'}}));return;}
      record.queue.push(line);record.queueBytes+=line.length;return;
    }
    if(this.resolveCompensation&&!compensationPrepared&&m.method==='turn/start'&&record?.policy?.enabled!==false&&record?.policy&&record.status==='idle'&&!record.compensationTurnPending&&!record.ephemeral&&record.canAcceptDirectInput!==false){
      this.prepareCompensatedTurn(record,m,line,guarded).catch(()=>{});return;
    }
    if((this.contextCeiling||record?.compensation?.enabled)&&!guarded&&m.method==='turn/start'&&record&&!record.ephemeral&&record.canAcceptDirectInput!==false){
      const logical=record.policy&&Number.isInteger(record.modelInfo?.effective_context_window_percent)?Math.floor(record.policy.window*record.modelInfo.effective_context_window_percent/100):null;
      const cap=Math.min(logical??record.expectedWindow??record.observedWindow??MAX_CONTEXT_INPUT,this.contextCeiling?MAX_CONTEXT_INPUT:Number.MAX_SAFE_INTEGER),reserve=Math.max(record.policy?.reserve??MIN_CONTEXT_RESERVE,MIN_CONTEXT_RESERVE);
      const incoming=incomingTokens(m.params.input),used=(record.lastUsage??record.inheritedUsage)?.totalTokens??0;
      const threshold=Math.min(record.policy?.compact??MAX_CONTEXT_COMPACT,MAX_CONTEXT_COMPACT,cap-reserve);
      if(incoming!=null&&incoming+reserve>=cap){this.rejectTurn(m,'新输入本身已接近上下文上限，请拆分输入。');return;}
      if(incoming!=null&&used+incoming+reserve>=Math.min(cap,threshold+reserve)){
        if(record.status!=='idle'||record.compensationTurnPending){this.rejectTurn(m,'上下文已接近上限；请等待当前轮次结束并压缩后再追加输入。');return;}
        this.guardTurn(record,m,line,incoming,reserve,cap).catch(()=>{});return;
      }
    }
    if(m.method==='thread/fork'&&m.id!=null&&!preparedFork){
      this.prepareFork(m).catch(error=>this.writeFrontend(JSON.stringify({id:m.id,error:{code:-32000,message:`Context Control: ${error.message}`}})));return;
    }
    if(m.method&&m.id!=null){
      const seed=pick(m.params||{},[...resumeFields,...stickyFields,'config','ephemeral']);
      this.external.set(key(m.id),{method:m.method,threadId:id,seed,fork:preparedFork});
    }
    if(m.method==='turn/start'&&record){record.usageFresh=false;if(this.resolveCompensation)record.compensationTurnPending=true;}
    this.writeBackend(line);
  }
  async prepareNewChat(message){
    let model=message.params?.model;
    if(!model&&this.nativeBudgetSupport){const config=await this.rpc('config/read',{includeLayers:false});model=config.config?.model;}
    const {policy}=await this.resolveNewChatBudget(model);
    const params={...message.params,config:{...message.params?.config,model_context_window:policy.window,model_auto_compact_token_limit:policy.compact,model_auto_compact_token_limit_scope:'total'}};
    this.fromClient(JSON.stringify({...message,params}),{newChat:true,newChatPolicy:structuredClone(policy)});
  }
  async prepareResume(message){
    const existing=this.records.get(message.params.threadId);
    const preserveUsage=existing?.status==='idle'&&existing.usageFresh===true&&(!message.params.model||message.params.model===existing.model)&&Object.keys(message.params).every(k=>['threadId','excludeTurns','initialTurnsPage','model'].includes(k));
    const resolved=await this.resolveFork(message.params.threadId,message.params.model);
    const policy=resolved?.policy?.enabled?(this.contextCeiling?migrateCeilingPolicy(resolved.policy,resolved.model):policyForModel(resolved.policy,resolved.model)):null;
    const config=policy?{...message.params.config,model_context_window:policy.window,model_auto_compact_token_limit:policy.compact}:message.params.config;
    this.fromClient(JSON.stringify({...message,params:{...message.params,config}}),{resume:true,resumePolicy:policy,preserveUsage});
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
    if(this.contextCeiling&&source){source=migrateCeilingPolicy(source,model);model=ceilingModel(model);}
    if(!this.contextCeiling&&source&&model){
      const oldPercent=source.effectivePercent??(source.contextCeilingVersion?90:model.effective_context_window_percent);
      if(Math.floor(source.window*oldPercent/100)>Math.floor(model.max_context_window*model.effective_context_window_percent/100))throw Error('父对话预算超过分支模型上限，请先调整预算再 fork。');
      source=policyForModel(source,model);
    }
    const policy=inheritedForkPolicy(source,parentId);
    if(policy&&params.model&&!model)throw new Error('无法核对分支模型的窗口上限，请先加载该模型信息再 fork。');
    if(policy&&Number.isSafeInteger(model?.max_context_window)&&policy.window>model.max_context_window)throw new Error('父对话预算超过分支模型上限，请先调整预算再 fork。');
    const parent=this.records.get(parentId);
    const canUseParentUsage=parent?.status==='idle'&&parent.usageFresh===true&&Object.keys(params).every(k=>['threadId','excludeTurns','deferGoalContinuation'].includes(k));
    const prepared={parentId,source:policy?structuredClone(source):null,policy,model,inheritedUsage:canUseParentUsage?structuredClone(parent.lastUsage):null};
    this.fromClient(JSON.stringify(policy?{...message,params:forkConfig(params,policy)}:message),prepared);
  }
  record(id){
    if(!this.records.has(id))this.records.set(id,{id,status:'idle',freshUsage:false,seed:{},sticky:{},queue:[],queueBytes:0,locked:false});
    return this.records.get(id);
  }
  async runtimeBudget(record,policy){
    let observation={enabled:false};
    if(this.resolveCompensation)observation=await this.resolveCompensation(record);
    return compensationBudget(policy,record.modelInfo,{...observation,accountingWindowLimit:this.accountingWindowLimit});
  }
  budgetKey(policy,budget){return JSON.stringify([policy.revision,budget.window,budget.compact,budget.details]);}
  async syncCompensation(record,requestedModel=null){
    if(!record.policy)return;
    const policy={...record.policy};
    const switching=requestedModel&&requestedModel!==record.model;
    const budget=await this.runtimeBudget(record,policy);
    if(switching){budget.window=policy.window;budget.compact=policy.compact;budget.details={...budget.details,status:'waiting',extraTokens:0,runtimeWindow:budget.details.targetWindow,message:'切换模型，等待新用量后补偿'};}
    const observed=!record.lastUsage&&record.inheritedUsage?{...record,lastUsage:record.inheritedUsage,usageFresh:true}:record;
    const plan=preflight(observed,policy,record.modelInfo);
    const windowMismatch=record.freshUsage===true&&Number.isSafeInteger(record.observedWindow)&&record.observedWindow!==budget.details.runtimeWindow;
    // A pending observation is not an applied budget. In particular, disabling
    // must still restore a previously enlarged runtime after a deferred reload.
    if(!budget.details.enabled&&!record.compensation?.enabled&&!record.compensationKey&&!windowMismatch){record.compensation=budget.details;record.compensationKey=this.budgetKey(policy,budget);}
    else if((this.budgetKey(policy,budget)!==record.compensationKey||windowMismatch)&&plan.allowed){
      if(!await this.reload(record,policy,plan,budget))throw Error(record.message);
    }else if(!plan.allowed){
      if(switching&&record.compensation?.status==='active'&&record.compensation.extraTokens>0)throw Error('请先取得新用量或手动压缩，再切换模型');
      record.compensation={...(record.compensation??budget.details),status:'waiting',pendingEnabled:budget.details.enabled,message:budget.details.enabled?'等待新用量或压缩后再应用补偿':'补偿已关闭，等待安全恢复原窗口'};
    }
  }
  async prepareCompensatedTurn(record,message,line,guarded){
    record.locked=true;let ready=false;
    try{await this.syncCompensation(record,message.params?.collaborationMode?.settings?.model||message.params?.model);ready=true;}
    catch(error){this.rejectTurn(message,error.message);record.phase='error';record.message=error.message;}
    finally{record.locked=false;this.notify(record);}
    if(ready)this.fromClient(line,null,guarded,true);
    const queued=record.queue.splice(0);record.queueBytes=0;for(const pending of queued)this.fromClient(pending);
  }
  fromServer(line) {
    let m;try{m=JSON.parse(line);}catch{this.writeFrontend(line);return;}
    if(!m||typeof m!=='object'||Array.isArray(m)){this.writeFrontend(line);return;}
    if(!m.method&&this.internal.has(key(m.id))){const item=this.internal.get(key(m.id));this.internal.delete(key(m.id));clearTimeout(item.timer);m.error?item.reject(new Error(m.error.message)):item.resolve(m.result);return;}
    if(!m.method&&m.id!=null){
      const pending=this.external.get(key(m.id));this.external.delete(key(m.id));
      if(pending?.method==='initialize'&&m.result&&!m.error)this.initialized=true;
      if(pending?.method==='turn/start'&&m.error){const r=this.records.get(pending.threadId);if(r)r.compensationTurnPending=false;}
      if(pending&&!m.error){
        const t=m.result?.thread;
        if(t?.id&&['thread/start','thread/resume','thread/fork'].includes(pending.method)) {
          // Resuming an already loaded thread does not necessarily apply its
          // config. Retain the last applied compensation until reload/readback.
          const record=this.record(t.id);if(record.model&&m.result.model&&record.model!==m.result.model){record.compensation=null;record.compensationKey=null;}record.seed={...record.seed,...pending.seed,config:{...record.seed.config,...pending.seed.config}};
          Object.assign(record,pick(t,['name','cwd','model','ephemeral','canAcceptDirectInput','threadSource']));
          record.model=m.result.model||record.model;record.status=t.status?.type||'idle';record.snapshot=m.result;const activeTurn=t.turns?.findLast(turn=>['inProgress','in_progress'].includes(turn.status));if(activeTurn)record.turnId=activeTurn.id;
          if(pending.method==='thread/start'&&pending.fork?.newChatPolicy&&!t.ephemeral&&t.canAcceptDirectInput!==false&&!t.forkedFromId){const policy=pending.fork.newChatPolicy;Object.assign(record,{newChatPolicy:policy,policy,policyVersion:policy.revision,appliedRevision:policy.revision,revision:policy.revision,configuredWindow:policy.window,expectedWindow:Math.floor(policy.window*(policy.effectivePercent??(this.contextCeiling?90:95))/100),freshUsage:false,usageFresh:false,phase:'awaiting_runtime_confirmation',message:'已沿用新对话默认设置，等待首次窗口读回。'});}
          if(pending.fork?.resumePolicy){const policy=pending.fork.resumePolicy;Object.assign(record,{policy,policyVersion:policy.revision,appliedRevision:policy.revision,revision:policy.revision,configuredWindow:policy.window,expectedWindow:Math.floor(policy.window*(policy.effectivePercent??(this.contextCeiling?90:95))/100),freshUsage:false,usageFresh:pending.fork.preserveUsage===true,phase:'awaiting_runtime_confirmation',message:'已保留原聊天预算，等待下一轮窗口读回。'});}
          if(pending.method==='thread/fork'&&pending.fork?.policy&&t.id!==pending.threadId&&!t.ephemeral&&t.canAcceptDirectInput!==false){
            const {policy,source,parentId,model}=pending.fork;
            record.forkedFromId=parentId;record.forkPolicy=source;record.inheritedUsage=pending.fork.inheritedUsage;
            record.policy=policy;record.policyVersion=policy.revision;record.appliedRevision=policy.revision;record.revision=policy.revision;
            record.configuredWindow=policy.window;record.modelInfo=model;
            const percent=model?.effective_context_window_percent;
            record.expectedWindow=Number.isInteger(percent)?Math.floor(policy.window*percent/100):null;
            record.freshUsage=false;record.usageFresh=false;record.phase='awaiting_runtime_confirmation';
            record.message='已继承父对话预算；等待分支首次请求读回窗口。';
          }else if(t.forkedFromId){record.forkedFromId=t.forkedFromId;}
          record.initializing=true;
          this.notify(record).finally(()=>{record.initializing=false;if(!record.locked){const queued=record.queue.splice(0);record.queueBytes=0;for(const line of queued)this.fromClient(line);}});
        }else if(pending.threadId&&['turn/start','thread/settings/update'].includes(pending.method)){
          const record=this.record(pending.threadId);Object.assign(record.sticky,pick(pending.seed,stickyFields));
          const nextModel=pending.seed.collaborationMode?.settings?.model||pending.seed.model;
          if(nextModel&&nextModel!==record.model){record.model=nextModel;record.modelInfo=null;record.freshUsage=false;record.usageFresh=false;record.expectedWindow=null;record.compensation=null;record.compensationKey=null;record.appliedRevision=null;}this.notify(record);
        }
      }
    }
    const p=m.params||{};const id=p.threadId||p.thread_id;
    if(id){
      const record=this.records.get(id);
      if(record){
        if(m.method==='thread/tokenUsage/updated'){
          record.usageGeneration=(record.usageGeneration??0)+1;record.observedWindow=p.tokenUsage.modelContextWindow;record.lastUsage=p.tokenUsage.last;record.inheritedUsage=null;record.freshUsage=true;record.usageFresh=true;
          if(record.expectedWindow!=null&&record.policy&&record.revision===record.policy.revision){record.phase=record.observedWindow===record.expectedWindow?'confirmed':'mismatch';record.message=record.phase==='confirmed'?(record.compensation?.status==='active'&&record.compensation.extraTokens>0?'运行时窗口已确认；目标容量以本 App 为准。':'下一轮窗口已读回确认。'):'实际窗口与目标不一致；请查看运行时或模型目录。';}
          this.notify(record);
        }
        if(m.method==='thread/status/changed'){record.status=p.status.type;this.notify(record);if(record.status==='idle')this.schedule(record);}
        if(m.method==='turn/started'){record.lastStartedAt=timestampMs(p.turn?.startedAt)??Date.now();record.status='active';record.turnId=p.turn.id;if(record.automaticTask?.status==='starting'&&!record.automaticTask.preparingContext){record.automaticTask.turnId=p.turn.id;record.automaticTask.status='running';}record.usageFresh=false;this.notify(record);}
        if(m.method==='error'&&record.compactionWait)record.compactionWait.reject(new Error(p.error?.message||'原生压缩失败'));
        if(m.method==='turn/completed'){record.compensationTurnPending=false;record.lastCompletedAt=timestampMs(p.turn?.completedAt)??Date.now();if(record.compactionWait){p.turn?.error||['failed','interrupted'].includes(p.turn?.status)?record.compactionWait.reject(new Error(p.turn?.error?.message||'原生压缩未完成')):record.compactionWait.resolve();}if(record.automaticTask&&record.automaticTask.turnId===p.turn.id){record.automaticTask.status=p.turn.error||p.turn.status==='failed'?'error':p.turn.status==='interrupted'?'interrupted':'completed';record.automaticTask.error=p.turn.error?.message??null;}record.status='idle';record.turnId=p.turn.id;this.notify(record);this.scheduleCompensatedCompaction(record);this.schedule(record);}
        if(m.method==='thread/name/updated'){record.name=p.name;this.notify(record);}
      }
    }
    this.writeFrontend(line);
  }
  rejectTurn(message,text){if(message.id!=null)this.writeFrontend(JSON.stringify({id:message.id,error:{code:-32000,message:`Context Control: ${text}`}}));}
  async guardTurn(record,message,line,incoming,reserve,cap){
    record.locked=true;record.phase='compacting';record.message='接近上下文上限，正在先压缩历史。';this.notify(record);
    const generation=record.usageGeneration??0;let timer;
    const completed=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('原生压缩等待超时，已保留新输入未发送。')),120000);record.compactionWait={resolve,reject};});
    completed.catch(()=>{});
    let ready=false;
    try{
      await this.rpc('thread/compact/start',{threadId:record.id});await completed;
      if((record.usageGeneration??0)<=generation)throw new Error('压缩后尚无用量记录，已暂停发送新输入。');
      if((record.lastUsage?.totalTokens??cap)+incoming+reserve>=cap)throw new Error('压缩后剩余空间仍不足，请减少新输入或开启新聊天。');
      ready=true;record.phase='awaiting_runtime_confirmation';record.message='压缩完成，继续提交新输入。';
    }catch(error){record.phase='error';record.message=error.message;this.rejectTurn(message,error.message);}
    finally{clearTimeout(timer);record.compactionWait=null;record.locked=false;this.notify(record);}
    if(ready)this.fromClient(line,null,true);
    const queued=record.queue.splice(0);record.queueBytes=0;for(const pending of queued)this.fromClient(pending);
  }
  publicRecord(record){return {...pick(record,['id','name','cwd','model','status','ephemeral','canAcceptDirectInput','observedWindow','expectedWindow','configuredWindow','lastUsage','freshUsage','usageFresh','phase','message','turnId','revision','forkedFromId','forkPolicy','newChatPolicy','threadSource','lastStartedAt','lastCompletedAt','automaticTask','compensation']),effort:inheritedTaskEffort(record)};}
  async prepareAutomatic(id){
    if(this.records.has(id)){await this.notify(this.records.get(id));return {ok:true};}
    const resolved=await this.resolveFork(id),policy=resolved?.policy?.enabled?(this.contextCeiling?migrateCeilingPolicy(resolved.policy,resolved.model):policyForModel(resolved.policy,resolved.model)):null;
    let config=policy?{model_context_window:policy.window,model_auto_compact_token_limit:policy.compact}:undefined;
    if(this.contextCeiling)config=ceilingConfig(config);
    const result=await this.rpc('thread/resume',{threadId:id,...(config?{config}:{})});
    if(result.thread?.id!==id)throw Error('后台加载返回了不同的聊天');
    const t=result.thread;if(t.ephemeral||t.canAcceptDirectInput===false||t.threadSource&&t.threadSource!=='user')throw Error('聊天不支持直接输入');
    const r=this.record(id);Object.assign(r,pick(t,['name','cwd','model','ephemeral','canAcceptDirectInput','threadSource']));r.seed=pick(result,resumeFields);r.seed.cwd??=t.cwd;r.model=result.model??t.model;r.status=t.status?.type??'idle';r.snapshot=result;
    const active=t.turns?.findLast(turn=>['inProgress','in_progress'].includes(turn.status));if(active)r.turnId=active.id;
    if(policy){Object.assign(r,{policy,policyVersion:policy.revision,appliedRevision:policy.revision,revision:policy.revision,configuredWindow:policy.window,phase:'awaiting_runtime_confirmation',modelInfo:resolved.model,expectedWindow:Math.floor(policy.window*(policy.effectivePercent??resolved.model?.effective_context_window_percent??95)/100)});}
    await this.notify(r);return {ok:true};
  }
  async prepareAutomaticContext(id,task){
    const r=this.records.get(id),generation=r.usageGeneration??0;
    r.automaticTask={executionId:task.executionId,taskId:task.taskId,status:'starting',preparingContext:true};await this.notify(r);
    try{await this.compact(id,(success,error)=>{void (async()=>{
      if(r.automaticTask?.executionId!==task.executionId||r.automaticTask.status!=='starting')return;
      try{if(!success)throw error||Error('原生压缩失败');if((r.usageGeneration??0)<=generation)throw Error('压缩后尚无用量记录，已暂停发送新输入。');await this.startAutomatic(id,task,true);}
      catch(failure){if(r.automaticTask?.executionId===task.executionId){r.automaticTask.status='error';r.automaticTask.error=failure.message;await this.notify(r);}}
    })();},true);return r.automaticTask;}
    catch(error){r.automaticTask.status='error';r.automaticTask.error=error.message;await this.notify(r);throw error;}
  }
  async startAutomatic(id,task,contextPrepared=false){
    const r=this.records.get(id);if(!r||r.ephemeral||r.canAcceptDirectInput===false)throw Error('聊天不支持直接输入');
    if(r.automaticTask?.executionId===task.executionId&&!contextPrepared)return r.automaticTask;
    if(task.adoptTurnId){if(r.status!=='active'||r.turnId!==task.adoptTurnId)throw Error('当前轮次已经变化');r.automaticTask={executionId:task.executionId,taskId:task.taskId,turnId:r.turnId,status:'running'};await this.notify(r);return r.automaticTask;}
    if(r.status!=='idle'||r.locked||r.initializing||[...this.external.values()].some(p=>p.threadId===id&&p.method==='turn/start'))throw Error('请等待聊天空闲');
    if(typeof task.prompt!=='string'||!task.prompt.trim()||task.prompt.length>16000)throw Error('任务提示词无效');
    const settings=normalizeTaskSettings(task.settings);
    const command=taskCommand(task.prompt);
    if(command){
      if(settings.attachments.length)throw Error('压缩指令不需要附件，请将附件放到下一项任务');
      r.automaticTask={executionId:task.executionId,taskId:task.taskId,command:'compact',status:'starting'};await this.notify(r);
      try{await this.compact(id,(success,error)=>{if(r.automaticTask?.executionId!==task.executionId)return;r.automaticTask.status=success?'completed':'error';r.automaticTask.error=error?.message??null;void this.notify(r);});if(r.automaticTask.status==='starting')r.automaticTask.status='running';await this.notify(r);return r.automaticTask;}
      catch(error){r.automaticTask.status='error';r.automaticTask.error=error.message;await this.notify(r);throw error;}
    }
    if(r.policy&&r.appliedRevision!==r.policy.revision){
      if(this.sameRuntimeBudget(r,r.policy)){r.appliedRevision=r.policy.revision;r.revision=r.policy.revision;}
      else await this.apply(r);
      if(r.phase==='needs_compaction'&&!contextPrepared)return this.prepareAutomaticContext(id,task);
      // A fresh usage record can only arrive after the next turn. Like a manual
      // turn, allow that observation under the runtime's current configuration;
      // do not shrink/reload history without preflight or mark the task failed.
      if(r.policy&&r.appliedRevision!==r.policy.revision&&r.phase!=='needs_observation')throw Error(r.message||'请先完成上下文预算应用');
      if(r.status!=='idle'||r.locked||r.initializing)throw Error('请等待聊天空闲');
    }
    for(const file of settings.attachments){try{if(!fs.statSync(file.path).isFile())throw Error();}catch{throw Error('附件不存在或无法读取：'+file.name);}}
    let selectedModel=settings.model||r.model,selectedEffort=settings.effort||(!settings.model||settings.model===r.model?inheritedTaskEffort(r):'medium');
    if(settings.model||settings.effort||settings.attachments.some(f=>f.kind==='image')){
      let cursor=null,catalogModel;
      for(let page=0;page<20;page++){const result=await this.rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});catalogModel=result.data?.find(m=>m.model===selectedModel||m.id===selectedModel);if(catalogModel||!result.nextCursor)break;cursor=result.nextCursor;}
      if(!catalogModel)throw Error('所选模型当前不可用，请重新选择');
      if(selectedEffort&&!catalogModel.supportedReasoningEfforts?.some(e=>e.reasoningEffort===selectedEffort)){if(settings.effort)throw Error('所选模型不支持此思考程度');selectedEffort=catalogModel.defaultReasoningEffort||catalogModel.supportedReasoningEfforts?.[0]?.reasoningEffort||'';}
      if(settings.attachments.some(f=>f.kind==='image')&&catalogModel.inputModalities&&!catalogModel.inputModalities.includes('image'))throw Error('所选模型不支持图片输入');
    }
    // Catalog reads are asynchronous; recheck turn ownership before submitting.
    if(r.status!=='idle'||r.locked||r.initializing||[...this.external.values()].some(p=>p.threadId===id&&p.method==='turn/start'))throw Error('请等待聊天空闲');
    const input=taskInput(task.prompt,settings),params={...pick(r.seed,stickyFields),...r.sticky,threadId:id,input};
    if(settings.approval!=='inherit'){
      params.permissions=null;
      params.approvalPolicy=settings.approval==='full'?'never':'on-request';
      params.approvalsReviewer=settings.approval==='auto'?'auto_review':'user';
      params.sandboxPolicy=settings.approval==='full'?{type:'dangerFullAccess'}:{type:'workspaceWrite',networkAccess:false};
    }
    if(settings.model)params.model=selectedModel;
    if(selectedEffort)params.effort=selectedEffort;
    if(params.collaborationMode&&(settings.model||selectedEffort))params.collaborationMode={...params.collaborationMode,settings:{...params.collaborationMode.settings,...(settings.model?{model:selectedModel}:{}),...(selectedEffort?{reasoning_effort:selectedEffort}:{})}};
    r.automaticTask={executionId:task.executionId,taskId:task.taskId,status:'starting'};await this.notify(r);
    try{
      if(this.resolveCompensation&&r.policy){r.locked=true;try{await this.syncCompensation(r,selectedModel);}finally{r.locked=false;}}
      if(this.contextCeiling||r.compensation?.enabled){const logical=r.policy&&Number.isInteger(r.modelInfo?.effective_context_window_percent)?Math.floor(r.policy.window*r.modelInfo.effective_context_window_percent/100):null;const incoming=incomingTokens(input),cap=Math.min(logical??r.expectedWindow??r.observedWindow??MAX_CONTEXT_INPUT,this.contextCeiling?MAX_CONTEXT_INPUT:Number.MAX_SAFE_INTEGER),reserve=Math.max(r.policy?.reserve??MIN_CONTEXT_RESERVE,MIN_CONTEXT_RESERVE);if(incoming==null||incoming+reserve>=cap)throw Error('新输入本身已接近上下文上限，请拆分输入。');if((r.lastUsage?.totalTokens??0)+incoming+reserve>=Math.min(cap,(r.policy?.compact??MAX_CONTEXT_COMPACT)+reserve)){if(!contextPrepared)return this.prepareAutomaticContext(id,task);throw Error('压缩后上下文仍接近上限，已暂停任务');}}
      const result=await this.rpc('turn/start',params);if(!result?.turn?.id)throw Error('运行时未返回任务轮次');Object.assign(r.sticky,pick(params,stickyFields));if(settings.model){r.model=selectedModel;r.modelInfo=null;r.usageFresh=false;}if(['starting','running'].includes(r.automaticTask.status)){r.automaticTask.turnId=result.turn.id;r.automaticTask.status=result.turn.status==='completed'?'completed':'running';r.status=r.automaticTask.status==='completed'?'idle':'active';r.turnId=result.turn.id;}await this.notify(r);return r.automaticTask;}
    catch(error){r.automaticTask.status='error';r.automaticTask.error=error.message;await this.notify(r);throw error;}
    finally{const queued=r.queue.splice(0);r.queueBytes=0;for(const line of queued)this.fromClient(line);}
  }
  async interruptAutomatic(id,executionId){const r=this.records.get(id),task=r?.automaticTask;
    if(task?.executionId===executionId&&task.preparingContext&&task.status==='starting'){task.status='interrupted';if(r.status==='active'&&r.turnId)await this.rpc('turn/interrupt',{threadId:id,turnId:r.turnId});await this.notify(r);return {ok:true};}
    if(task?.executionId!==executionId||task.status!=='running'||r.status!=='active'||r.turnId!==task.turnId)throw Error('队列轮次已变化，未中断其他任务');await this.rpc('turn/interrupt',{threadId:id,turnId:task.turnId});return {ok:true};}
  notify(record){
    return Promise.resolve(this.publish(this.publicRecord(record))).then(reply=>{
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
  sameRuntimeBudget(record,policy){
    const config=record.seed?.config;
    return record.appliedRevision!=null&&record.configuredWindow===policy.window&&config?.model_context_window===policy.window&&config?.model_auto_compact_token_limit===policy.compact;
  }
  setPolicy(id,policy,model){
    const r=this.records.get(id);if(!r)throw new Error('此连接尚未加载聊天');
    if(policy.revision<(r.policyVersion||0)||(policy.revision===r.policyVersion&&!r.policy))return {ignored:true};
    if(policy.revision===r.policyVersion){if(model)r.modelInfo=model;this.schedule(r);return {queued:r.appliedRevision!==policy.revision};}
    r.policy=policy;r.policyVersion=policy.revision;if(model)r.modelInfo=model;
    if(this.sameRuntimeBudget(r,policy)){
      r.appliedRevision=policy.revision;r.revision=policy.revision;r.phase='awaiting_runtime_confirmation';r.message='预算配置未变，等待下一轮实际窗口读回。';this.notify(r);return {queued:false};
    }
    const plan=preflight(r,policy,r.modelInfo);
    r.phase=r.locked?'reloading':plan.allowed?'queued':plan.code;
    r.message=r.locked?'已收到最新预算；正在完成重新加载。':plan.allowed?'等待轮次结束与预检。':plan.message;
    this.notify(r);this.schedule(r);return {queued:true};
  }
  clearPolicy(id,revision){const r=this.records.get(id);if(r){const next=revision??(r.policyVersion||0)+1;if(next<(r.policyVersion||0))return {ignored:true};r.policyVersion=next;r.policy=null;r.phase='saved';r.message='已停止自动应用；当前窗口保持现值。';this.notify(r);}return {ok:true};}
  schedule(record){if(record.locked||!record.policy||record.appliedRevision===record.policy.revision||record.status!=='idle')return;queueMicrotask(()=>this.apply(record).catch(()=>{}));}
  scheduleCompensatedCompaction(record){
    // Compensation changes a local counter only. Independently compact once a
    // completed response reaches the saved real threshold, even when the
    // upstream server already included reasoning in its count.
    const needed=()=>record.compensation?.enabled && (this.resolveCompensation?.isEnabled?.()??true) && record.policy?.enabled!==false && record.policy && record.status==='idle' && !record.locked && record.usageFresh===true && Number.isSafeInteger(record.lastUsage?.totalTokens) && record.lastUsage.totalTokens>=record.policy.compact;
    if(!needed() || record.protectedUsageGeneration===record.usageGeneration)return;
    queueMicrotask(()=>{
      if(!needed() || record.protectedUsageGeneration===record.usageGeneration)return;
      record.protectedUsageGeneration=record.usageGeneration;
      this.compact(record.id,undefined,true).catch(error=>{record.phase='error';record.message=error.message;this.notify(record);});
    });
  }
  async compact(id,onFinished,automatic=false){
    const r=this.records.get(id);
    if(!r||r.status!=='idle'||r.locked||r.initializing||r.ephemeral||r.canAcceptDirectInput===false||[...this.external.values()].some(p=>p.threadId===id&&['turn/start','thread/compact/start'].includes(p.method)))throw new Error('请等待当前轮次结束后再压缩');
    r.locked=true;r.freshUsage=false;r.usageFresh=false;r.phase='compacting';r.message=automatic?'实际用量达到阈值，正在原生压缩':'正在手动压缩上下文';this.notify(r);
    let timer;
    const completed=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('手动压缩等待超时，请刷新聊天状态后重试')),120000);timer.unref?.();r.compactionWait={resolve,reject};});
    completed.catch(()=>{});
    const finish=async()=>{
      let success=false,failure=null;
      try{await completed;success=true;r.phase='needs_observation';r.message='已请求原生压缩；完成后请等待下一轮用量记录。';}
      catch(error){failure=error;r.phase='error';r.message=error.message;}
      finally{clearTimeout(timer);r.compactionWait=null;r.locked=false;this.notify(r);}
      onFinished?.(success,failure);
      const queued=r.queue.splice(0);r.queueBytes=0;
      for(const line of queued){if(success)this.fromClient(line);else{try{this.rejectTurn(JSON.parse(line),r.message);}catch{}}}
      if(success)this.schedule(r);
    };
    const finished=finish();
    try{await this.rpc('thread/compact/start',{threadId:id});}
    catch(error){r.compactionWait?.reject(error);await finished;throw error;}
    return {started:true,message:'已请求原生压缩；完成后请等待下一轮用量记录。'};
  }
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
  async reload(record,policy,plan,preparedBudget=null){
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
      if(this.contextCeiling)resume.config=ceilingConfig(resume.config);
      const budget=preparedBudget??await this.runtimeBudget(record,policy);
      Object.assign(resume.config,{model_context_window:budget.window,model_auto_compact_token_limit:budget.compact});
      await this.rpc('thread/unsubscribe',{threadId:record.id});detached=true;
      const after=await this.rpc('thread/resume',resume);
      const restore={threadId:record.id,effort:before.reasoningEffort??null,disabledPluginIds:before.disabledPluginIds||[],...pick(record.sticky,['summary'])};
      if(before.collaborationMode)restore.collaborationMode=before.collaborationMode;
      if(!resume.permissions)restore.sandboxPolicy=before.sandbox;
      await this.rpc('thread/settings/update',restore);
      if(after.model!==before.model||after.modelProvider!==before.modelProvider)throw new Error('模型或提供方发生意外变化，已停止确认');
      record.seed={...record.seed,...resume};record.snapshot=after;record.appliedRevision=policy.revision;record.revision=policy.revision;
      record.configuredWindow=policy.window;record.expectedWindow=budget.details.runtimeWindow??plan.expectedWindow;record.compensation=budget.details;record.compensationKey=this.budgetKey(policy,budget);record.freshUsage=false;
      record.phase='awaiting_runtime_confirmation';record.message='已重新加载；等待下一轮实际窗口读回。';
      return true;
    }catch(error){
      if(detached&&originalParams){try{await this.rpc('thread/resume',originalParams);}catch{}}
      record.phase='error';record.message=error.message;
      return false;
    }
  }
}
