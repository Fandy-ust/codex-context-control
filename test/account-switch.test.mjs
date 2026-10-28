import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAccountSwitcher,credentialProfile,fileStoreConfig} from '../src/account-switch.mjs';
import {accountSwitchView} from '../desktop/renderer/account-switch.mjs';
import {accountVault} from '../src/account-vault.mjs';
import {openAccountDesktop,windowsStoreAppId,accountProcessBlocker,accountProcesses,automaticAccountProcesses,stopAccountProcesses} from '../src/account-processes.mjs';
import {accountTaskBlockers} from '../src/core/account-switch-blockers.mjs';
import {allowedLoginNavigation} from '../src/core/account-login-navigation.mjs';

const auth=(id,revision=1)=>({auth_mode:'chatgpt',tokens:{account_id:id,access_token:'access-'+revision,refresh_token:'refresh-'+revision,id_token:'id-'+revision},testEmail:id+'@example.test'});
const info=value=>({type:'chatgpt',email:value.testEmail,planType:'plus'});
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
function fixture(t,extra={}){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'account-switch-')),codexHome=path.join(home,'codex');fs.mkdirSync(codexHome);let stored={profiles:{}},opened=0,blocked=false,mismatch=false,denied=false,finishLogin,rejectLogin;
  const vault={get:()=>structuredClone(stored),set:value=>{if(denied)throw Error('vault locked');stored=structuredClone(value);}};
  const session=({home:folder})=>({async read({refresh=false}={}){const file=path.join(folder,'auth.json'),value=JSON.parse(fs.readFileSync(file));if(refresh){value.tokens.refresh_token='new-rotated-secret';fs.writeFileSync(file,JSON.stringify(value));}return mismatch&&refresh?{type:'chatgpt',email:'wrong@example.test'}:info(value);},
    async rateLimits(){return {rateLimits:{primary:{usedPercent:10,windowDurationMins:300,resetsAt:1800001800}}};},async login(onURL){await onURL('https://auth.openai.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback');return new Promise((resolve,reject)=>{rejectLogin=reject;finishLogin=()=>{const value=auth('second');fs.writeFileSync(path.join(folder,'auth.json'),JSON.stringify(value));resolve(info(value));};});},close(){rejectLogin?.(Error('cancelled'));rejectLogin=null;}});
  const manager=createAccountSwitcher({home,codexHome,secrets:vault,session,secure:directory=>fs.mkdirSync(directory,{recursive:true}),guard:async()=>{if(blocked)throw Error('running');},openDesktop:async()=>{opened++;},...extra});
  fs.writeFileSync(path.join(codexHome,'auth.json'),JSON.stringify(auth('first',2)));
  t.after(async()=>{manager.close();await wait(()=>!manager.state().busy);fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  return {home,codexHome,manager,vault,get stored(){return stored;},get opened(){return opened;},set blocked(value){blocked=value;},set mismatch(value){mismatch=value;},set denied(value){denied=value;},finish:()=>finishLogin(),setProfiles:values=>{stored={profiles:Object.fromEntries(values.map(value=>{const profile=credentialProfile(value,info(value));return [profile.id,{...profile,name:'',auth:value}];}))};}};
}
test('OAuth addition is isolated, encrypted by the vault, cancellable and never changes the active auth',async t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
  const started=await f.manager.command({action:'login',name:'Work'});assert.match(started.authUrl,/auth.openai.com/);assert.equal(f.manager.state().busy,true);
  await assert.rejects(f.manager.command({action:'capture'}),/正在进行/);
  f.finish();await wait(()=>!f.manager.state().busy);assert.equal(f.manager.state().profiles[0].name,'Work');assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);
  assert.doesNotMatch(JSON.stringify(f.manager.state()),/access_token|refresh_token|id_token|authUrl/);
  assert.deepEqual(fs.readdirSync(path.join(f.home,'account-login')),[]);
  await f.manager.command({action:'login'});await f.manager.command({action:'cancel'});await wait(()=>!f.manager.state().busy);assert.equal(f.manager.state().job.status,'failed');
});
test('authorization link is available only during the active login and never persisted or in status',async t=>{
  const f=fixture(t);
  await assert.rejects(f.manager.command({action:'login-link'}),/已失效/);
  const started=await f.manager.command({action:'login'});
  assert.equal(f.manager.state().canCopyLoginLink,true);
  assert.equal((await f.manager.command({action:'login-link'})).authUrl,started.authUrl);
  assert.doesNotMatch(JSON.stringify(await f.manager.command({action:'status'})),/authorize|redirect_uri|authUrl/);
  f.finish();await wait(()=>!f.manager.state().busy);
  assert.equal(f.manager.state().canCopyLoginLink,false);
  await assert.rejects(f.manager.command({action:'login-link'}),/已失效/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.home,'account-switch.json'),'utf8'),/authorize|redirect_uri|authUrl/);
  await f.manager.command({action:'login'});
  await f.manager.command({action:'cancel'});
  assert.equal(f.manager.state().canCopyLoginLink,false);
  await assert.rejects(f.manager.command({action:'login-link'}),/已失效/);
  await wait(()=>!f.manager.state().busy);
  await f.manager.command({action:'login'});f.manager.close();
  assert.equal(f.manager.state().canCopyLoginLink,false);
  await assert.rejects(f.manager.command({action:'login-link'}),/已失效/);
});
test('account sign-in renders copy action while waiting without putting the URL in HTML',()=>{
  const options={e:value=>String(value),t:zh=>zh};
  const state={profiles:[],busy:true,canCopyLoginLink:true,job:{status:'waiting'},authUrl:'https://auth.openai.com/authorize?state=private'};
  const html=accountSwitchView(state,options);
  assert.match(html,/data-action="login-copy-link"/);assert.match(html,/复制授权链接/);
  assert.doesNotMatch(html,/authorize|state=private/);
  assert.doesNotMatch(accountSwitchView({...state,busy:false,canCopyLoginLink:false},options),/login-copy-link/);
});
test('switch validates identity, retains the latest outgoing auth, writes refreshed target and opens desktop',async t=>{
  const f=fixture(t),second=auth('second');f.setProfiles([second]);fs.writeFileSync(path.join(f.codexHome,'config.toml'),'model = "Sol"\n[features]\nx = true\n');
  const id=credentialProfile(second,info(second)).id;await f.manager.command({action:'switch',id,confirmed:true});
  const active=JSON.parse(fs.readFileSync(path.join(f.codexHome,'auth.json')));assert.equal(active.tokens.account_id,'second');assert.equal(active.tokens.refresh_token,'new-rotated-secret');
  assert.equal(Object.values(f.stored.profiles).find(p=>p.auth.tokens.account_id==='first').auth.tokens.refresh_token,'refresh-2');
  assert.match(fs.readFileSync(path.join(f.codexHome,'config.toml'),'utf8'),/^cli_auth_credentials_store = "file"\nmodel = "Sol"/);assert.equal(f.opened,1);assert.equal(f.manager.state().activeId,id);assert.equal(f.manager.state().busy,false);
  assert.doesNotMatch(fs.readFileSync(path.join(f.home,'account-switch.json'),'utf8'),/new-rotated-secret|access_token/);
});

