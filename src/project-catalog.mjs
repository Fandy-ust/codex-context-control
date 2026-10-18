import fs from 'node:fs';
import path from 'node:path';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\r\n\0]/.test(value);

// Read project metadata only. Never infer membership from cwd: a standalone
// chat can use a project directory, and a project chat can use a worktree.
export class ProjectCatalog {
  constructor(home){this.home=home;this.native=[];this.legacy={};}
  readNative(db,hasMemberships=false){
    try{
      const projects=db.prepare('SELECT id,name FROM projects ORDER BY position,id').all();
      let roots=[];try{roots=db.prepare('SELECT project_id,path FROM project_roots ORDER BY position').all();}catch{}
      this.native=projects.filter(p=>text(p.id)&&text(p.name)).map(p=>({id:p.id,name:p.name,roots:roots.filter(r=>r.project_id===p.id&&text(r.path)).map(r=>r.path)}));
      this.nativeAvailable=true;this.hasMemberships=hasMemberships;
    }catch{this.native=[];this.nativeAvailable=false;this.hasMemberships=false;}
  }
  refresh(){
    if(Date.now()-(this.checkedAt??0)<2000)return;
    this.checkedAt=Date.now();
    try{
      const file=path.join(this.home,'.codex-global-state.json'),stat=fs.statSync(file);
      const stamp=`${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if(stamp===this.stamp)return;
      const data=JSON.parse(fs.readFileSync(file,'utf8'));
      // Retain only the project fields, not unrelated global app state.
      this.legacy=Object.fromEntries(['local-projects','thread-project-assignments','projectless-thread-ids','project-order','app-server-project-id-by-legacy-project-id-by-host','app-server-projects-migration-by-host'].map(key=>[key,data[key]]));
      this.stamp=stamp;
    }catch(error){if(error.code==='ENOENT'){this.legacy={};this.stamp=null;}}
  }
  sidebar(threads){
    this.refresh();
    const data=this.legacy,projects=new Map(this.native.map(p=>[p.id,{...p,threadIds:[]}])),aliases=new Map();
    const mappings=record(data['app-server-project-id-by-legacy-project-id-by-host']);
    const migrations=record(data['app-server-projects-migration-by-host']);
    const canonical=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
    const hostKey=[...new Set([...Object.keys(mappings),...Object.keys(migrations)])].find(key=>key.startsWith('local:')&&canonical(key.slice(6))===canonical(this.home));
    const migrated=record(mappings[hostKey]);
    for(const [key,p] of Object.entries(record(data['local-projects']))){
      if(!text(p?.name))continue;
      const id=text(migrated[key])?migrated[key]:text(p.id)?p.id:key;
      if(!text(id))continue;
      aliases.set(key,id);if(text(p.id))aliases.set(p.id,id);
      if(!this.nativeAvailable&&!projects.has(id))projects.set(id,{id,name:p.name,roots:list(p.rootPaths).filter(text),threadIds:[]});
    }
    const order=new Map(list(data['project-order']).map((id,index)=>[aliases.get(id)??id,index]));
    const assignments=record(data['thread-project-assignments']),projectless=new Set(list(data['projectless-thread-ids'])),standaloneThreadIds=[];
    const migration=record(migrations[hostKey]);
    const nativeAuthoritative=this.hasMemberships&&migration.threadAssignmentsMigrated===true;
    for(const thread of threads){
      const assignment=Object.hasOwn(assignments,thread.id)?assignments[thread.id]:null;
      const legacyId=assignment?.projectKind==='local'?assignment.projectId:null;
      const id=thread.projectId||(nativeAuthoritative||projectless.has(thread.id)?null:aliases.get(legacyId)??legacyId);
      const project=projects.get(id);
      if(project)project.threadIds.push(thread.id);else standaloneThreadIds.push(thread.id);
    }
    return {projects:[...projects.values()].sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER)),standaloneThreadIds};
  }
}
