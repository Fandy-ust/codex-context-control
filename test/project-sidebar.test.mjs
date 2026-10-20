import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ProjectCatalog} from '../src/project-catalog.mjs';
import {projectSidebar} from '../desktop/renderer/project-sidebar.mjs';

function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-projects-'));
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  const file=path.join(home,'.codex-global-state.json'),catalog=new ProjectCatalog(home);
  t.after(()=>{db.close();fs.rmSync(home,{recursive:true,force:true});});
  const write=data=>{fs.writeFileSync(file,JSON.stringify(data));catalog.checkedAt=0;};
  const native=()=>db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,position INTEGER);CREATE TABLE project_roots(project_id TEXT,path TEXT,position INTEGER);INSERT INTO projects VALUES('p','Project',0),('empty','Empty',1);INSERT INTO project_roots VALUES('p','/repo',0)");
  return {home,db,file,catalog,write,native};
}

test('native membership groups worktrees and leaves directory-sharing standalone chats alone',t=>{
  const f=fixture(t);f.native();f.catalog.readNative(f.db,true);
  const chats=[{id:'worktree',projectId:'p',cwd:'/elsewhere/worktree'},{id:'single',cwd:'/repo'},{id:'recent',projectId:'p'}];
  const sidebar=f.catalog.sidebar(chats);
  assert.deepEqual(sidebar.projects.map(p=>[p.id,p.threadIds]),[['p',['worktree','recent']],['empty',[]]]);
  assert.deepEqual(sidebar.standaloneThreadIds,['single']);
  assert.deepEqual(sidebar.projects[0].roots,['/repo']);
});

test('legacy assignments map migrated IDs without absorbing projectless or remote chats',t=>{
  const f=fixture(t);f.native();f.catalog.readNative(f.db,true);
  const key='local:'+f.home;
  f.write({'local-projects':{old:{id:'old',name:'Old name',rootPaths:['/repo']}},'app-server-project-id-by-legacy-project-id-by-host':{[key]:{old:'p'}},'thread-project-assignments':{a:{projectKind:'local',projectId:'old'},single:{projectKind:'local',projectId:'old'},remote:{projectKind:'remote',projectId:'p'},missing:{projectKind:'local',projectId:'deleted'}},'projectless-thread-ids':['single']});
  const before=fs.readFileSync(f.file,'utf8'),sidebar=f.catalog.sidebar(['a','single','remote','missing'].map(id=>({id})));
  assert.equal(sidebar.projects.length,2);assert.equal(sidebar.projects[0].name,'Project');
  assert.deepEqual(sidebar.projects[0].threadIds,['a']);assert.deepEqual(sidebar.standaloneThreadIds,['single','remote','missing']);
  assert.equal(fs.readFileSync(f.file,'utf8'),before,'Codex metadata is read only');
});

test('completed native migration and deleted projects cannot resurrect legacy memberships',t=>{
  const f=fixture(t);f.native();f.catalog.readNative(f.db,true);const key='local:'+f.home;
  f.write({'local-projects':{old:{id:'old',name:'Stale'}},'app-server-project-id-by-legacy-project-id-by-host':{[key]:{old:'p'}},'app-server-projects-migration-by-host':{[key]:{threadAssignmentsMigrated:true}},'thread-project-assignments':{a:{projectKind:'local',projectId:'old'}}});
  assert.deepEqual(f.catalog.sidebar([{id:'a',projectId:null}]).standaloneThreadIds,['a']);
  f.write({'app-server-projects-migration-by-host':{[key]:{threadAssignmentsMigrated:true}},'thread-project-assignments':{a:{projectKind:'local',projectId:'p'}}});
  assert.deepEqual(f.catalog.sidebar([{id:'a',projectId:null}]).standaloneThreadIds,['a'],'native membership remains authoritative without a legacy ID map');
  f.db.exec("DELETE FROM projects WHERE id='p'");f.catalog.readNative(f.db,true);
  assert.deepEqual(f.catalog.sidebar([{id:'a',projectId:'p'}]).projects.map(p=>p.id),['empty']);
  assert.deepEqual(f.catalog.sidebar([{id:'a',projectId:'p'}]).standaloneThreadIds,['a']);
});

