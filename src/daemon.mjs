import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Peer,request} from './ipc.mjs';
import {root,socketPath,ensureRoot,atomicJSON} from './paths.mjs';
import {Store} from './store.mjs';
import {normalizePolicy,preflight} from './policy.mjs';
import {savedBudget} from './budget.mjs';
import {ensureMenuBarEntry} from './menu-bar.mjs';
import {reconcileWindowConfirmation} from './confirmation.mjs';

export async function startDaemon() {
  ensureRoot();
  try {await request('ping');return null;}catch{}
  const lockFile=path.join(root,'service.lock');
  try {fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    let live=true;
    try {const owner=JSON.parse(fs.readFileSync(lockFile,'utf8'));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')live=false;}}
    catch{live=Date.now()-fs.statSync(lockFile).mtimeMs<5000;}
    if(live)return null;
    fs.unlinkSync(lockFile);fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
  }
  process.once('exit',()=>{try{if(JSON.parse(fs.readFileSync(lockFile,'utf8')).pid===process.pid)fs.unlinkSync(lockFile);}catch{}});
  try {fs.unlinkSync(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  const store=new Store();await store.seedRecentMetadata();
  for(const t of Object.values(store.data.threads)){t.freshUsage=false;t.phase='disconnected';}
  store.save();
  const bridges=new Map();const owners=new Map();
  function rebuildOwners(){owners.clear();for(const [peer,b]of bridges)for(const id of b.ids){if(!owners.has(id))owners.set(id,[]);owners.get(id).push(peer);}}
  function state(){return {version:'0.4.1',bridgeCount:bridges.size,threads:Object.keys(store.data.threads).map(id=>store.publicThread(id,owners)).sort((a,b)=>(b.observedAt||0)-(a.observedAt||0))};}
  async function handle(peer,op,p) {
    if(op==='ping')return {ok:true,version:'0.4.1'};
    if(op==='state')return state();
    if(op==='registerBridge'){const first=bridges.size===0;const entry={ids:new Set(),pid:p.pid};bridges.set(peer,entry);if(first)ensureMenuBarEntry();peer.socket.on('close',()=>{bridges.delete(peer);rebuildOwners();for(const id of entry.ids){if(!owners.has(id)&&store.data.threads[id])Object.assign(store.data.threads[id],{freshUsage:false,phase:'disconnected',message:'连接已断开；显示的是上次观测值。'});}store.save();});return {ok:true};}
    if(op==='updateThread') {
      const b=bridges.get(peer);if(!b)throw new Error('未注册运行时连接');
      if(typeof p.id!=='string'||p.id.length>180)throw new Error('聊天 ID 无效');
      b.ids.add(p.id);rebuildOwners();
      const allowed=['id','name','cwd','model','status','ephemeral','canAcceptDirectInput','observedWindow','expectedWindow','configuredWindow','lastUsage','freshUsage','phase','message','turnId','revision','observedAt'];
      const clean=Object.fromEntries(allowed.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]));
      if(typeof clean.name==='string'&&(clean.name.length>120||/[\r\n]/.test(clean.name)))clean.name=null;
      store.data.threads[p.id]={...store.data.threads[p.id],...clean,observedAt:Date.now()};
      Object.assign(store.data.threads[p.id],reconcileWindowConfirmation(store.data.threads[p.id],store.data.policies[p.id],store.model(store.data.threads[p.id].model)));store.save();
      return {policy:store.data.policies[p.id]||null,model:store.model(clean.model||store.data.threads[p.id].model)};
    }
    if(op==='preflight') {
      const policy=normalizePolicy(p.policy);const t=store.data.threads[p.id];
      return preflight(t,policy,store.model(t?.model));
    }
    if(op==='setPolicy') {
      const t=store.data.threads[p.id];if(!t)throw new Error('未找到聊天');
      const policy=normalizePolicy(p.policy);const plan=preflight(t,policy,store.model(t.model));
      if(['above_catalog_maximum','below_retained_floor','unsupported_thread'].includes(plan.code))throw new Error(plan.message);
      const previous=store.data.policies[p.id];
      if(p.expectedRevision!=null&&p.expectedRevision!==(previous?.revision||0))throw new Error('设置已在另一窗口更新，请刷新后重试');
      const saved={...policy,revision:(previous?.revision||0)+1,enabled:p.apply!==false,updatedAt:Date.now()};
      store.data.policies[p.id]=saved;
      const candidates=owners.get(p.id)||[];
      Object.assign(t,{phase:p.apply===false?'saved':candidates.length===1?'queued':'waiting_bridge',message:p.apply===false?'已保存；尚未请求应用。':candidates.length>1?'多个运行时加载了此聊天，请先关闭其中一个。':'等待接入 Codex 的连接。'});
      store.save();
      if(saved.enabled&&candidates.length===1){await candidates[0].call('setPolicy',{id:p.id,policy:saved,model:store.model(t.model)});}
      return {policy:saved,plan,thread:store.publicThread(p.id,owners)};
    }
    if(op==='clearPolicy'){
      const previous=store.data.policies[p.id];if(previous)store.data.policies[p.id]={...previous,enabled:false,revision:previous.revision+1};store.save();
      const candidates=owners.get(p.id)||[];for(const candidate of candidates)await candidate.call('clearPolicy',{id:p.id});
      return {ok:true,message:'已停止后续自动应用；当前运行时窗口保持现值。'};
    }
    if(op==='compact'){
      const candidates=owners.get(p.id)||[];if(candidates.length!==1)throw new Error('需要唯一的已接入运行时');
      return candidates[0].call('compact',{id:p.id},30000);
    }
    if(op==='hook') {
      const t=Object.values(store.data.threads).find(t=>t.id===p.sessionId&&(!p.turnId||t.turnId===p.turnId));
      if(!t)return {};
      const policy=store.data.policies[t.id];const fmt=n=>Number.isSafeInteger(n)?n.toLocaleString('en-US'):'待观测';
      const lines=[`Context Control｜实际窗口 ${fmt(t.observedWindow)}｜最近请求 ${fmt(t.lastUsage?.totalTokens)}（占用估算）`];
      if(policy){const budget=savedBudget(policy,store.model(t.model));lines.push(`目标可用 ${fmt(budget?.usableWindow)}｜压缩 ${budget?.compactPercent??'待识别'}%（${fmt(budget?.compact)}）｜${t.message||t.phase||'等待接入'}`);}
      else lines.push('未设置该聊天的独立预算。');
      return {systemMessage:lines.join('\n')};
    }
    throw new Error('不支持的操作');
  }
  const ipcServer=net.createServer(socket=>{let peer;peer=new Peer(socket,(op,p)=>handle(peer,op,p));});
  await new Promise((resolve,reject)=>{ipcServer.once('error',reject);ipcServer.listen(socketPath,resolve);});fs.chmodSync(socketPath,0o600);
  const token=crypto.randomBytes(32).toString('hex');
  const web=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(req.headers.authorization||'');
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')||req.headers.origin||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){res.writeHead(403);res.end('Forbidden');return;}
    try {
      let body='';for await(const data of req){body+=data;if(body.length>65536)throw new Error('请求过大');}
      const params=body?JSON.parse(body):{};const route=req.url;
      let answer;
      if(req.method==='GET'&&route==='/state')answer=state();
      else if(req.method==='POST'&&route==='/preflight')answer=await handle(null,'preflight',params);
      else if(req.method==='POST'&&route==='/policy')answer=await handle(null,'setPolicy',params);
      else if(req.method==='POST'&&route==='/clear')answer=await handle(null,'clearPolicy',params);
      else if(req.method==='POST'&&route==='/compact')answer=await handle(null,'compact',params);
      else{res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(answer));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
  atomicJSON(path.join(root,'connection.json'),{port:web.address().port,token,pid:process.pid});
  const shutdown=()=>{for(const p of bridges.keys())p.socket.destroy();ipcServer.close();web.close();try{fs.unlinkSync(socketPath);}catch{}try{fs.unlinkSync(path.join(root,'connection.json'));}catch{};process.exit(0);};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {ipcServer,web,store};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href)startDaemon().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
