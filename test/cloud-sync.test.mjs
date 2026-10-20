import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {QuotaLedger} from '../src/analytics/ledger.mjs';
import {createCloudSync,syncKey,seal,unseal} from '../src/cloud-sync.mjs';
import {numericRecords,mergeRequests,partitionRecords} from '../src/analytics/sync-records.mjs';
import {githubSync} from '../src/github-sync.mjs';
import {syncSecrets} from '../src/sync-secrets.mjs';
import {runManagerCLI} from '../src/manager-cli.mjs';

const now=Date.now(),key='random-test-sync-key-'.repeat(3),scope='account:'+'a'.repeat(32);
const request=(id='resp1',extra={})=>({id,at:now-1000,model:'model',input:100,output:20,cached:80,written:null,...extra});
const records=(requests=[])=>({version:1,requests,snapshots:[]});
function cloud(){
  const files=new Map(),writes=[];let offline=false;
  const transport=config=>({
    init:async()=>{if(offline)throw Error('offline');},createGist:async()=>'b'.repeat(32),
    manifests:async()=>[...files.keys()].filter(n=>n.startsWith(config.group+'/')&&/manifest-[a-f0-9]{32}\.json$/.test(n)).map(n=>({name:n.split('/').at(-1),device:n.match(/manifest-([a-f0-9]{32})/)[1]})),
    manifestName:device=>`manifest-${device}.json`,chunkName:(device,hash)=>`chunks/${device}/${hash}.json`,
    read:async name=>{const value=files.get(config.group+'/'+name);assert.ok(value,'remote file exists');return value;},
    write:async(name,data)=>{writes.push(name);files.set(config.group+'/'+name,data);}
  });return {transport,files,writes,setOffline:value=>{offline=value;}};
}
function fixture(t,remote){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-sync-')),ledger=new QuotaLedger({file:path.join(home,'ledger.sqlite'),home,now:()=>now});
  let identity='same-account',credentials={token:'test-token-never-upload',key};
  ledger.recordLive({scope,at:now-10000,buckets:[],accountGroup:'a'.repeat(32),identity,label:'Local account'});
  const analytics={syncAccount:k=>identity?crypto.createHmac('sha256',k).update(identity).digest('hex').slice(0,32):null,syncExport:async p=>ledger.syncExport(p),syncImport:async p=>ledger.syncImport(p),syncSettings:async p=>ledger.syncSettings(p),syncProfiles:async k=>ledger.syncProfiles().map(({identity,...p})=>({...p,id:crypto.createHmac('sha256',k).update(identity).digest('hex').slice(0,32)}))};
  const service=createCloudSync({home,analytics,secrets:{get:()=>credentials,set:v=>{credentials=v;}},transport:remote.transport,now:()=>now});
  t.after(()=>{service.close();ledger.close();fs.rmSync(home,{recursive:true,force:true});});
  const add=(id,extra={})=>ledger.consume({type:'token_usage_record',timestamp:new Date(now-1000).toISOString(),payload:{response_id:id,usage:{input_tokens:100,output_tokens:20,cached_input_tokens:80,...extra}}},{id:'thread',model:'model',name:'PRIVATE TITLE',project:'PRIVATE PATH'});
  return {service,ledger,home,add,setAccount:value=>{identity=value;if(value){const group=value==='same-account'?'a'.repeat(32):crypto.createHash('sha256').update(value).digest('hex').slice(0,32);ledger.recordLive({scope:'account:'+group,at:now-5000,buckets:[],accountGroup:group,identity,label:'Local account'});}},configure:params=>service.command({action:'configure',enabled:true,repository:'owner/private',intervalMinutes:0,...params})};
}

test('AES-GCM authenticates content, key and file/device context',()=>{
  const k=syncKey(key),raw=seal(records([request()]),k,'device/chunk');assert.deepEqual(unseal(raw,k,'device/chunk'),records([request()]));
  assert.throws(()=>unseal(raw,k,'another-device/chunk'));assert.throws(()=>unseal(raw,syncKey('wrong key'),'device/chunk'));
  const corrupt=JSON.parse(raw);corrupt.data='AAAA'+corrupt.data.slice(4);assert.throws(()=>unseal(JSON.stringify(corrupt),k,'device/chunk'));
});

