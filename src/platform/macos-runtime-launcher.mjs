import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJSON} from '../paths.mjs';

export function installMacRuntimeLauncher({source,shim,node,wrapper,original,home}){
  const info=fs.lstatSync(source);if(!info.isFile()||info.isSymbolicLink())throw Error('Missing native macOS runtime launcher; rebuild the application.');
  const magic=fs.readFileSync(source).subarray(0,4).toString('hex');if(!['cffaedfe','feedfacf','cafebabe','bebafeca'].includes(magic))throw Error('Invalid native macOS runtime launcher');
  fs.mkdirSync(path.dirname(shim),{recursive:true});
  const temporary=shim+'.'+randomUUID()+'.tmp';
  try{
    fs.copyFileSync(source,temporary);fs.chmodSync(temporary,0o700);
    atomicJSON(shim+'.json',{node,wrapper,original,home});
    fs.renameSync(temporary,shim);
  }finally{fs.rmSync(temporary,{force:true});}
  return shim;
}
