import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {createUpdateManager,releaseUpdate,newerVersion} from '../src/updates.mjs';import {downloadVerified,expectedChecksum,detachUpdateMount} from '../src/update-worker.mjs';
function release(version='0.17.0'){const tag='v'+version,filename=`Context-Manager-${version}-macos-arm64.dmg`;return {tag_name:tag,draft:false,prerelease:false,assets:[filename,filename+'.sha256'].map(name=>({name,state:'uploaded',size:4,browser_download_url:`https://github.com/Fandy-ust/codex-context-control/releases/download/${tag}/${name}`}))};}
test('updates accept only newer complete releases and assets from this repository',()=>{
 assert.equal(newerVersion('0.17.0','0.16.2'),true);assert.equal(newerVersion('0.9.9','0.16.2'),false);assert.equal(newerVersion('0.17.0-beta','0.16.2'),false);
 assert.equal(releaseUpdate(release(),'0.16.2').version,'0.17.0');assert.equal(releaseUpdate(release(),'0.17.0'),null);assert.equal(releaseUpdate({...release(),prerelease:true},'0.16.2'),null);
 const bad=release();bad.assets[0].browser_download_url='https://example.com/untrusted.dmg';assert.throws(()=>releaseUpdate(bad,'0.16.2'));assert.throws(()=>releaseUpdate({...release(),assets:[]},'0.16.2'));
});
test('automatic checks reuse cache and never launch an installation until explicitly requested',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-updates-'));let fetched=0,launched=0;
 try{const manager=createUpdateManager({platform:"darwin",home,current:'0.16.2',fetcher:async()=>{fetched++;return {ok:true,json:async()=>release()};},launch:()=>{launched++;return {pid:process.pid,unref(){}};}});
 await manager.check();await manager.check();assert.equal(fetched,1);assert.equal(launched,0);assert.equal(manager.status().available,true);
 await manager.install();await manager.install();assert.equal(launched,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('downloads require matching byte size, checksum, and exact filename; corrupt data is removed',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-download-')),update=releaseUpdate(release(),'0.16.2'),bytes=Buffer.from('test'),digest=crypto.createHash('sha256').update(bytes).digest('hex');
 try{const fetcher=async url=>url.endsWith('.sha256')?new Response(digest+'  '+update.filename+'\n'):new Response(bytes);
 const target=await downloadVerified(update,home,{fetcher});assert.deepEqual(fs.readFileSync(target),bytes);fs.unlinkSync(target);
 await assert.rejects(downloadVerified(update,home,{fetcher:async url=>url.endsWith('.sha256')?new Response('0'.repeat(64)+'  '+update.filename):new Response(bytes)}),/校验失败/);assert.equal(fs.existsSync(target+'.partial'),false);
 assert.throws(()=>expectedChecksum(digest+'  wrong.dmg',update.filename));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('failed worker launch leaves a retryable error rather than a permanent updating state',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-update-failure-'));
 try{const manager=createUpdateManager({platform:"darwin",home,current:'0.16.2',fetcher:async()=>({ok:true,json:async()=>release()}),launch:()=>{throw Error('launch failed');}});await manager.check();await assert.rejects(manager.install(),/launch failed/);assert.equal(manager.status().phase,'error');assert.equal(manager.status().available,true);}finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('busy installer volumes retry detach and retain files if still mounted',async()=>{
 let attempts=0;assert.equal(await detachUpdateMount('/mount',{run:async()=>{if(++attempts<3)throw Error('busy');},pause:async()=>{}}),true);assert.equal(attempts,3);
 assert.equal(await detachUpdateMount('/mount',{run:async()=>{throw Error('busy');},pause:async()=>{}}),false);
});

test('Windows updates select matching architecture and never offer a Mac-only release',()=>{
 const options={platform:'win32',arch:'x64'};
 assert.equal(releaseUpdate(release(),'0.16.2',options),null);
 const windows=release();for(const asset of windows.assets){asset.name=asset.name.replace('macos-arm64.dmg','windows-x64.zip');asset.browser_download_url=asset.browser_download_url.replace('macos-arm64.dmg','windows-x64.zip');}
 assert.equal(releaseUpdate(windows,'0.16.2',options).filename,'Context-Manager-0.17.0-windows-x64.zip');
 assert.equal(releaseUpdate(windows,'0.16.2',{platform:'win32',arch:'arm64'}),null);
 const incomplete={...windows,assets:windows.assets.slice(0,1)};assert.throws(()=>releaseUpdate(incomplete,'0.16.2',options));
});