test('numeric allowlist and deterministic dedup do not add duplicate token quantities',()=>{
  const a=request('same',{title:'PRIVATE TITLE',thread:'PRIVATE THREAD'}),b=request('same',{written:12});
  assert.equal(JSON.stringify(numericRecords(records([a]))).includes('PRIVATE'),false);
  assert.equal(mergeRequests([a],[b]).length,1);assert.equal(mergeRequests([a],[b])[0].written,12);
  assert.deepEqual(mergeRequests([a],[b]),mergeRequests([b],[a]));
  assert.throws(()=>numericRecords(records([request('bad',{input:-1})])));
  assert.throws(()=>numericRecords(records([request('bad',{cached:101})])));
  const shards=partitionRecords(records(Array.from({length:4001},(_,i)=>request('r'+i))));assert.equal(shards.size,3);assert.ok([...shards.values()].every(s=>s.requests.length<=2000));
});

test('five devices converge, never re-export imports, avoid unchanged writes and isolate accounts',async t=>{
  const remote=cloud(),devices=Array.from({length:5},()=>fixture(t,remote));
  for(let i=0;i<devices.length;i++){devices[i].add('own-'+i);devices[i].add('duplicate');await devices[i].configure();await devices[i].service.sync();}
  for(const f of devices)await f.service.sync();
  for(const f of devices){const data=f.ledger.read();assert.equal(data.requests.length,6);assert.equal(data.requests.reduce((n,r)=>n+r.input,0),600);assert.equal(f.ledger.syncExport().requests.length,2);assert.equal(f.service.state().devices,5);}
  const writes=remote.writes.length;await devices[0].service.sync();assert.equal(remote.writes.length,writes);
  const all=[...remote.files.values()].join('');for(const secret of ['PRIVATE TITLE','PRIVATE PATH','test-token-never-upload','same-account','own-0'])assert.equal(all.includes(secret),false);
  assert.equal(JSON.stringify(devices[0].service.state()).includes(key),false);
  devices[0].setAccount('other-account');await devices[0].service.sync();assert.equal(devices[0].ledger.read().requests.length,0);devices[0].setAccount('same-account');await devices[0].service.sync();assert.equal(devices[0].ledger.read().requests.length,6);
  await devices[1].configure({enabled:false});assert.equal(devices[1].ledger.read().requests.length,2);
  const other=fixture(t,remote);other.setAccount('unrelated');other.add('separate');await other.configure();await other.service.sync();assert.equal(other.ledger.read().requests.length,1);
});

test('failed publication retains remote manifest and local data; retry converges',async t=>{
  const remote=cloud(),f=fixture(t,remote);f.add('one');await f.configure();await f.service.sync();
  const manifest=[...remote.files].find(([n])=>n.includes('manifest-'));
  const original=remote.transport;let fail=true;
  remote.transport=config=>{const transport=original(config);return {...transport,write:async(name,data)=>{if(fail)throw Error('offline');return transport.write(name,data);}};};
  const second=fixture(t,remote);second.add('two');await second.configure();await assert.rejects(second.service.sync(),/offline/);assert.equal(remote.files.get(manifest[0]),manifest[1]);assert.equal(second.ledger.read().requests.length,1);
  fail=false;await second.service.sync();assert.equal(second.ledger.read().requests.length,2);
});

test('an unavailable account before the first await does not wedge later sync attempts',async t=>{
  const f=fixture(t,cloud());f.add('one');await f.configure();f.setAccount(null);
  await assert.rejects(f.service.sync(),/刷新 Codex/);assert.equal(f.service.state().running,false);
  f.setAccount('same-account');await f.service.sync();assert.ok(f.service.state().lastSuccess);
});

test('one-character keys save, remain retrievable and do not leak in normal status',async t=>{
  const f=fixture(t,cloud());await f.configure({key:'短'});
  assert.equal((await f.service.command({action:'credential',field:'key'})).value,'短');
  assert.equal((await f.service.command({action:'credential',field:'token'})).value,'test-token-never-upload');
  await f.configure({key:'',token:''});assert.equal((await f.service.command({action:'credential',field:'key'})).value,'短');
  assert.equal(JSON.stringify(f.service.state()).includes('test-token-never-upload'),false);
  assert.equal(Object.hasOwn(f.service.state(),'key'),false);
  await assert.rejects(f.service.command({action:'credential',field:'other'}),/Invalid/);
});

test('save-and-sync enables an initially disabled device and saves its current form first',async t=>{
  const f=fixture(t,cloud());assert.equal(f.service.state().enabled,false);
  const started=await f.service.command({action:'save-and-sync',enabled:false,provider:'repository',repository:'owner/private',intervalMinutes:0,key:'a',token:'new-token'});
  assert.equal(started.enabled,true);await f.service.sync();assert.ok(f.service.state().lastSuccess);
  assert.equal((await f.service.command({action:'credential',field:'token'})).value,'new-token');
  await assert.rejects(f.service.command({action:'save-and-sync',repository:'invalid'}),/owner/);
});

