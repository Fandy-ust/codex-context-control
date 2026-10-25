import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJSON,readJSON} from './paths.mjs';
import {privateDirectory} from './platform/index.mjs';
import {accountVault} from './account-vault.mjs';
import {nativeAccountSession} from './account-login.mjs';

const safeName=value=>typeof value==='string'&&value.length<=40&&!/[\x00-\x1f\x7f]/.test(value);
const fileBacked=text=>!/^\s*cli_auth_credentials_store\s*=\s*["'](?:keyring|ephemeral)["']/m.test((text||'').split(/^\s*\[/m)[0]);
const savedProfile=(value,id)=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id)&&Object.hasOwn(value.profiles,id)?value.profiles[id]:null;
export function credentialProfile(auth,account){
  if(account?.type!=='chatgpt'||typeof account.email!=='string'||!account.email||!auth?.tokens||typeof auth.tokens.account_id!=='string'||!auth.tokens.account_id||!['access_token','refresh_token','id_token'].every(k=>typeof auth.tokens[k]==='string'&&auth.tokens[k]))throw Error('请使用 ChatGPT 官方授权添加账号');
  const workspace=auth.tokens.account_id,id=crypto.createHash('sha256').update(JSON.stringify([account.email.toLowerCase(),workspace])).digest('hex').slice(0,32);
  return {id,email:account.email.slice(0,160),workspace:workspace.slice(0,160),plan:typeof account.planType==='string'?account.planType.slice(0,80):null};
}
export function fileStoreConfig(text){
  const boundary=text.search(/^\s*\[/m),head=boundary<0?text:text.slice(0,boundary),tail=boundary<0?'':text.slice(boundary);
  const pattern=/^\s*cli_auth_credentials_store\s*=.*$/m;
  return (pattern.test(head)?head.replace(pattern,'cli_auth_credentials_store = "file"'): 'cli_auth_credentials_store = "file"\n'+head)+tail;
}

// The vault is local-only. Public state is built from metadata, never auth objects.
export function createAccountSwitcher({home,codexHome,secrets=accountVault(home),session=nativeAccountSession,guard=async()=>{},prepareSwitch=async()=>{},quiesce=async()=>()=>{},openDesktop=async()=>{},secure=privateDirectory,now=Date.now}={}){
  const directory=path.join(home,'account-login'),authFile=path.join(codexHome,'auth.json'),configFile=path.join(codexHome,'config.toml');
  const metadataFile=path.join(home,'account-switch.json');let metadata=readJSON(metadataFile,{profiles:[]}),job=null,busy=false,client=null,closed=false;
  const lockFile=path.join(home,'account-switch.lock');
  try{const pid=Number(fs.readFileSync(lockFile,'utf8'));if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')fs.unlinkSync(lockFile);}}}catch{}
  if(!fs.existsSync(lockFile)&&fs.existsSync(directory))for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.isDirectory()&&/^login-[\w-]+$/.test(entry.name))try{cleanup(path.join(directory,entry.name));}catch{}}
  function state(){return {profiles:metadata.profiles||[],activeId:metadata.activeId??null,restartRequired:metadata.restartRequired===true,busy,job:job?{status:job.status,error:job.error??null}:null};}
  const persist=()=>atomicJSON(metadataFile,metadata);
  function vault(){const value=secrets.get();return {version:1,profiles:{},...value};}
  function saveProfile(value,auth,account,name){const profile=credentialProfile(auth,account),previous=value.profiles[profile.id];if(!previous&&Object.keys(value.profiles).length>=20)throw Error('最多保存 20 个登录账号');value.profiles[profile.id]={...previous,...profile,name:name??previous?.name??'',auth,updatedAt:now()};return value.profiles[profile.id];}
  function saveVault(value){secrets.set(value);metadata.profiles=Object.values(value.profiles).map(({auth,...p})=>p);persist();}
  function staging(){secure(directory);const folder=fs.mkdtempSync(path.join(directory,'login-'));secure(folder);return folder;}
  function cleanup(folder){if(path.dirname(path.resolve(folder))!==path.resolve(directory))throw Error('Invalid login directory');
    // Native initialization may install read-only Git/plugin files. Clear only
    // regular files inside this owned directory; never follow symlinks.
    const writable=file=>{const stat=fs.lstatSync(file);if(stat.isSymbolicLink())return;if(stat.isDirectory())for(const entry of fs.readdirSync(file))writable(path.join(file,entry));else fs.chmodSync(file,0o600);};
    writable(folder);fs.rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
  function acquire(){secure(home);let fd;try{fd=fs.openSync(lockFile,'wx',0o600);fs.writeFileSync(fd,String(process.pid));}catch{if(fd!=null)fs.closeSync(fd);throw Error('另一个账号操作尚未结束；请重启管理服务后重试');}return ()=>{fs.closeSync(fd);fs.unlinkSync(lockFile);};}
  async function exclusive(work,check=true,prepare=async()=>{}){if(busy||closed)throw Error('账号操作正在进行，请稍后重试');busy=true;let fd,release=()=>{};
    try{secure(home);try{fd=fs.openSync(lockFile,'wx',0o600);fs.writeFileSync(fd,String(process.pid));}catch{throw Error('另一个账号操作尚未结束；请重启管理服务后重试');}if(check){release=await quiesce();await prepare();await guard();}return await work();}
    finally{try{await release();}finally{if(fd!=null){fs.closeSync(fd);fs.unlinkSync(lockFile);}busy=false;}}
  }
  async function readProfile(folder,{refresh=false,quota=false}={}){const instance=session({home:folder});try{const account=await instance.read({refresh,quota}),auth=readJSON(path.join(folder,'auth.json'));return {profile:credentialProfile(auth,account),account,auth};}finally{await instance.close();}}
  async function login(name){
    if(!safeName(name))throw Error('账号名称无效');if(busy||closed)throw Error('账号操作正在进行，请稍后重试');busy=true;let folder,unlock;
    try{unlock=acquire();folder=staging();client=session({home:folder});const instance=client;job={status:'starting'};
      let resolveURL,rejectURL;const urlReady=new Promise((resolve,reject)=>{resolveURL=resolve;rejectURL=reject;});
      void (async()=>{try{const account=await instance.login(url=>{job={status:'waiting'};resolveURL(url);}),auth=readJSON(path.join(folder,'auth.json'));if(closed)throw Error();const value=vault();saveProfile(value,auth,account,name.trim());saveVault(value);job={status:'completed'};}
        catch{job={status:'failed',error:'账号授权未完成，请重试'};rejectURL(Error('账号授权未完成，请重试'));}
        finally{await instance.close();client=null;try{cleanup(folder);}catch{job={status:'failed',error:'无法清理临时登录文件，请重启管理服务'};}finally{unlock();busy=false;}}})();
      const authUrl=await urlReady;return {...state(),authUrl};
    }catch(error){if(!client&&busy){try{if(folder&&fs.existsSync(folder))cleanup(folder);}finally{unlock?.();busy=false;}}throw error;}
  }
  async function command(params={}){
    const action=params.action||'status';if(action==='status')return state();
    if(action==='login')return login(params.name||'');
    if(action==='cancel'){if(client){client.close();}return state();}
    if(action==='rename'||action==='remove'){
      return exclusive(async()=>{const value=vault(),profile=savedProfile(value,params.id);if(!profile)throw Error('找不到已授权账号');
        if(action==='rename'){if(!safeName(params.name))throw Error('账号名称无效');profile.name=params.name.trim();}
        else{delete value.profiles[params.id];if(metadata.activeId===params.id)metadata.activeId=null;}
        saveVault(value);return state();},false);
    }
    if(action==='capture')return exclusive(async()=>{const config=fs.existsSync(configFile)?fs.readFileSync(configFile,'utf8'):'';if(!fileBacked(config))throw Error('当前凭据不是文件模式，请通过网页授权添加账号');const value=vault(),source=await readProfile(codexHome);saveProfile(value,source.auth,source.account);metadata.activeId=source.profile.id;saveVault(value);return state();});
    if(action!=='switch')throw Error('未知账号操作');
    if(params.confirmed!==true)throw Error('请先确认切换账号');
    return exclusive(async()=>{
      const value=vault(),selected=savedProfile(value,params.id);if(!selected)throw Error('找不到已授权账号');
      if(params.confirmed!==true)throw Error('请先确认切换账号');
      const config=fs.existsSync(configFile)?fs.readFileSync(configFile,'utf8'):null;
      // Switching opts into file storage so the desktop reads the same auth slot.
      // Keep original OS keychain credentials untouched.
      const before=fs.existsSync(authFile)?fs.readFileSync(authFile):null;
      const folder=staging();let committed=false;
      try{
        if(before&&fileBacked(config)){const source=await readProfile(codexHome);saveProfile(value,source.auth,source.account);}
        atomicJSON(path.join(folder,'auth.json'),value.profiles[params.id].auth);
        // Save a refreshed login before checking quota: quota availability is not
        // permission to discard a newly rotated refresh token.
        const verified=await readProfile(folder,{refresh:true});if(verified.profile.id!==selected.id)throw Error('账号身份不匹配，已取消切换');
        saveProfile(value,verified.auth,verified.account);saveVault(value);
        await guard();if((fs.existsSync(authFile)?fs.readFileSync(authFile):null)?.toString()!==before?.toString())throw Error('登录状态已变化，请重试');
        const latestConfig=fs.existsSync(configFile)?fs.readFileSync(configFile,'utf8'):null;if(latestConfig!==config)throw Error('登录配置已变化，请重试');
        secure(codexHome);atomicJSON(authFile,verified.auth);
        const previousActive=metadata.activeId,previousRestart=metadata.restartRequired;
        try{atomicText(configFile,fileStoreConfig(config||''));metadata.activeId=selected.id;metadata.restartRequired=true;persist();committed=true;}
        catch(error){metadata.activeId=previousActive;metadata.restartRequired=previousRestart;if(before)atomicText(authFile,before);else fs.unlinkSync(authFile);if(config!=null)atomicText(configFile,config);else if(fs.existsSync(configFile))fs.unlinkSync(configFile);throw error;}
        job={status:'switched'};
      }finally{cleanup(folder);}
      if(committed&&params.open!==false){try{await openDesktop();metadata.restartRequired=false;persist();}catch{job={status:'switched',error:'账号已切换，请手动打开 Codex'};}}
      return state();
    },true,async()=>{if(!savedProfile(vault(),params.id))throw Error('找不到已授权账号');if(params.force===true)await prepareSwitch();});
  }
  return {state,command,close(){closed=true;client?.close();}};
}
function atomicText(file,text){const temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';try{fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}}
