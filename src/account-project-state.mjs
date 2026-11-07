import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const scopedKey='electron-account-renderer-state-v1';
const atomsKey='electron-persisted-atom-state';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const list=value=>Array.isArray(value)?value:[];

// This is the desktop's renderer owner identity, not the manager's login ID.
// Claims come from the already verified native login; decoding is not verification.
export function rendererAccountOwner(auth){
  try{
    const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'))['https://api.openai.com/auth'];
    const user=claims?.chatgpt_user_id??claims?.user_id,account=auth.tokens.account_id;
    if(typeof user!=='string'||!user||typeof account!=='string'||!account||claims.chatgpt_account_id!==account)return null;
    return crypto.createHash('sha256').update(JSON.stringify([user,account])).digest('hex');
  }catch{return null;}
}

export function localProjectIndex(home){
  const name=fs.readdirSync(home).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];
  if(!name)return null;
  const db=new DatabaseSync(path.join(home,name),{readOnly:true});
  try{return {projects:new Set(db.prepare('SELECT id FROM projects').all().map(p=>p.id)),threads:new Set(db.prepare('SELECT id FROM threads').all().map(t=>t.id))};}
  finally{db.close();}
}

// Seed only an empty destination. Never copy cloud identity, plugin caches,
// remote projects or permission settings from another account.
export function seedLocalProjects(source,target,{home,index}){
  const existing=record(target['local-projects']);
  if(Object.keys(existing).length||!index)return target;
  const host='local:'+path.resolve(home),mappings=record(source['app-server-project-id-by-legacy-project-id-by-host']);
  const canonical=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  const sourceHost=Object.keys(mappings).find(k=>k.startsWith('local:')&&canonical(k.slice(6))===canonical(home));
  const aliases=record(mappings[sourceHost]);
  const projects=Object.fromEntries(Object.entries(record(source['local-projects'])).filter(([id,p])=>typeof p?.name==='string'&&index.projects.has(aliases[id]??p.id??id)));
  if(!Object.keys(projects).length)return target;
  const ids=new Set(Object.keys(projects));for(const p of Object.values(projects))if(typeof p.id==='string')ids.add(p.id);
  const assignments=Object.fromEntries(Object.entries(record(source['thread-project-assignments'])).filter(([id,p])=>index.threads.has(id)&&p?.projectKind==='local'&&ids.has(p.projectId)));
  const projectless=[...new Set([...list(source['projectless-thread-ids']).filter(id=>index.threads.has(id)),...list(target['projectless-thread-ids'])])];
  for(const id of projectless)delete assignments[id];
  const migrations=record(source['app-server-projects-migration-by-host']);
  const next={...target,'local-projects':projects,'project-order':list(source['project-order']).filter(id=>ids.has(id)),
    'thread-project-assignments':{...assignments,...record(target['thread-project-assignments'])},'projectless-thread-ids':projectless,
    'app-server-project-id-by-legacy-project-id-by-host':{...record(target['app-server-project-id-by-legacy-project-id-by-host']),[host]:Object.fromEntries(Object.entries(aliases).filter(([id])=>ids.has(id)))},
    'thread-project-membership-host-ids':{...Object.fromEntries(Object.entries(record(source['thread-project-membership-host-ids'])).filter(([id,h])=>index.threads.has(id)&&h==='local')),...record(target['thread-project-membership-host-ids'])}};
  if(sourceHost&&Object.hasOwn(migrations,sourceHost)){
    const migration={...record(migrations[sourceHost])};
    if(Array.isArray(migration.pendingThreadAssignmentIds))migration.pendingThreadAssignmentIds=migration.pendingThreadAssignmentIds.filter(id=>index.threads.has(id));
    next['app-server-projects-migration-by-host']={...record(target['app-server-projects-migration-by-host']),[host]:migration};
  }
  return next;
}

export function prepareProjectSwitch(home,sourceAuth,targetAuth){
  const file=path.join(home,'.codex-global-state.json');
  if(!fs.existsSync(file))return null;
  const before=fs.readFileSync(file),state=JSON.parse(before),scoped=state[scopedKey];
  if(!scoped)return null; // Older desktops keep these globals shared already.
  const sourceOwner=rendererAccountOwner(sourceAuth),targetOwner=rendererAccountOwner(targetAuth);
  if(sourceOwner&&sourceOwner===targetOwner)return null;
  const source=scoped.owner===sourceOwner?state:record(record(scoped.inactive)[sourceOwner]).globals;
  if(!Object.keys(record(source?.['local-projects'])).length)return null;
  if(!sourceOwner||!targetOwner)throw Error('无法确认本地项目的账号归属，未切换账号');
  const target=record(record(scoped.inactive)[targetOwner]),globals=record(target.globals);
  const next=seedLocalProjects(source,globals,{home,index:localProjectIndex(home)});
  if(next===globals)return null;
  state[scopedKey]={...scoped,inactive:{...record(scoped.inactive),[targetOwner]:{atoms:record(target.atoms),globals:next}}};
  return {file,before,after:JSON.stringify(state,null,2)+'\n'};
}

// Explicit repair uses a selected saved account and keeps the active identity.
export function recoverLocalProjects(state,sourceOwner,{home,index}){
  const source=record(record(state[scopedKey]?.inactive)[sourceOwner]).globals;
  const next=seedLocalProjects(record(source),state,{home,index});
  if(next===state)return state;
  const atoms=record(state[atomsKey]);
  return {...next,[atomsKey]:{...atoms,'sidebar-project-list-expanded-v1':true}};
}
