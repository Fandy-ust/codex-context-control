import path from 'node:path';
import fs from 'node:fs';
import {root,codexHome,readJSON,atomicJSON} from './paths.mjs';

export class Store {
  constructor(){this.file=path.join(root,'state.json');this.data=readJSON(this.file,{version:2,policies:{},threads:{}});const legacy=this.data.version<2;for(const t of Object.values(this.data.threads)){if(legacy||(t.name&&(t.name.length>120||/[\r\n]/.test(t.name))))t.name=null;}this.data.version=2;this.metadata=new Map();this.metadataCheckedAt=0;}
  save(){atomicJSON(this.file,this.data);}
  model(slug){
    const file=process.env.CONTEXT_CONTROL_CATALOG_PATH||path.join(codexHome,'models_cache.json');
    try {return readJSON(file,{}).models?.find(row=>row.slug===slug)||null;}catch{return null;}
  }
  publicThread(id,owners=new Map()) {
    this.refreshMetadata();
    const t=this.data.threads[id]||{id};const ownersForThread=owners.get(id)||[];
    return {...t,...this.metadata.get(id),connected:ownersForThread.length===1,ambiguous:ownersForThread.length>1,policy:this.data.policies[id]||null,
      modelMetadata:this.model(t.model)?Object.fromEntries(['context_window','max_context_window','effective_context_window_percent'].map(k=>[k,this.model(t.model)[k]])):null};
  }
  // Optional metadata index. Never read prompts, messages, or encrypted reasoning.
  async seedRecentMetadata(){
    try{this.DatabaseSync=(await import('node:sqlite')).DatabaseSync;this.refreshMetadata(true);}catch{/* Metadata discovery is optional. */}
  }
  refreshMetadata(force=false){
    if(!this.DatabaseSync||(!force&&Date.now()-this.metadataCheckedAt<2000))return;
    this.metadataCheckedAt=Date.now();
    try {
      const files=fs.readdirSync(codexHome).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort().reverse();
      if(!files.length)return;
      const db=new this.DatabaseSync(path.join(codexHome,files[0]),{readOnly:true});
      try {
        const cols=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
        if(!cols.has('id'))return;
        // Use the explicit native name, never the legacy title/first prompt.
        const selected=['id','name','cwd','updated_at','archived'].filter(c=>cols.has(c));
        const order=cols.has('updated_at')?' ORDER BY updated_at DESC':'';
        const where=cols.has('archived')?' WHERE archived=0':'';
        const recent=db.prepare(`SELECT ${selected.join(',')} FROM threads${where}${order} LIMIT 30`).all();
        const rows=new Map(recent.map(row=>[row.id,row]));
        const ids=Object.keys(this.data.threads);
        for(let offset=0;offset<ids.length;offset+=200){
          const batch=ids.slice(offset,offset+200);
          for(const row of db.prepare(`SELECT ${selected.join(',')} FROM threads WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch))rows.set(row.id,row);
        }
        const metadata=new Map();
        for(const row of rows.values()) {
          const current={};
          if(cols.has('name'))current.name=typeof row.name==='string'&&row.name.length<=120&&!/[\r\n]/.test(row.name)?row.name:null;
          if(cols.has('archived'))current.archived=row.archived===1;
          metadata.set(row.id,current);
          if(!this.data.threads[row.id]&&!current.archived)this.data.threads[row.id]={id:row.id,name:null,cwd:row.cwd||null,status:'notLoaded',freshUsage:false};
          if(this.data.threads[row.id])Object.assign(this.data.threads[row.id],current);
        }
        // Keep native names authoritative even when an older bridge continues
        // publishing the title it captured before Codex renamed the fork.
        this.metadata=metadata;
      }finally{db.close();}
    }catch{/* Keep the last known metadata if the native index is unavailable. */}
  }
}
