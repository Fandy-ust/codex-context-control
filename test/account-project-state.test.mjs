import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {rendererAccountOwner,seedLocalProjects,prepareProjectSwitch,recoverLocalProjects} from '../src/account-project-state.mjs';

const auth=id=>({tokens:{account_id:id,id_token:'header.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_user_id:'user-'+id,chatgpt_account_id:id}})).toString('base64url')+'.signature'}});
const old=rendererAccountOwner(auth('old')),next=rendererAccountOwner(auth('next'));
function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'project-switch-')),db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec("CREATE TABLE projects(id TEXT);INSERT INTO projects VALUES('native');CREATE TABLE threads(id TEXT);INSERT INTO threads VALUES('a'),('b'),('single');");db.close();
  const host='local:'+home,source={'local-projects':{legacy:{id:'legacy',name:'项目',rootPaths:['/local']},deleted:{id:'deleted',name:'Deleted'}},'project-order':['deleted','legacy'],
    'app-server-project-id-by-legacy-project-id-by-host':{[host]:{legacy:'native'},'remote:private':{remote:'elsewhere'}},
    'app-server-projects-migration-by-host':{[host]:{projectsMigrated:true,threadAssignmentsMigrated:false},'remote:private':{projectsMigrated:true}},
    'thread-project-assignments':{a:{projectKind:'local',projectId:'legacy'},b:{projectKind:'local',projectId:'legacy'},single:{projectKind:'local',projectId:'legacy'},remote:{projectKind:'remote',projectId:'remote'},cloud:{projectKind:'chatgpt',projectId:'cloud'}},
    'projectless-thread-ids':['single','cloud'], 'thread-project-membership-host-ids':{a:'local',remote:'remote:private'},
    'selected-project':{type:'chatgpt',projectId:'cloud'},'private-cloud-state':{secret:'do not copy'}};
  const file=path.join(home,'.codex-global-state.json');
  const state={...source,'electron-persisted-atom-state':{'local-document-identity':{userId:'old'},'permission':'full'},'electron-account-renderer-state-v1':{owner:old,inactive:{[next]:{atoms:{'private-target':'keep'},globals:{'target-cloud':'keep','thread-project-assignments':{b:{projectKind:'chatgpt',projectId:'target-cloud'}}}}}}};
  fs.writeFileSync(file,JSON.stringify(state));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  return {home,host,source,state,file,index:{projects:new Set(['native']),threads:new Set(['a','b','single'])}};
}

test('switch seeds the verified destination with local projects and real local memberships only',t=>{
  const f=fixture(t),before=fs.readFileSync(f.file,'utf8'),plan=prepareProjectSwitch(f.home,auth('old'),auth('next'));
  const changed=JSON.parse(plan.after),target=changed['electron-account-renderer-state-v1'].inactive[next];
  assert.equal(fs.readFileSync(f.file,'utf8'),before,'planning is read only');
  assert.deepEqual(Object.keys(target.globals['local-projects']),['legacy']);assert.deepEqual(target.globals['project-order'],['legacy']);
  assert.deepEqual(target.globals['thread-project-assignments'],{a:{projectKind:'local',projectId:'legacy'},b:{projectKind:'chatgpt',projectId:'target-cloud'}});
  assert.deepEqual(target.globals['projectless-thread-ids'],['single']);
  assert.deepEqual(target.globals['app-server-project-id-by-legacy-project-id-by-host'],{[f.host]:{legacy:'native'}});
  assert.deepEqual(target.globals['thread-project-membership-host-ids'],{a:'local'});
  assert.equal(target.globals['target-cloud'],'keep');assert.equal(target.globals['selected-project'],undefined);assert.equal(target.globals['private-cloud-state'],undefined);
  assert.deepEqual(target.atoms,{'private-target':'keep'});assert.equal(changed['electron-account-renderer-state-v1'].owner,old);
  assert.deepEqual(changed['electron-persisted-atom-state'],f.state['electron-persisted-atom-state']);
  // Native startup first saves active globals under old, then selects next.
  changed['electron-account-renderer-state-v1'].inactive[old]={globals:f.source,atoms:f.state['electron-persisted-atom-state']};
  const activated=changed['electron-account-renderer-state-v1'].inactive[next];
  assert.equal(activated.globals['local-projects'].legacy.name,'项目');assert.equal(activated.atoms['private-target'],'keep');
});

test('existing destination projects and invalid or mismatched source owners are preserved',t=>{
  const f=fixture(t),target={'local-projects':{mine:{name:'Existing'}}};
  assert.equal(seedLocalProjects(f.source,target,{home:f.home,index:f.index}),target);
  assert.equal(prepareProjectSwitch(f.home,auth('unrelated'),auth('next')),null);
  assert.throws(()=>prepareProjectSwitch(f.home,auth('old'),{tokens:{id_token:'invalid'}}),/账号归属/);
  const bad=auth('next');bad.tokens.account_id='different';assert.equal(rendererAccountOwner(bad),null);
  delete f.state['electron-account-renderer-state-v1'];fs.writeFileSync(f.file,JSON.stringify(f.state));
  assert.equal(prepareProjectSwitch(f.home,auth('old'),auth('next')),null,'legacy desktop does not need renderer seeding');
});

test('explicit recovery restores saved projects without changing active identity or account cache',t=>{
  const f=fixture(t),state={'electron-persisted-atom-state':{'local-document-identity':{userId:'next'},permission:'full'},'electron-account-renderer-state-v1':{owner:next,inactive:{[old]:{globals:f.source,atoms:{private:'do not copy'}}}}};
  const recovered=recoverLocalProjects(state,old,{home:f.home,index:f.index});
  assert.equal(recovered['local-projects'].legacy.name,'项目');assert.equal(recovered['thread-project-assignments'].a.projectId,'legacy');
  assert.deepEqual(recovered['electron-account-renderer-state-v1'],state['electron-account-renderer-state-v1']);
  assert.deepEqual(recovered['electron-persisted-atom-state'],{...state['electron-persisted-atom-state'],'sidebar-project-list-expanded-v1':true});
  assert.equal(recoverLocalProjects(recovered,old,{home:f.home,index:f.index}),recovered,'repair is idempotent');
  assert.equal(recovered['private-cloud-state'],undefined);
});