test('candidate inspection refreshes only isolated credentials and exposes quota without tokens',async t=>{
 const f=fixture(t),second=auth('second');f.setProfiles([second]);const id=credentialProfile(second,info(second)).id,before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
 const result=await f.manager.inspect(id);assert.equal(result.buckets[0].primary.remainingPercent,90);assert.equal(f.stored.profiles[id].auth.tokens.refresh_token,'new-rotated-secret');assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);assert.doesNotMatch(JSON.stringify(result),/access_token|refresh_token|id_token/);assert.deepEqual(fs.readdirSync(path.join(f.home,'account-login')),[]);
});

test('quota read failure after refresh retains rotated candidate credentials without touching the live login',async t=>{
 const session=({home})=>({async read(){const file=path.join(home,'auth.json'),value=JSON.parse(fs.readFileSync(file));value.tokens.refresh_token='rotated-before-quota-error';fs.writeFileSync(file,JSON.stringify(value));return info(value);},async rateLimits(){throw Error('quota offline');},close(){}});
 const f=fixture(t,{session}),second=auth('second');f.setProfiles([second]);const id=credentialProfile(second,info(second)).id,before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
 await assert.rejects(f.manager.inspect(id),/quota offline/);assert.equal(f.stored.profiles[id].auth.tokens.refresh_token,'rotated-before-quota-error');assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);
});

