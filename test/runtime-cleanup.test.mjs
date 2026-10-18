import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {cleanupMacRuntimes as cleanupOldRuntimes} from '../src/runtime-cleanup.mjs';
const pin=JSON.parse(fs.readFileSync(new URL('../runtime-patches/manifest.json',import.meta.url)));
test('cleanup removes only unused installation-owned runtimes and preserves current, running and user files',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-cleanup-')),dir=path.join(home,'runtime');fs.mkdirSync(dir);
 try{
 const current=path.join(dir,'node-v22.23.3-arm64-aaaaaaaaaaaa'),old=path.join(dir,'node-v22.22.0-arm64-bbbbbbbbbbbb'),running=path.join(dir,'node-v22.21.0-arm64-cccccccccccc');
 for(const file of [current,old,running])fs.writeFileSync(file,'runtime');
 for(const v of ['v22.23.3','v22.22.0','v22.21.0'])fs.writeFileSync(path.join(dir,'Node-'+v+'-LICENSE.txt'),'license');
 fs.writeFileSync(path.join(dir,'my-node'),'personal');fs.writeFileSync(path.join(home,'state.json'),'budget');fs.writeFileSync(path.join(home,'thread-cache.json'),'cache');fs.mkdirSync(path.join(home,'backups'));
 const legacy=path.join(home,'runtimes',pin.id);fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'runtime.json'),JSON.stringify({id:pin.id}));fs.writeFileSync(path.join(legacy,'codex'),'old core');fs.writeFileSync(path.join(home,'runtime-fix.json'),JSON.stringify({enabled:false}));
 const options={home,currentNode:current,inUse:()=>false,activeExecutables:[running,path.join(legacy,'codex')]};
 let result=cleanupOldRuntimes(options);assert.ok(result.removed.includes(old));assert.ok(fs.existsSync(current)&&fs.existsSync(running)&&fs.existsSync(legacy));assert.ok(!fs.existsSync(path.join(dir,'Node-v22.22.0-LICENSE.txt')));
 result=cleanupOldRuntimes({...options,activeExecutables:[]});assert.ok(result.removed.includes(running)&&result.removed.includes(legacy));assert.ok(fs.existsSync(current));assert.ok(fs.existsSync(path.join(dir,'Node-v22.23.3-LICENSE.txt')));
 for(const file of ['state.json','thread-cache.json','backups','runtime/my-node'])assert.ok(fs.existsSync(path.join(home,file)));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('unknown process state and symlink directories prevent cleanup',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-cleanup-safe-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-outside-'));try{
 const current=path.join(home,'current');fs.writeFileSync(current,'current');const file=path.join(outside,'node-v22.22.0-arm64-bbbbbbbbbbbb');fs.writeFileSync(file,'keep');fs.symlinkSync(outside,path.join(home,'runtime'),process.platform==='win32'?'junction':'dir');
 cleanupOldRuntimes({home,currentNode:current,activeExecutables:[]});assert.ok(fs.existsSync(file));
 fs.unlinkSync(path.join(home,'runtime'));fs.mkdirSync(path.join(home,'runtime'));const local=path.join(home,'runtime',path.basename(file));fs.writeFileSync(local,'keep');cleanupOldRuntimes({home,currentNode:current,activeExecutables:null});assert.ok(fs.existsSync(local));
 }finally{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
