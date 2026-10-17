import path from 'node:path';
import fs from 'node:fs';
import {root,codexHome,readJSON,atomicJSON} from './paths.mjs';
import {activityTime,timestampMs,readNativeTurnActivity} from './thread-activity.mjs';
import {readForkParent} from './fork-metadata.mjs';
import {inheritedForkPolicy} from './fork-budget.mjs';

export class Store {
  constructor(){this.file=path.join(root,'state.json');this.data=readJSON(this.file,{version:2,policies:{},threads:{}});const legacy=this.data.version<2;for(const t of Object.values(this.data.threads)){if(legacy||(t.name&&(t.name.length>120||/[\r\n]/.test(t.name))))t.name=null;}this.data.version=2;this.metadata=new Map();this.metadataCheckedAt=0;}
  save(){clearTimeout(this.saveTimer);this.saveTimer=null;atomicJSON(this.file,this.data);this.dirty=false;this.writes=(this.writes??0)+1;}
  scheduleSave(delay=150){this.dirty=true;if(this.saveTimer)return;this.saveTimer=setTimeout(()=>{this.saveTimer=null;try{this.save();}catch(error){if(Date.now()-(this.lastSaveErrorAt??0)>15000){this.lastSaveErrorAt=Date.now();process.stderr.write('Context Control: 观测状态保存失败：'+error.message+'\n');}}},delay);this.saveTimer.unref();}
  flush(){if(this.dirty)this.save();}
  diagnostics(){return {writes:this.writes??0,observationSavePending:!!this.saveTimer};}
  inheritDiscoveredForks(){
    let changed=false;
    const inherit=(id,seen=new Set())=>{
      if(Object.hasOwn(this.data.policies,id)||seen.has(id)||seen.size>=16)return;
      const thread=this.data.threads[id],parent=thread?.forkedFromId;
      if(!parent||parent===id||thread.ephemeral||thread.canAcceptDirectInput===false||thread.archived)return;
      seen.add(id);inherit(parent,seen);
      try{
        const policy=inheritedForkPolicy(this.data.policies[parent],parent);
        if(policy){
          this.data.policies[id]={...policy,updatedAt:Date.now()};changed=true;
          thread.phase='waiting_bridge';thread.message='已继承父聊天预算；接入后将在轮次之间自动应用。';
        }
      }catch{/* An invalid parent policy must not prevent other chats loading. */}
    };
    for(const id of Object.keys(this.data.threads))inherit(id);
    return changed;
  }
  model(slug){
    const file=process.env.CONTEXT_CONTROL_CATALOG_PATH||path.join(codexHome,'models_cache.json');
    try {
      const stat=fs.statSync(file),stamp=`${file}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if(this.catalogStamp!==stamp){
        this.catalogStamp=stamp;this.catalog=new Map();
        const data=readJSON(file,{});for(const model of data.models??[])this.catalog.set(model.slug,model);
      }
      return this.catalog?.get(slug)||null;
    }catch {this.catalogStamp=null;this.catalog=new Map();return null;}
  }
  publicThread(id,owners=new Map()) {
    this.refreshMetadata();
    const t=this.data.threads[id]||{id};const ownersForThread=owners.get(id)||[];
    const model=this.model(t.model);
    const merged={...t,...this.metadata.get(id)};
    return {...merged,lastActivityAt:activityTime(merged),connected:ownersForThread.length===1,ambiguous:ownersForThread.length>1,policy:this.data.policies[id]||null,
      modelMetadata:model?Object.fromEntries(['context_window','max_context_window','effective_context_window_percent'].map(k=>[k,model[k]])):null};
  }
  // Optional metadata index and bounded session header; no conversation scan.
  async seedRecentMetadata(){
    try{this.DatabaseSync=(await import('node:sqlite')).DatabaseSync;this.refreshMetadata(true);}catch{/* Metadata discovery is optional. */}
  }
  refreshMetadata(force=false){
    if(!this.DatabaseSync||(!force&&Date.now()-this.metadataCheckedAt<2000))return;
    this.metadataCheckedAt=Date.now();
    try {
      const files=fs.readdirSync(codexHome).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
      if(!files.length)return;
      const db=new this.DatabaseSync(path.join(codexHome,files[0]),{readOnly:true});
      try {
        const cols=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
        if(!cols.has('id'))return;
        // Use the explicit native name, never the legacy title/first prompt.
        const selected=['id','name','cwd','updated_at','updated_at_ms','recency_at','recency_at_ms','created_at','created_at_ms','thread_source','archived','rollout_path'].filter(c=>cols.has(c));
        const hasRecencyColumn=cols.has('recency_at_ms')||cols.has('recency_at');
        const candidates=['recency_at_ms','recency_at','created_at_ms','created_at',...(!hasRecencyColumn?['updated_at_ms','updated_at']:[])].filter(c=>cols.has(c));
        const expressions=candidates.map(c=>`NULLIF(${c},0)${c.endsWith('_ms')?'':'*1000'}`);
        const order=expressions.length?` ORDER BY COALESCE(${expressions.join(',')},0) DESC`:'';
        const where=cols.has('archived')?' WHERE archived=0':'';
        const recent=db.prepare(`SELECT ${selected.join(',')} FROM threads${where}${order} LIMIT 30`).all();
        const rows=new Map(recent.map(row=>[row.id,row]));
        const ids=Object.keys(this.data.threads);
        for(let offset=0;offset<ids.length;offset+=200){
          const batch=ids.slice(offset,offset+200);
          for(const row of db.prepare(`SELECT ${selected.join(',')} FROM threads WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch))rows.set(row.id,row);
        }
        const turnActivity=readNativeTurnActivity(codexHome,[...rows.keys()],this.DatabaseSync);
        const metadata=new Map();
        this.forkHeaderCache??=new Map();
        for(const row of rows.values()) {
          const current={...turnActivity.get(row.id)};
          if(cols.has('thread_source'))current.threadSource=row.thread_source;
          current.createdAt=timestampMs(row.created_at_ms)??timestampMs(row.created_at);
          const hasRecency=cols.has('recency_at_ms')||cols.has('recency_at');
          current.nativeActivityAt=timestampMs(row.recency_at_ms)??timestampMs(row.recency_at)??current.createdAt??(!hasRecency?(timestampMs(row.updated_at_ms)??timestampMs(row.updated_at)):null);

          if(cols.has('name'))current.name=typeof row.name==='string'&&row.name.length<=120&&!/[\r\n]/.test(row.name)?row.name:null;
          if(cols.has('archived'))current.archived=row.archived===1;
          const parent=readForkParent(codexHome,row.id,row.rollout_path,this.forkHeaderCache);
          if(parent)current.forkedFromId=parent;
          metadata.set(row.id,current);
          if(!this.data.threads[row.id]&&!current.archived)this.data.threads[row.id]={id:row.id,name:null,cwd:row.cwd||null,status:'notLoaded',freshUsage:false};
          if(this.data.threads[row.id])Object.assign(this.data.threads[row.id],current);
        }
        // Keep native names authoritative even when an older bridge continues
        // publishing the title it captured before Codex renamed the fork.
        this.metadata=metadata;
        if(this.inheritDiscoveredForks())this.save();
      }finally{db.close();}
    }catch{/* Keep the last known metadata if the native index is unavailable. */}
  }
}