test('legacy-only catalogs refresh assignments and tolerate partial global-state writes',t=>{
  const f=fixture(t);f.catalog.readNative(f.db);
  const legacy={'local-projects':{p:{id:'p',name:'Legacy',rootPaths:['/repo']},empty:{id:'empty',name:'Empty'}},'project-order':['empty','p'],'thread-project-assignments':{a:{projectKind:'local',projectId:'p'}}};
  f.write(legacy);assert.deepEqual(f.catalog.sidebar([{id:'a'}]).projects.map(p=>p.id),['empty','p']);
  fs.writeFileSync(f.file,'{"partial":');f.catalog.checkedAt=0;
  assert.deepEqual(f.catalog.sidebar([{id:'a'}]).projects[1].threadIds,['a']);
  f.write({...legacy,'projectless-thread-ids':['a']});assert.deepEqual(f.catalog.sidebar([{id:'a'}]).standaloneThreadIds,['a']);
});

test('Store refreshes native project moves and cwd changes without altering budgets',async t=>{
  const f=fixture(t);f.native();f.db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,project_id TEXT,archived INTEGER);INSERT INTO threads VALUES('a','Chat','/repo','p',0)");
  const root=path.join(f.home,'control');fs.mkdirSync(root);
  process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=f.home;
  const {Store}=await import('../src/store.mjs');const store=new Store();await store.seedRecentMetadata();
  store.data.policies.a={window:400000,compact:360000,revision:3};
  assert.deepEqual(store.projects.sidebar([store.publicThread('a')]).projects[0].threadIds,['a']);
  f.db.exec("UPDATE threads SET cwd='/different',project_id=NULL WHERE id='a'");store.refreshMetadata(true);
  const chat=store.publicThread('a');assert.equal(chat.projectId,null);assert.equal(chat.cwd,'/different');
  assert.deepEqual(store.projects.sidebar([chat]).standaloneThreadIds,['a']);assert.equal(chat.policy.revision,3);
  await store.threadCache.running;store.flush();
});

test('sidebar repeats project chats in Recent, respects collapse and escapes metadata',()=>{
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const args={threads:[{id:'a',name:'<chat>',connected:true,lastActivityAt:200},{id:'single',name:'Single',lastActivityAt:300}],sidebar:{projects:[{id:'p',name:'<project>',roots:['/a"b'],threadIds:['a']},{id:'empty',name:'Empty',roots:[],threadIds:[]}],standaloneThreadIds:['single']},selected:'a',expanded:new Map(),t:(zh,en)=>en,escape,chatName:c=>c.name,statusText:()=> 'Cached'};
  const defaultClosed=projectSidebar(args);
  assert.equal((defaultClosed.match(/data-id="a"/g)||[]).length,1,'selecting a recent chat must not expand its project');
  assert.ok(!defaultClosed.includes('project-chats'));
  const open=projectSidebar({...args,expanded:new Map([['p',true]])});
  assert.match(open,/&lt;project>/);assert.match(open,/&lt;chat>/);assert.ok(!open.includes('<chat>'));
  assert.match(open,/<span class="chat-project-name" title="&lt;project>">&lt;project><\/span><span class="chat-connection">Connected<\/span>/);
  assert.match(open,/<span class="chat-project-name" title="Standalone chat">Standalone chat<\/span><span class="chat-connection">Not connected<\/span>/);
  assert.equal((open.match(/data-id="a"/g)||[]).length,2);assert.match(open,/aria-current="true"/);
  assert.ok(open.indexOf('projects-section')<open.indexOf('recent-section'));
  const recent=open.slice(open.indexOf('recent-section'));assert.ok(recent.indexOf('data-id="single"')<recent.indexOf('data-id="a"'));assert.match(recent,/Recent/);
  const closed=projectSidebar({...args,expanded:new Map([['p',false],['empty',true]])});
  assert.equal((closed.match(/data-id="a"/g)||[]).length,1);assert.match(closed,/No chats yet/);assert.match(closed,/data-id="single"/);
  const refreshed=projectSidebar({...args,threads:args.threads.map(chat=>chat.id==='a'?{...chat,lastActivityAt:400}:chat)});const recentUpdated=refreshed.slice(refreshed.indexOf('recent-section'));assert.ok(recentUpdated.indexOf('data-id="a"')<recentUpdated.indexOf('data-id="single"'));assert.equal(args.threads[0].lastActivityAt,200);
  const recentClosed=projectSidebar({...args,recentExpanded:false});assert.equal((recentClosed.match(/data-sidebar-scroll=/g)||[]).length,1);assert.ok(!recentClosed.slice(recentClosed.indexOf('recent-section')).includes('data-id="single"'));assert.match(recentClosed,/data-action="recent-toggle" aria-expanded="false"/);
  const fallback=projectSidebar({...args,sidebar:null});assert.match(fallback,/data-id="a"/);assert.match(fallback,/No local projects/);
});
