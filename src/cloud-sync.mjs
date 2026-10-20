import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import {readJSON,atomicJSON} from './paths.mjs';
import {syncSecrets} from './sync-secrets.mjs';
import {githubSync} from './github-sync.mjs';
import {digest,numericRecords,partitionRecords} from './analytics/sync-records.mjs';

export function syncKey(secret){return crypto.scryptSync(secret,'context-manager-sync-v1',32);}
export function seal(value,key,aad){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
  const data=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value)))),cipher.final()]);
  return JSON.stringify({v:1,zip:'gzip',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
}
export function unseal(raw,key,aad){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>512000)throw Error('Invalid encrypted sync file');
  try{const p=JSON.parse(raw);if(p.v!==1||p.zip!=='gzip')throw Error();const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));d.setAAD(Buffer.from(aad));d.setAuthTag(Buffer.from(p.tag,'base64'));return JSON.parse(gunzipSync(Buffer.concat([d.update(Buffer.from(p.data,'base64')),d.final()]),{maxOutputLength:4*1024*1024}).toString());}
  catch{throw Error('同步密钥错误或云端数据损坏');}
}
export function createCloudSync({home,analytics,secrets=syncSecrets(home),transport=githubSync,prepare=async()=>{},now=Date.now}={}){
  const file=path.join(home,'cloud-sync.json'),cacheFile=path.join(home,'cloud-sync-cache.json');
  let config={version:1,enabled:false,provider:'repository',repository:'',gistId:'',intervalMinutes:15,startup:true,deviceId:crypto.randomBytes(16).toString('hex'),...readJSON(file,{})};
  let cache=readJSON(cacheFile,{target:null,shards:{},uploaded:{}}),pending,timer,closed=false,controller,failures=0;
  let status={running:false,lastSuccess:config.lastSuccess??null,error:null,devices:config.lastDevices??0,requests:0,nextRun:null};
  const save=()=>atomicJSON(file,config);
  function state(){const {boundAccount,...publicConfig}=config;return {...publicConfig,...status};}
  function schedule(delay){clearTimeout(timer);status.nextRun=null;if(closed||!config.enabled||config.intervalMinutes===0)return;status.nextRun=now()+delay;timer=setTimeout(()=>{void sync().catch(()=>{});},delay);timer.unref();}
  const normalDelay=()=>config.intervalMinutes*60000;
  async function sync(){
    if(pending)return pending;if(closed)throw Error('Cloud sync closed');
    if(!config.enabled)throw Error('请先启用并保存云同步');
    status.running=true;
    pending=Promise.resolve().then(async()=>{
      status.running=true;status.error=null;clearTimeout(timer);status.nextRun=null;
      controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),240000);timeout.unref();
      try{
        if(closed)throw Error('Cloud sync closed');
        const credentials=secrets.get(),key=syncKey(credentials.key||'');
        await prepare();
        const account=analytics.syncAccount(key);if(!account)throw Error('请先刷新 Codex 账号额度后再同步');
        if(config.boundAccount&&config.boundAccount!==account)throw Error('Codex 账号已变化，请关闭同步并为当前账号重新配置');
        if(!credentials.token||!credentials.key)throw Error('请配置 GitHub Token 和同步密钥');
        const target=digest([config.provider,config.repository,config.gistId,account]);
        if(cache.target!==target)cache={target,shards:{},uploaded:{}};
        const remote=transport({...config,group:account},credentials.token,{signal:controller.signal});await remote.init();
        const manifests=await remote.manifests();if(manifests.length>20)throw Error('同步设备超过 20 台，请使用新的同步空间');
        const local=await analytics.syncExport();
        if(analytics.syncAccount(key)!==account)throw Error('Codex 账号已变化，请重试');
        const exported=partitionRecords(local),localFiles=[];
        for(const data of exported.values()){
          const clean=numericRecords(data,now()),hash=digest(clean),name=remote.chunkName(config.deviceId,hash);localFiles.push({name,hash});
          if(cache.uploaded[name]!==hash){await remote.write(name,seal(clean,key,`${account}/${config.deviceId}/${name}`));cache.uploaded[name]=hash;atomicJSON(cacheFile,cache);}
        }
        const manifest={version:1,account,device:config.deviceId,files:localFiles};
        const manifestHash=digest(manifest),manifestName=remote.manifestName(config.deviceId);
        // Publish the manifest last. A failed upload never exposes a partial device snapshot.
        if(cache.uploaded.manifest!==manifestHash||!manifests.some(m=>m.device===config.deviceId)){
          await remote.write(manifestName,seal(manifest,key,`${account}/${config.deviceId}/manifest`));cache.uploaded.manifest=manifestHash;
        }
        const nextShards={},imports=[];let importedRecords=0,importedBytes=0;
        for(const m of manifests){
          if(m.device===config.deviceId)continue;
          const doc=unseal(await remote.read(m.name),key,`${account}/${m.device}/manifest`);
          if(doc.version!==1||doc.account!==account||doc.device!==m.device||!Array.isArray(doc.files)||doc.files.length>1000)throw Error('Invalid sync manifest');
          for(const entry of doc.files){
            if(!/^[a-f0-9]{64}$/.test(entry.hash)||entry.name!==remote.chunkName(m.device,entry.hash))throw Error('Invalid sync file reference');
            const id=`${m.device}/${entry.hash}`;
            if(nextShards[id])throw Error('Duplicate sync shard reference');
            const data=cache.shards[id]??numericRecords(unseal(await remote.read(entry.name),key,`${account}/${m.device}/${entry.name}`),now(),{retainExpired:true});
            if(digest(data)!==entry.hash)throw Error('Sync checksum mismatch');
            importedRecords+=data.requests.length+data.snapshots.length;importedBytes+=Buffer.byteLength(JSON.stringify(data));
            if(importedRecords>500000||importedBytes>64*1024*1024)throw Error('Sync history exceeds local import limit');
            nextShards[id]=data;imports.push({id,data});
          }
        }
        if(closed||controller.signal.aborted||analytics.syncAccount(key)!==account)throw Error('Sync cancelled or account changed');
        await analytics.syncImport({account,scope:local.scope,shards:imports});
        const activeFiles=new Set(localFiles.map(f=>f.name));
        // Only this device's obsolete files are pruned. Readers of an old manifest
        // may retry, but they never import a partially available device snapshot.
        for(const name of Object.keys(cache.uploaded))if(name!=='manifest'&&!activeFiles.has(name)&&remote.remove){
          try{await remote.remove(name);delete cache.uploaded[name];}catch{break;}
        }
        config.boundAccount=account;config.lastSuccess=now();config.lastDevices=new Set([config.deviceId,...manifests.map(m=>m.device)]).size;save();cache.shards=nextShards;atomicJSON(cacheFile,cache);failures=0;
        status={...status,lastSuccess:now(),error:null,devices:new Set([config.deviceId,...manifests.map(m=>m.device)]).size,requests:local.requests.length};
      }catch(error){failures++;status.error=error.name==='AbortError'?'同步超时，将稍后重试':error.message;throw Error(status.error);}
      finally{clearTimeout(timeout);status.running=false;pending=null;schedule(Math.max(normalDelay(),failures?Math.min(3600000,60000*2**Math.min(failures,6)):0));}
      return state();
    });return pending;
  }
  async function command(params={}){
    if(params.action==='status'||!params.action)return state();
    if(params.action==='credential'){
      if(!['token','key'].includes(params.field))throw Error('Invalid sync credential field');
      const value=secrets.get()[params.field];if(typeof value!=='string'||!value)throw Error('尚未保存此凭据');
      return {value};
    }
    if(params.action==='save-and-sync'){
      await command({...params,action:'configure',enabled:true});
      void sync().catch(()=>{});return state();
    }
    if(params.action==='sync'){void sync().catch(()=>{});return state();}
    if(pending)throw Error('同步正在进行，请完成后修改配置');
    if(params.action==='create-gist'){
      const token=params.token||secrets.get().token;if(typeof token!=='string'||!token||token.length>512||/[\x00-\x20]/.test(token))throw Error('请先填写 GitHub Token');
      const id=await transport({provider:'gist'},token,{signal:AbortSignal.timeout(30000)}).createGist();config.gistId=id;save();return state();
    }
    if(params.action!=='configure')throw Error('Unknown cloud sync action');
    const next={...config};
    for(const field of ['enabled','startup'])if(params[field]!==undefined){if(typeof params[field]!=='boolean')throw Error('Invalid sync option');next[field]=params[field];}
    if(params.provider!==undefined){if(!['repository','gist'].includes(params.provider))throw Error('Invalid sync provider');next.provider=params.provider;}
    for(const field of ['repository','gistId'])if(params[field]!==undefined){if(typeof params[field]!=='string')throw Error('Invalid sync destination');next[field]=params[field].trim();}
    if(params.intervalMinutes!==undefined){if(!Number.isInteger(params.intervalMinutes)||params.intervalMinutes!==0&&(params.intervalMinutes<5||params.intervalMinutes>1440))throw Error('同步间隔应为 5–1440 分钟，或选择仅手动');next.intervalMinutes=params.intervalMinutes;}
    const previousCredentials=secrets.get();let credentials={...previousCredentials};
    for(const field of ['token','key'])if(params[field]){if(typeof params[field]!=='string'||params[field].length>512||/[\r\n\x00]/.test(params[field]))throw Error('Invalid sync credential');credentials={...credentials,[field]:params[field]};}
    if(next.enabled){
      if(!credentials.token||!credentials.key)throw Error('请填写 GitHub Token 和同步密钥');
      if(next.provider==='repository'&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(next.repository)||next.provider==='repository'&&next.repository.split('/').some(p=>p==='.'||p==='..'))throw Error('私有仓库请填写 owner/repository');
      if(next.provider==='gist'&&!/^[a-f0-9]{20,64}$/.test(next.gistId))throw Error('请填写有效的 Gist ID');
    }
    const rebinding=credentials.key!==previousCredentials.key||next.provider!==config.provider||next.repository!==config.repository||next.gistId!==config.gistId||!config.enabled;
    if(rebinding)delete next.boundAccount;
    if(params.token||params.key)secrets.set(credentials);
    next.hasToken=!!credentials.token;next.hasKey=!!credentials.key;
    if(params.claimLegacy===true)await analytics.syncExport({claimLegacy:true});
    if(!next.enabled||rebinding)await analytics.syncImport({enabled:false});config=next;save();status.error=null;
    schedule(next.startup?1000:normalDelay());return state();
  }
  if(config.enabled)schedule(config.startup?3000:normalDelay());
  return {state,command,sync,close(){closed=true;clearTimeout(timer);controller?.abort();}};
}