test('saving unchanged settings before an offline sync preserves the previous imported history',async t=>{
  const remote=cloud(),first=fixture(t,remote),second=fixture(t,remote);
  first.add('first');second.add('second');await first.configure();await first.service.sync();await second.configure();await second.service.sync();
  assert.equal(second.ledger.read().requests.length,2);
  await second.configure({token:'updated-token'});assert.equal(second.ledger.read().requests.length,2);
  remote.setOffline(true);await assert.rejects(second.service.sync(),/offline/);
  assert.equal(second.ledger.read().requests.length,2);
  await second.configure({key});assert.equal(second.ledger.read().requests.length,2,'re-entering the same key keeps imported data');
  await second.configure({enabled:false});assert.equal(second.ledger.read().requests.length,1);
});

test('sync refreshes account availability before calculating its account namespace',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sync-prepare-'));let ready=false;
  const service=createCloudSync({home,secrets:{get:()=>({token:'test',key:'a'}),set:()=>{}},prepare:async()=>{ready=true;},analytics:{syncAccount:()=>ready?'a'.repeat(32):null,syncExport:async()=>({scope,requests:[],snapshots:[]}),syncImport:async()=>{}},transport:cloud().transport});
  t.after(()=>{service.close();fs.rmSync(home,{recursive:true,force:true});});
  await service.command({action:'save-and-sync',repository:'owner/private',intervalMinutes:0});await service.sync();assert.ok(service.state().lastSuccess);
});

test('macOS credential writes are read back and failed interactive commands cannot look saved',()=>{
  const value={token:'test-token',key:'a'};let stored=null,dropWrite=false;
  const vault=syncSecrets('/fixture/mac',{platform:'darwin',execute:(command,args,options)=>{
    assert.equal(command,'/usr/bin/security');
    if(args[0]==='-i'){assert.equal(args.some(a=>a.includes(value.token)),false);if(!dropWrite)stored=options.input.match(/ -w ([A-Za-z0-9+/=]+)/)[1];return {status:0,stdout:'',stderr:''};}
    return stored?{status:0,stdout:stored+'\n'}:{status:44,stdout:''};
  }});
  vault.set(value);assert.deepEqual(vault.get(),value);dropWrite=true;
  assert.throws(()=>vault.set({...value,key:'new-key'}),/读回/);
});

test('legacy history is excluded unless explicitly claimed; cloud merge can be disabled',async t=>{
  const f=fixture(t,cloud());f.ledger.consume({type:'token_usage_record',timestamp:new Date(now-20000).toISOString(),payload:{response_id:'old',usage:{input_tokens:10,output_tokens:1}}},{id:'old'});
  assert.equal(f.ledger.syncExport().requests.length,0);await f.configure({claimLegacy:true});assert.equal(f.ledger.syncExport().requests.length,1);
  await assert.rejects(f.configure({intervalMinutes:1}),/5–1440/);await assert.rejects(f.configure({repository:'../bad'}),/owner/);
});

test('repository transport enforces private visibility and retries SHA conflict',async()=>{
  let reads=0,puts=0;const fetcher=async(url,options)=>{
    assert.equal(new URL(url).hostname,'api.github.com');
    if(!url.includes('/contents/'))return Response.json({private:true});
    if(options.method==='PUT'){puts++;const body=JSON.parse(options.body);assert.equal(body.sha,reads===1?'old':'new');if(puts===1)return new Response('{}',{status:409});return Response.json({});}
    reads++;return Response.json({sha:reads===1?'old':'new'});
  };
  const remote=githubSync({provider:'repository',repository:'owner/repo',group:'a'.repeat(32)},'token',{fetcher,writeDelay:0});await remote.init();await remote.write('manifest-test.json','encrypted');assert.equal(puts,2);
  await assert.rejects(githubSync({provider:'repository',repository:'o/r'},'t',{fetcher:async()=>Response.json({private:false})}).init(),/私有/);
});

test('Gist transport PATCH touches only this device file and refuses public Gists',async()=>{
  let patch;const remote=githubSync({provider:'gist',gistId:'a'.repeat(32),group:'b'.repeat(32)},'token',{fetcher:async(url,options)=>{
    if(options.method==='PATCH'){patch=JSON.parse(options.body);return Response.json({});}return Response.json({public:false,files:{}});
  }});await remote.init();await remote.write('my-device.json','encrypted');assert.deepEqual(patch,{files:{'my-device.json':{content:'encrypted'}}});
  await assert.rejects(githubSync({provider:'gist',gistId:'id'},'token',{fetcher:async()=>Response.json({public:true})}).init(),/Secret/);
});

