import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadBlocks,treeBytes} from './backup-blocks.mjs';
import {durableWrite,readProtectedJSON,writeProtectedJSON} from './durable-files.mjs';
import {validateProtectedFile} from './codex-power-protection.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const allowed=name=>name==='config.toml'||name==='.codex-global-state.json'||/^state_\d+\.sqlite$/.test(name);
const activePhases=new Set(['closing','waiting_exit','waiting_quiet','applying','interrupted']);
export class CodexRestore {
 constructor({home,directory,isRunning,reopen,close=async()=>{},prepareClose=async()=>{},now=()=>Date.now(),quietMs=3000}){
  Object.assign(this,{home,directory,isRunning,reopen,close,prepareClose,now,quietMs});this.jobFile=path.join(directory,'restore-job.json');this.job=readProtectedJSON(this.jobFile,null);this.busy=false;
  if(this.job?.phase==='applying'){this.job.phase='interrupted';this.job.message='恢复被中断；退出 Codex 后将回退到恢复前状态';this.save();}
 }
 get active(){return activePhases.has(this.job?.phase);}
 save(){writeProtectedJSON(this.jobFile,this.job);}
 source(id){if(typeof id!=='string'||!/^(recent|daily):\d+-[a-f0-9]+$/.test(id))throw Error('无效恢复点');const [tier,generation]=id.split(':');return path.join(this.directory,tier,generation);}
 list(){const points=[];for(const tier of ['recent','daily']){const base=path.join(this.directory,tier);let dirs=[];try{dirs=fs.readdirSync(base).filter(n=>/^\d+-[a-f0-9]+$/.test(n));}catch{}
  for(const id of dirs)try{const doc=JSON.parse(fs.readFileSync(path.join(base,id,'manifest.json'))),files=Object.entries(doc.files).filter(([name])=>allowed(name)).map(([name,entry])=>({name,bytes:entry.size}));if(!files.length)continue;points.push({id:tier+':'+id,at:doc.at,tier,files,bytes:files.reduce((n,f)=>n+f.bytes,0)});}catch{}
 }return {points:points.sort((a,b)=>b.at.localeCompare(a.at)),job:this.job,storedBytes:treeBytes(this.directory)};}
 async command(params){if(params.action==='list')return this.list();
  if(params.action==='cancel'){if(this.busy||!['waiting_exit','waiting_quiet'].includes(this.job?.phase))throw Error('当前恢复无法取消');this.job.phase='cancelled';this.job.message='已取消，未修改 Codex';this.save();return this.list();}
  if(params.action!=='restore')throw Error('未知恢复操作');if(this.active||this.busy)throw Error('已有恢复任务，请等待或取消');
  const source=this.source(params.id),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),entries=Object.entries(manifest.files).filter(([name])=>allowed(name));if(!entries.length)throw Error('恢复点没有可恢复内容');
  const selectedDBs=entries.map(([name])=>name).filter(n=>/^state_\d+\.sqlite$/.test(n));const currentDBs=fs.readdirSync(this.home).filter(n=>/^state_\d+\.sqlite$/.test(n));
  if(currentDBs.some(n=>!selectedDBs.includes(n)))throw Error('当前 Codex 数据库版本与恢复点不一致，请先进行兼容性检查');
  const id=crypto.randomBytes(12).toString('hex'),stage=path.join(this.directory,'manual',id);fs.mkdirSync(stage,{recursive:true,mode:0o700});
  try{const base=path.join(this.directory,'manual');const old=fs.readdirSync(base).filter(n=>/^[a-f0-9]{24}$/.test(n)&&n!==id&&n!==this.job?.id);for(const name of old)fs.rmSync(path.join(base,name),{recursive:true,force:true});}catch{}
  // Materialize and validate the entire selection before queuing, so rotation cannot invalidate it.
  try{for(const [name,entry]of entries){const bytes=loadBlocks(path.join(path.dirname(source),'blocks'),entry),file=path.join(stage,name);durableWrite(file,bytes);validateProtectedFile(name,file);}}catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
  this.job={id,point:params.id,autoClose:params.close===true,at:manifest.at,phase:'waiting_exit',message:'请完整退出 Codex，保持管理器运行；恢复完成后将自动打开 Codex',files:entries.map(([name])=>name),createdAt:this.now()};this.save();this.quietSince=null;return this.list();
 }
 async tick(){if(this.busy||!this.active)return;this.busy=true;try{
  if(!this.job.prepared){await this.prepareClose();this.job.prepared=true;this.save();}
  if(this.job.autoClose&&!this.job.closeAttempted){this.job.closeAttempted=true;this.job.phase='closing';this.job.message='正在暂停队列并关闭 Codex 和 CLI';this.save();await this.close();}
  if(await this.isRunning()){this.quietSince=null;if(this.job.phase!=='interrupted'){this.job.phase='waiting_exit';this.job.message='等待 Codex 和 CLI 完全退出；请勿手动重开';this.save();}return;}
  if(this.quietSince==null){this.quietSince=this.now();if(this.job.phase!=='interrupted'){this.job.phase='waiting_quiet';this.job.message='已退出，正在确认文件停止写入；请勿手动重开';this.save();}return;}
  if(this.now()-this.quietSince<this.quietMs)return;
  if(await this.isRunning()){this.quietSince=null;return;}
  if(!/^[a-f0-9]{24}$/.test(this.job.id)||!Array.isArray(this.job.files)||!this.job.files.every(allowed))throw Error('恢复任务记录无效');
  const stage=path.join(this.directory,'manual',this.job.id),before=path.join(stage,'before');
  if(this.job.phase==='interrupted'){
   const record=JSON.parse(fs.readFileSync(path.join(stage,'before.json'))),rollback=[];
   for(const [name,entry]of Object.entries(record)){if(!allowed(name)&&name!=='.codex-global-state.json.bak'&&!/^state_\d+\.sqlite-(wal|shm)$/.test(name))throw Error('无效回退文件');const bytes=entry.present?fs.readFileSync(path.join(before,name)):null;if(bytes&&hash(bytes)!==entry.sha256)throw Error('恢复前副本校验失败，已停止回退');rollback.push({name,bytes});}
   for(const {name,bytes}of rollback){const target=path.join(this.home,name);if(bytes)durableWrite(target,bytes);else fs.rmSync(target,{force:true});}
   this.job.phase='failed';this.job.message='上次恢复中断，已回退；可重新选择恢复点';this.save();return;
  }
  // Validate once more before touching the live files.
  for(const name of this.job.files)validateProtectedFile(name,path.join(stage,name));
  const targets=[...this.job.files];for(const name of this.job.files)if(name.endsWith('.sqlite'))targets.push(name+'-wal',name+'-shm');
  if(this.job.files.includes('.codex-global-state.json'))targets.push('.codex-global-state.json.bak');
  const record={};for(const name of targets){const file=path.join(this.home,name);const present=fs.existsSync(file),bytes=present?fs.readFileSync(file):null;record[name]={present,sha256:bytes?hash(bytes):null};if(bytes)durableWrite(path.join(before,name),bytes);}
  durableWrite(path.join(stage,'before.json'),JSON.stringify(record));
  if(await this.isRunning()){this.quietSince=null;return;}
  this.job.phase='applying';this.job.message='正在恢复并校验，请勿打开 Codex';this.save();
  try{
   for(const name of targets){const file=path.join(this.home,name);if(/\.sqlite-(wal|shm)$/.test(name))fs.rmSync(file,{force:true});else{const source=name==='.codex-global-state.json.bak'?'.codex-global-state.json':name;durableWrite(file,fs.readFileSync(path.join(stage,source)));}}
   for(const name of this.job.files){const file=path.join(this.home,name);validateProtectedFile(name,file);if(hash(fs.readFileSync(file))!==hash(fs.readFileSync(path.join(stage,name))))throw Error('恢复后的文件校验不一致');}
  }catch(error){this.job.phase='interrupted';this.job.message='恢复未完成，等待安全回退：'+error.message;this.save();this.quietSince=null;return;}
  if(await this.isRunning()){this.job.phase='interrupted';this.job.message='恢复期间 Codex 被提前打开；请退出 Codex，等待安全回退后重试';this.quietSince=null;this.save();return;}
  this.job.phase='completed';this.job.completedAt=this.now();this.job.message='恢复及校验完成';this.save();
  try{if(!await this.isRunning())await this.reopen();this.job.message='恢复完成，已重新打开 Codex';}catch(error){this.job.message='恢复完成，请手动打开 Codex：'+error.message;}
  this.save();
 }catch(error){this.job.phase=['applying','interrupted'].includes(this.job.phase)?'interrupted':'failed';this.job.message=error.message;this.quietSince=null;this.save();}finally{this.busy=false;}}
 start(){const run=()=>void this.tick().catch(error=>{if(!this.lastErrorAt||this.now()-this.lastErrorAt>15000){this.lastErrorAt=this.now();process.stderr.write('Codex restore: '+error.message+'\n');}});const timer=setInterval(run,1000);timer.unref();return timer;}
}
