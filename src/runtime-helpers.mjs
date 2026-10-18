import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function filesIn(directory,prefix=''){
  const out=[];
  for(const e of fs.readdirSync(path.join(directory,prefix),{withFileTypes:true})){
    const name=path.join(prefix,e.name);
    if(e.isDirectory())out.push(...filesIn(directory,name));
    else if(e.isFile())out.push(name);
    else throw Error('辅助文件包含未支持的链接');
  }
  return out;
}
export function installRuntimeHelpers(directory,original,baseVersion,{runVersion=spawnSync}={}){
  const probe=()=>runVersion(original,['--version'],{encoding:'utf8',timeout:5000});
  let version=probe();
  // Installation may hit a transient process-launch delay. Retry timeouts once,
  // never retry or reinterpret a successfully read, incompatible version.
  if(version.error?.code==='ETIMEDOUT')version=probe();
  if(version.error?.code==='ETIMEDOUT')throw Error('辅助程序版本检查超时，请稍后重试');
  if(version.error||version.status!==0)throw Error('无法读取辅助程序版本，请稍后重试');
  if(version.stdout?.trim()!==`codex-cli ${baseVersion}`)throw Error('辅助程序版本与修复包不匹配');
  const source=path.resolve(path.dirname(original),'..');
  if(!fs.existsSync(path.join(source,'codex-package.json')))throw Error('未找到桌面版 Codex 辅助程序目录');
  const layout=JSON.parse(fs.readFileSync(path.join(source,'codex-package.json'),'utf8'));
  if(layout.version!==baseVersion||layout.layoutVersion!==1||layout.entrypoint!=='bin/codex'||layout.resourcesDir!=='codex-resources'||layout.pathDir!=='codex-path')throw Error('桌面辅助程序的版本或布局不匹配');
  fs.mkdirSync(path.join(directory,'bin'),{recursive:true});
  fs.copyFileSync(path.join(source,'bin/codex-code-mode-host'),path.join(directory,'bin/codex-code-mode-host'));
  fs.chmodSync(path.join(directory,'bin/codex-code-mode-host'),0o755);
  fs.copyFileSync(path.join(source,'codex-package.json'),path.join(directory,'codex-package.json'));
  for(const name of ['codex-path','codex-resources'])fs.cpSync(path.join(source,name),path.join(directory,name),{recursive:true,dereference:true});
  const names=['bin/codex-code-mode-host','codex-package.json',...filesIn(directory,'codex-path'),...filesIn(directory,'codex-resources')];
  const manifest={baseVersion,files:Object.fromEntries(names.map(name=>[name,sha(path.join(directory,name))]))};
  fs.writeFileSync(path.join(directory,'helpers.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
export function runtimeHelpersFingerprint(directory){
  try{
    const text=fs.readFileSync(path.join(directory,'helpers.json'),'utf8'),m=JSON.parse(text);
    const paths=Object.keys(m.files??{});
    if(paths.some(p=>path.isAbsolute(p)||p.split(/[\\/]/).includes('..')))return 'invalid';
    return text+[...paths,'bin','codex-path','codex-resources'].map(p=>{try{const s=fs.lstatSync(path.join(directory,p));return `${p}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}catch{return p+':missing';}}).join('|');
  }catch{return 'missing';}
}
export function validateRuntimeHelpers(directory,baseVersion){
  const m=JSON.parse(fs.readFileSync(path.join(directory,'helpers.json'),'utf8'));
  if(m.baseVersion!==baseVersion||!m.files||!Object.hasOwn(m.files,'bin/codex-code-mode-host')||!Object.hasOwn(m.files,'codex-package.json')||!Object.hasOwn(m.files,'codex-path/rg'))throw Error('辅助程序记录不完整');
  if(!fs.statSync(path.join(directory,'codex-resources')).isDirectory())throw Error('辅助资源目录缺失');
  for(const [name,digest] of Object.entries(m.files)){
    if(path.isAbsolute(name)||name.split(/[\\/]/).includes('..')||!/^[a-f0-9]{64}$/.test(digest))throw Error('辅助程序记录无效');
    const file=path.join(directory,name),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||sha(file)!==digest)throw Error('辅助程序校验失败');
  }
  if(process.platform!=='win32')for(const name of ['bin/codex-code-mode-host','codex-path/rg'])if(!(fs.statSync(path.join(directory,name)).mode&0o111))throw Error('辅助程序不可执行');
  return m;
}

export function useDesktopRuntimeLayout(directory){
  fs.mkdirSync(path.join(directory,'bin'),{recursive:true});
  fs.renameSync(path.join(directory,'codex'),path.join(directory,'bin/codex'));
  const file=path.join(directory,'runtime.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  manifest.entrypoint='bin/codex';fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
}