test('automatic process selection permits managed native runtimes but refuses unrelated sessions and old bridges',()=>{
 const managed={pid:123,executable:'/fixture/codex'},desktop={pid:456,executable:process.execPath},bridges=[{pid:99,nativePid:123,accountSwitchVersion:1}];
 assert.deepEqual(automaticAccountProcesses({desktop:process.execPath,bridges,list:()=>[managed,desktop]}),[managed,desktop]);
 assert.throws(()=>automaticAccountProcesses({desktop:process.execPath,bridges,list:()=>[managed,{pid:999,executable:'/other/codex'}]}),/未接入/);
 assert.throws(()=>automaticAccountProcesses({desktop:process.execPath,bridges:[{pid:99}],list:()=>[]}),/重新打开/);
});
test('guards, confirmation, vault failures and account mismatch leave the live auth unchanged',async t=>{
  const f=fixture(t),second=auth('second');f.setProfiles([second]);const id=credentialProfile(second,info(second)).id,before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
  await assert.rejects(f.manager.command({action:'switch',id}),/确认/);
  f.blocked=true;await assert.rejects(f.manager.command({action:'switch',id,confirmed:true}),/running/);f.blocked=false;
  f.mismatch=true;await assert.rejects(f.manager.command({action:'switch',id,confirmed:true}),/身份不匹配/);f.mismatch=false;
  f.denied=true;await assert.rejects(f.manager.command({action:'switch',id,confirmed:true}),/vault locked/);
  assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);assert.equal(f.opened,0);assert.equal(f.manager.state().busy,false);
});
test('renaming and removing saved sign-ins never remove live auth or statistics',async t=>{
  const f=fixture(t);await f.manager.command({action:'capture'});const id=f.manager.state().profiles[0].id;f.blocked=true;
  await f.manager.command({action:'rename',id,name:' Home '});assert.equal(f.manager.state().profiles[0].name,'Home');
  await assert.rejects(f.manager.command({action:'rename',id,name:'bad\nname'}),/名称/);
  await f.manager.command({action:'remove',id});assert.equal(f.manager.state().profiles.length,0);assert.ok(fs.existsSync(path.join(f.codexHome,'auth.json')));
});
test('an external auth writer during validation cancels commit and preserves its changes',async t=>{
  let checks=0;const f=fixture(t,{guard:async()=>{if(++checks===2)fs.writeFileSync(path.join(f.codexHome,'auth.json'),JSON.stringify(auth('external')));}}),second=auth('second');f.setProfiles([second]);
  await assert.rejects(f.manager.command({action:'switch',id:credentialProfile(second,info(second)).id,confirmed:true}),/状态已变化/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.codexHome,'auth.json'))).tokens.account_id,'external');assert.equal(f.opened,0);
});
test('vault encrypts credentials, round-trips and rejects tampering or a lost key',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'account-vault-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));let saved={};
  const keys={get:()=>saved,set:value=>{saved=value;}},vault=accountVault(home,{keys}),value={profiles:{secret:{auth:auth('PRIVATE_ACCOUNT')}}};vault.set(value);assert.deepEqual(vault.get(),value);
  const file=path.join(home,'account-vault.json');assert.doesNotMatch(fs.readFileSync(file,'utf8'),/PRIVATE_ACCOUNT|refresh_token/);
  saved={};assert.throws(()=>vault.get(),/无法解锁/);
});
test('only ChatGPT sessions are accepted and file-mode config stays at top level',()=>{
  assert.throws(()=>credentialProfile({},info(auth('a'))));assert.throws(()=>credentialProfile(auth('a'),{type:'apiKey'}));
  assert.equal(fileStoreConfig('cli_auth_credentials_store = "keyring"\n[features]\nx=true\n'),'cli_auth_credentials_store = "file"\n[features]\nx=true\n');
  assert.match(fileStoreConfig('[features]\ncli_auth_credentials_store = "keyring"\n'),/^cli_auth_credentials_store = "file"\n\[features\]/);
});
test('native process guard blocks Codex and ChatGPT and fails closed on missing inventory',()=>{
  assert.equal(accountProcessBlocker({list:()=>[{pid:123,executable:'C:\\App\\ChatGPT.exe'}]}),true);
  assert.equal(accountProcessBlocker({list:()=>[{pid:123,executable:'/Applications/Codex.app/Contents/Resources/codex'}]}),true);
  assert.equal(accountProcessBlocker({list:()=>[{pid:123,executable:'C:\\ContextManager.exe'}]}),false);
  assert.throws(()=>accountProcessBlocker({list:()=>null}),/无法检查/);
});

