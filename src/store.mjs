import path from 'node:path';
import fs from 'node:fs';
import {root,codexHome,readJSON,atomicJSON} from './paths.mjs';

export class Store {
  constructor(){this.file=path.join(root,'state.json');this.data=readJSON(this.file,{version:2,policies:{},threads:{}});const legacy=this.data.version<2;for(const t of Object.values(this.data.threads)){if(legacy||(t.name&&(t.name.length>120||/[\r\n]/.test(t.name))))t.name=null;}this.data.version=2;}
  save(){atomicJSON(this.file,this.data);}
  model(slug){
    const file=process.env.CONTEXT_CONTROL_CATALOG_PATH||path.join(codexHome,'models_cache.json');
    try {return readJSON(file,{}).models?.find(row=>row.slug===slug)||null;}catch{return null;}
  }
  publicThread(id,owners=new Map()) {
    const t=this.data.threads[id]||{id};const ownersForThread=owners.get(id)||[];
    return {...t,connected:ownersForThread.length===1,ambiguous:ownersForThread.length>1,policy:this.data.policies[id]||null,
      modelMetadata:this.model(t.model)?Object.fromEntries(['context_window','max_context_window','effective_context_window_percent'].map(k=>[k,this.model(t.model)[k]])):null};
  }
  // Optional metadata index. Never read prompts, messages, or encrypted reasoning.
  async seedRecentMetadata(){
    try {
      const files=fs.readdirSync(codexHome).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort().reverse();
      if(!files.length)return;
      const {DatabaseSync}=await import('node:sqlite');
      const db=new DatabaseSync(path.join(codexHome,files[0]),{readOnly:true});
      try {
        const cols=new Set(db.prepare('PRAGMA table_info(threads)').all().map(r=>r.name));
        if(!cols.has('id'))return;
        // Legacy threads.title may contain the complete first prompt. Do not import it.
        const selected=['id','cwd','updated_at'].filter(c=>cols.has(c));
        const order=cols.has('updated_at')?' ORDER BY updated_at DESC':'';
        const where=cols.has('archived')?' WHERE archived=0':'';
        for(const row of db.prepare(`SELECT ${selected.join(',')} FROM threads${where}${order} LIMIT 30`).all()) {
          if(!this.data.threads[row.id])this.data.threads[row.id]={id:row.id,name:null,cwd:row.cwd||null,status:'notLoaded',freshUsage:false};
        }
      }finally{db.close();}
    }catch{/* Index discovery is optional; attached bridge metadata is authoritative. */}
  }
}
