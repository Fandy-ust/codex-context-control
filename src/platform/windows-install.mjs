import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function verifyWindowsPayload(directory,{version,arch=process.arch}={}){
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'payload-manifest.json'),'utf8'));
  if(manifest.platform!=='win32'||manifest.arch!==arch||version&&manifest.version!==version||!/^\d+\.\d+\.\d+$/.test(manifest.version)||!manifest.files||typeof manifest.files!=='object')throw Error('Windows package version or architecture does not match');
  const found=[];
  const visit=(dir,base='')=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=base?base+'/'+entry.name:entry.name;if(name==='payload-manifest.json')continue;if(entry.isSymbolicLink())throw Error('Package links are not allowed');if(entry.isDirectory())visit(path.join(dir,entry.name),name);else{found.push(name);if(!/^[a-f0-9]{64}$/.test(manifest.files[name]||'')||sha(path.join(dir,entry.name))!==manifest.files[name])throw Error('Package integrity check failed: '+name);}}};
  visit(directory);if(found.length!==Object.keys(manifest.files).length)throw Error('Package manifest is incomplete');
  for(const required of ['ContextManager.exe','resources/app/vendor/node.exe','resources/app/windows/native/codex-context.exe','resources/app/src/wrapper.mjs'])if(!found.includes(required))throw Error('Package component missing: '+required);
  return manifest;
}
export function removeInstallationTree(base,target){
  const root=path.resolve(base),resolved=path.resolve(target);
  if(resolved===root||!resolved.startsWith(root+path.sep))throw Error('Refusing to remove a path outside the installation');
  if(!fs.existsSync(resolved))return;
  // Never recurse through a reparse point, including an ancestor junction.
  let cursor=resolved;while(cursor!==root){if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Refusing to remove an installation link');cursor=path.dirname(cursor);}
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