test('paused monitoring and disconnected historical states do not block account switching',()=>{
  const threads=[{connected:false,status:'active',phase:'compacting'}],queues=[{enabled:true}];
  assert.deepEqual(accountTaskBlockers({threads,tasks:{monitoringEnabled:false,queues},activation:{busy:true}}),[]);
  assert.deepEqual(accountTaskBlockers({threads,tasks:{monitoringEnabled:true,queues:[{enabled:true,pause:{kind:'manual'}}]}}),[]);
  assert.equal(accountTaskBlockers({threads:[{connected:true,status:'active'}],tasks:{monitoringEnabled:false,queues}}).length,1,'pausing the queue does not stop an actual live turn');
  assert.equal(accountTaskBlockers({tasks:{monitoringEnabled:true,queues}}).length,1);
});

test('force stopping is explicit, validates the selected account first and rechecks the guard',async t=>{
  let stops=0;const f=fixture(t,{prepareSwitch:async()=>{stops++;f.blocked=false;}}),second=auth('second');f.setProfiles([second]);const id=credentialProfile(second,info(second)).id;
  f.blocked=true;await assert.rejects(f.manager.command({action:'switch',id,force:true}),/确认/);assert.equal(stops,0);
  await assert.rejects(f.manager.command({action:'switch',id:'invalid',confirmed:true,force:true}),/找不到/);assert.equal(stops,0);
  await assert.rejects(f.manager.command({action:'switch',id,confirmed:true}),/running/);assert.equal(stops,0);
  await f.manager.command({action:'switch',id,confirmed:true,force:true});assert.equal(stops,2);assert.equal(f.opened,1);
});

test('failure to stop a runtime never overwrites live credentials',async t=>{
  const f=fixture(t,{prepareSwitch:async()=>{throw Error('stop denied');}}),second=auth('second');f.setProfiles([second]);const before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
  await assert.rejects(f.manager.command({action:'switch',id:credentialProfile(second,info(second)).id,confirmed:true,force:true}),/stop denied/);
  assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);assert.equal(f.opened,0);
});

test('process stopping escalates only matching Codex PIDs, leaves other apps alone and verifies exit',async()=>{
  const target={pid:123,executable:'/App/codex'},other={pid:456,executable:'/App/Editor'},calls=[];let alive=true;
  assert.deepEqual(accountProcesses({list:()=>[target,other,{pid:process.pid,executable:'/App/codex'}]}),[target]);
  await stopAccountProcesses({list:()=>alive?[target]:[],wait:async()=>{},kill:(pid,signal)=>{calls.push([pid,signal]);if(signal==='SIGKILL')alive=false;}});
  assert.deepEqual(calls,[[123,'SIGTERM'],[123,'SIGKILL']]);
  await assert.rejects(stopAccountProcesses({list:()=>[target],wait:async()=>{},kill:()=>{}}),/仍在运行/);
});
test('embedded login permits official identity providers and only the assigned loopback origin',()=>{
  const url='https://auth.openai.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback';
  for(const target of ['https://auth.openai.com/login','https://accounts.google.com/signin','http://localhost:1455/auth/callback?code=secret'])assert.equal(allowedLoginNavigation(target,url),true);
  for(const target of ['https://accounts.google.com.evil.test','http://localhost:9999/','file:///private','javascript:alert(1)','https://user:secret@chatgpt.com/','http://192.168.1.1/'])assert.equal(allowedLoginNavigation(target,url),false);
});


test('account guards exclude helpers and zombies but retain live CLI and wrapper processes',()=>{
  const inventory=[{pid:201,executable:'/App/codex-computer-use-swift'},{pid:202,executable:'/App/codex-windows-sandbox-service.exe'},{pid:203,executable:'/App/codex',state:'Z+'},{pid:204,executable:'/App/Codex',state:'S'},{pid:205,executable:'/App/codex-context',state:'S'}];
  assert.deepEqual(accountProcesses({platform:'darwin',list:()=>inventory}).map(p=>p.pid),[204,205]);
});

test('Windows desktop launch starts once without changing environment',async()=>{
  const order=[];
  await openAccountDesktop({platform:'win32',configured:process.execPath,environment:{ELECTRON_RUN_AS_NODE:'1',CODEX_CLI_PATH:'owned-shim'},launch:(command,args,options)=>{
    assert.equal(command,process.execPath);assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(options.env.CODEX_CLI_PATH,'owned-shim');order.push('spawn');
    const child={once(event,callback){if(event==='spawn')queueMicrotask(callback);return child;},unref(){order.push('unref');}};return child;
  }});
  assert.deepEqual(order,['spawn','unref']);
});


