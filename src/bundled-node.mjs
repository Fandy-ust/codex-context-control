import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function installBundledNode({home,executable=process.execPath,version=process.version,arch=process.arch,license}){
 if(!fs.statSync(executable).isFile())throw Error('Bundled Node runtime is missing');
 const digest=crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
 const directory=path.join(home,'runtime');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const target=path.join(directory,`node-${version}-${arch}-${digest.slice(0,12)}${process.platform==='win32'?'.exe':''}`);
 if(!fs.existsSync(target)){
  const stage=target+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
  try{fs.copyFileSync(executable,stage);if(crypto.createHash('sha256').update(fs.readFileSync(stage)).digest('hex')!==digest)throw Error('Copied Node checksum mismatch');fs.chmodSync(stage,0o700);fs.renameSync(stage,target);}finally{fs.rmSync(stage,{force:true});}
 }else if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==digest)throw Error('Installed Node runtime checksum mismatch');
 if(license)fs.copyFileSync(license,path.join(directory,`Node-${version}-LICENSE.txt`));
 return target;
}
