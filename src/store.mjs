import path from 'node:path';
import {normalizeStateDocument} from './core/state-document.mjs';
import fs from 'node:fs';
import {root,codexHome,readJSON,atomicJSON} from './paths.mjs';
import {activityTime,timestampMs,readNativeTurnActivity,compareThreadActivity} from './thread-activity.mjs';
import {readForkParent} from './fork-metadata.mjs';
import {ThreadCache} from './thread-cache.mjs';
import {ProjectCatalog} from './project-catalog.mjs';
import {inheritedForkPolicy} from './fork-budget.mjs';
import {HOT_CHAT_LIMIT,visibleChat} from './core/hot-chats.mjs';

export class Store {
  constructor(){this.file=path.join(root,'state.json');const saved=readJSON(this.file,{version:2,policies:{},threads:{}});this.data=normalizeStateDocument(saved);this.metadata=new Map();this.metadataCheckedAt=0;this.threadCache=new ThreadCache({home:codexHome,file:path.join(root,'thread-cache.json')});this.projects=new ProjectCatalog(codexHome);}
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
  publicThread(id,owners=new Map(),{refreshMetadata=true}={}) {
    if(refreshMetadata)this.refreshMetadata(false,[id]);
    const t=this.data.threads[id]||{id};const ownersForThread=owners.get(id)||[];
    const cached=ownersForThread.length===0?this.threadCache.get(id):null;
    const observation=cached&&(!t.lastUsage||(cached.observedAt??0)>(t.observedAt??0))?cached:{};
    const merged={...t,...observation,...this.metadata.get(id)};
    if(ownersForThread.length===0){merged.freshUsage=false;merged.usageFresh=false;merged.phase=merged.lastUsage?'cached':'local';merged.message=merged.lastUsage?'已显示本地缓存；打开聊天后实时同步。':'已发现本地聊天；打开后实时同步。';}
    const model=this.model(merged.model);
    return {...merged,lastActivityAt:activityTime(merged),connected:ownersForThread.length===1,ambiguous:ownersForThread.length>1,policy:this.data.policies[id]||null,
      modelMetadata:model?Object.fromEntries(['context_window','max_context_window','effective_context_window_percent'].map(k=>[k,model[k]])):null};
  }
  // Discover the local index; numeric observations are refreshed asynchronously.
  async seedRecentMetadata(){
    try{this.DatabaseSync=(await import('node:sqlite')).DatabaseSync;this.refreshMetadata(true);}catch{/* Metadata discovery is optional. */}
  }
  async scanLocal(){this.refreshMetadata(true);await this.threadCache.running;return this.refreshObservations(true);}
  refreshObservations(force=false){if(!force&&Date.now()-(this.observationsCheckedAt??0)<15000)return this.threadCache.running??Promise.resolve();this.observationsCheckedAt=Date.now();return this.threadCache.scan(this.scanRows??[]);}
  setRequiredIds(ids){this.requiredIds=new Set(ids);}
  listLocal(offset=0){
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('Invalid chat offset');
    const fallback=()=>{const rows=Object.values(this.data.threads).filter(visibleChat).sort(compareThreadActivity).slice(offset,offset+HOT_CHAT_LIMIT+1);return {chats:rows.slice(0,HOT_CHAT_LIMIT).map(t=>({id:t.id,name:t.name??null,model:t.model??null,cwd:t.cwd??null})),offset,hasMore:rows.length>HOT_CHAT_LIMIT,cached:true};};
    let db;
    try{
      const file=fs.readdirSync(codexHome).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];if(!file||!this.DatabaseSync)return fallback();
      db=new this.DatabaseSync(path.join(codexHome,file),{readOnly:true});const cols=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
      const fields=['id','name','model','cwd'].filter(k=>cols.has(k)),recency=['recency_at_ms','recency_at','created_at_ms','created_at','updated_at_ms','updated_at'].find(k=>cols.has(k));
      const conditions=[];if(cols.has('archived'))conditions.push('archived=0');if(cols.has('thread_source'))conditions.push("(thread_source IS NULL OR thread_source='user')");
      const rows=db.prepare(`SELECT ${fields.join(',')} FROM threads${conditions.length?' WHERE '+conditions.join(' AND '):''} ORDER BY ${recency?recency+' DESC,':''}id LIMIT ? OFFSET ?`).all(HOT_CHAT_LIMIT+1,offset);
      return {chats:rows.slice(0,HOT_CHAT_LIMIT).map(row=>({id:row.id,name:typeof row.name==='string'&&row.name.length<=120&&!/[\r\n]/.test(row.name)?row.name:null,model:row.model??null,cwd:row.cwd??null})),offset,hasMore:rows.length>HOT_CHAT_LIMIT};
    }catch{return fallback();}finally{db?.close();}
  }
  refreshMetadata(force=false,selectedIds=[]){
    this.selectedIds??=new Map();for(const id of selectedIds)if(typeof id==='string'&&id.length<=256){this.selectedIds.delete(id);this.selectedIds.set(id,Date.now());}
    for(const [id,at]of this.selectedIds)if(Date.now()-at>120000)this.selectedIds.delete(id);
    while(this.selectedIds.size>HOT_CHAT_LIMIT)this.selectedIds.delete(this.selectedIds.keys().next().value);
    const requested=[...new Set([...(this.requiredIds??[]),...this.selectedIds.keys()])],scope=requested.slice().sort().join('\n');
    if(!this.DatabaseSync||(!force&&scope===this.metadataScope&&Date.now()-this.metadataCheckedAt<2000))return;
    this.metadataCheckedAt=Date.now();
    try {
      const files=fs.readdirSync(codexHome).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
      if(!files.length)return;
      const dependencies=fs.readdirSync(codexHome).filter(n=>n===files[0]||n===files[0]+'-wal'||/^thread_history_\d+\.sqlite(?:-wal)?$/.test(n));
      const stamp=dependencies.sort().map(n=>{const s=fs.statSync(path.join(codexHome,n));return `${n}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}).join('|');
      if(!force&&stamp===this.metadataStamp&&scope===this.metadataScope){this.refreshObservations().catch(()=>{});return;}
      const db=new this.DatabaseSync(path.join(codexHome,files[0]),{readOnly:true});
      try {
        const cols=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
        if(!cols.has('id'))return;
        // Use the explicit native name, never the legacy title/first prompt.
        this.projects.readNative(db,cols.has('project_id'));
        const selected=['id','name','model','cwd','project_id','updated_at','updated_at_ms','recency_at','recency_at_ms','created_at','created_at_ms','thread_source','archived','rollout_path'].filter(c=>cols.has(c));
        const hasRecencyColumn=cols.has('recency_at_ms')||cols.has('recency_at');
        const candidates=['recency_at_ms','recency_at','created_at_ms','created_at',...(!hasRecencyColumn?['updated_at_ms','updated_at']:[])].filter(c=>cols.has(c));
        const expressions=candidates.map(c=>`NULLIF(${c},0)${c.endsWith('_ms')?'':'*1000'}`);
        const order=expressions.length?` ORDER BY COALESCE(${expressions.join(',')},0) DESC`:'';
        const conditions=[];if(cols.has('archived'))conditions.push('archived=0');if(cols.has('thread_source'))conditions.push("(thread_source IS NULL OR thread_source='user')");
        const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
        const recent=db.prepare(`SELECT ${selected.join(',')} FROM threads${where}${order} LIMIT ?`).all(HOT_CHAT_LIMIT);
        const rows=new Map(recent.map(row=>[row.id,row]));
        const ids=requested;
        for(let offset=0;offset<ids.length;offset+=200){
          const batch=ids.slice(offset,offset+200);
          for(const row of db.prepare(`SELECT ${selected.join(',')} FROM threads WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch))rows.set(row.id,row);
        }
        const turnActivity=readNativeTurnActivity(codexHome,[...rows.keys()],this.DatabaseSync);
        const metadata=new Map();
        this.forkHeaderCache??=new Map();
        for(const row of rows.values()) {
          const current={...turnActivity.get(row.id)};
          current.projectId=typeof row.project_id==='string'?row.project_id:null;
          if(cols.has('cwd'))current.cwd=typeof row.cwd==='string'?row.cwd:null;
          if(typeof row.model==='string')current.model=row.model;
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
        this.metadata=metadata;this.metadataStamp=stamp;this.metadataScope=scope;
        this.scanRows=[...rows.values()];
        this.refreshObservations().catch(()=>{});
        this.scheduleSave();
        if(this.inheritDiscoveredForks())this.save();
      }finally{db.close();}
    }catch{/* Keep the last known metadata if the native index is unavailable. */}
  }
}