test('Windows Store application ID is derived only from its package path',()=>{
  assert.equal(windowsStoreAppId('C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe'),'OpenAI.Codex_2p2nqsd0c76g0!App');
  assert.equal(windowsStoreAppId('C:\\Other\\OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe'),null);
});

test('Windows Store desktop launch activates the registered application once',async()=>{
  const configured='C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe';
  let calls=0;
  await openAccountDesktop({platform:'win32',configured,exists:()=>true,launch:(command,args,options)=>{
    assert.equal(command,'explorer.exe');
    assert.deepEqual(args,['shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App']);
    assert.equal(options.cwd,undefined);
    assert.equal(options.windowsHide,false);
    calls++;
    const child={once(event,callback){if(event==='spawn')queueMicrotask(callback);return child;},unref(){}};return child;
  }});
  assert.equal(calls,1);
});

test('failed Windows desktop launch propagates its error',async()=>{
  let calls=0;
  await assert.rejects(openAccountDesktop({platform:'win32',configured:process.execPath,launch:()=>{
    calls++;const child={once(event,callback){if(event==='error')queueMicrotask(()=>callback(Object.assign(Error('launch failed'),{code:'ENOENT'})));return child;}};return child;
  }}),/launch failed/);
  assert.equal(calls,1);
});

test('macOS desktop launch retains one launch with no additional activation delay',async()=>{
  let calls=0;
  await openAccountDesktop({platform:'darwin',configured:process.execPath,launch:()=>{
    calls++;const child={once(event,callback){if(event==='spawn')queueMicrotask(callback);return child;},unref(){}};return child;
  }});
  assert.equal(calls,1);
});

test('force switch stops a supervisor-restarted runtime again after account validation',async t=>{
  let alive=true,stops=0;
  const f=fixture(t,{
    prepareSwitch:async()=>{stops++;alive=false;},
    guard:async()=>{if(alive)throw Error('Codex 或 CLI 会话仍在运行');},
    session:({home})=>({async read(){alive=true;return info(JSON.parse(fs.readFileSync(path.join(home,'auth.json'))));},async close(){}})
  });
  const second=auth('second');f.setProfiles([second]);
  await f.manager.command({action:'switch',id:credentialProfile(second,info(second)).id,confirmed:true,force:true});
  assert.equal(stops,2);assert.equal(f.opened,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.codexHome,'auth.json'))).tokens.account_id,'second');
});

test('a restarted runtime that cannot be stopped leaves active credentials unchanged',async t=>{
  let stops=0;const f=fixture(t,{prepareSwitch:async()=>{if(++stops===2)throw Error('stop denied');}});
  const second=auth('second');f.setProfiles([second]);const before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
  await assert.rejects(f.manager.command({action:'switch',id:credentialProfile(second,info(second)).id,confirmed:true,force:true}),/stop denied/);
  assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);assert.equal(f.opened,0);
});

test('force stop also terminates new Codex processes appearing during shutdown',async()=>{
  const first={pid:123,executable:'/App/codex'},restarted={pid:124,executable:'/App/codex'},calls=[];
  let current=[first];
  await stopAccountProcesses({list:()=>current,wait:async()=>{},kill:(pid,signal)=>{
    calls.push([pid,signal]);if(pid===first.pid)current=[restarted];else if(pid===restarted.pid)current=[];
  }});
  assert.deepEqual(calls,[[123,'SIGTERM'],[124,'SIGTERM']]);
});

test('automatic handoff refuses a restarted session instead of stopping it after validation',async t=>{
  let alive=true,stops=0;
  const f=fixture(t,{
    prepareSwitch:async()=>{stops++;alive=false;},
    guard:async()=>{if(alive)throw Error('new session');},
    session:({home})=>({async read(){alive=true;return info(JSON.parse(fs.readFileSync(path.join(home,'auth.json'))));},async close(){}})
  });
  const first=auth('first'),second=auth('second');f.setProfiles([second]);
  fs.writeFileSync(path.join(f.codexHome,'config.toml'),'cli_auth_credentials_store = "file"\n');
  const before=fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8');
  await assert.rejects(f.manager.command({action:'switch',id:credentialProfile(second,info(second)).id,confirmed:true},{automatic:true,expectedSourceId:credentialProfile(first,info(first)).id}),/new session/);
  assert.equal(stops,1);assert.equal(fs.readFileSync(path.join(f.codexHome,'auth.json'),'utf8'),before);assert.equal(f.opened,0);
});