test('sync CLI accepts config through stdin and never echoes credentials',async()=>{
  let command;const output=await runManagerCLI(['global','sync-configure','--input','-'],{stdin:[JSON.stringify({token:'secret',enabled:true})],client:async(op,params)=>{assert.equal(op,'cloud-sync');command=params;return {enabled:true};}});
  assert.equal(command.token,'secret');assert.equal(command.action,'configure');assert.equal(JSON.stringify(output).includes('secret'),false);
});

test('Windows credentials round-trip through DPAPI without plaintext on disk',{skip:process.platform!=='win32'},t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sync-secrets-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const vault=syncSecrets(home),value={token:'a-test-token',key:'a-very-long-random-key'};vault.set(value);assert.deepEqual(vault.get(),value);assert.equal(fs.readFileSync(path.join(home,'cloud-sync-secrets.json'),'utf8').includes(value.key),false);
});


test('multi-account discovery, device filters and offline selections preserve account ownership',async t=>{
  const remote=cloud(),win=fixture(t,remote),mac=fixture(t,remote),secondMac=fixture(t,remote);
  win.add('win-a');await win.configure({deviceName:'Windows'});await win.service.sync();
  mac.setAccount('account-b');mac.add('mac-b');await mac.configure({deviceName:'MacBook'});await mac.service.sync();
  secondMac.add('mac-a');await secondMac.configure({deviceName:'Mac mini'});await secondMac.service.sync();
  await win.service.sync();await mac.service.sync();await secondMac.service.sync();
  assert.equal(win.service.state().accounts.length,2,'remote accounts discovered without logging in locally');
  assert.equal(win.ledger.read().requests.length,2,'current account excludes account B');
  await win.configure({statisticsMode:'all'});assert.equal(win.ledger.read().requests.length,3);
  const accountB=win.service.state().accounts.find(a=>!a.current).id;
  await win.configure({statisticsMode:'selected',excludedAccounts:[accountB]});assert.equal(win.ledger.read().requests.length,2);
  await win.configure({excludedAccounts:[],excludedDevices:[secondMac.service.state().deviceId]});assert.equal(win.ledger.read().requests.length,2);
  await win.configure({excludedDevices:[secondMac.service.state().deviceId,win.service.state().deviceId]});assert.equal(win.ledger.read().requests.length,1);
  remote.setOffline(true);await assert.rejects(win.service.sync(),/offline/);
  await win.configure({statisticsMode:'all',excludedDevices:[]});assert.equal(win.ledger.read().requests.length,3,'offline changing selections restores cached data');
  assert.equal(win.ledger.syncExport().requests.length,1,'remote account records never re-exported');
  await win.configure({statisticsMode:'selected',excludedAccounts:win.service.state().accounts.map(a=>a.id)});assert.equal(win.ledger.read().requests.length,0);
});

test('per-account sync pause retains cached totals and resumes without duplicate records',async t=>{
  const remote=cloud(),win=fixture(t,remote),mac=fixture(t,remote);
  win.add('win');await win.configure();await win.service.sync();
  mac.add('mac');await mac.configure();await mac.service.sync();await win.service.sync();
  const id=win.service.state().accounts.find(a=>a.current).id;
  await win.configure({excludedSyncAccounts:[id]});mac.add('later');await mac.service.sync();await win.service.sync();
  assert.equal(win.ledger.read().requests.length,2);
  await win.configure({excludedSyncAccounts:[]});await win.service.sync();assert.equal(win.ledger.read().requests.length,3);
});

test('switching accounts retains local histories and time-based attribution through rescans',async t=>{
  const f=fixture(t,cloud());f.add('a');f.setAccount('b');f.add('b');await f.configure();await f.service.sync();
  assert.equal(f.ledger.read().requests.length,1);assert.equal(f.ledger.syncExport().requests[0].id,'b');
  await f.configure({statisticsMode:'all'});assert.equal(f.ledger.read().requests.length,2);
  assert.equal(f.ledger.scopeAt(now-7000),scope);assert.notEqual(f.ledger.scopeAt(now-1000),scope);
  const saved=JSON.stringify(f.service.state());assert.equal(saved.includes('same-account'),false);
});
