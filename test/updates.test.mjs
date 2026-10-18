import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {manifestCandidate} from '../src/update-source.mjs';
import {createUpdateManager,releaseUpdate,newerVersion,releaseManifestURL,releaseAPI} from '../src/updates.mjs';import {downloadVerified,expectedChecksum,detachUpdateMount} from '../src/update-worker.mjs';
function release(version='0.17.0'){const tag='v'+version,filename=`Context-Manager-${version}-macos-arm64.dmg`;return {tag_name:tag,draft:false,prerelease:false,assets:[filename,filename+'.sha256'].map(name=>({name,state:'uploaded',size:4,browser_download_url:`https://github.com/Fandy-ust/codex-context-control/releases/download/${tag}/${name}`}))};}
function manifest(){return {schemaVersion:1,version:'0.17.0',tag:'v0.17.0',filename:'Context-Manager-0.17.0-macos-arm64.dmg',size:4,sha256:'a'.repeat(64)};}
test('updates accept only newer complete releases and assets from this repository',()=>{
 assert.equal(newerVersion('0.17.0','0.16.2'),true);assert.equal(newerVersion('0.9.9','0.16.2'),false);assert.equal(newerVersion('0.17.0-beta','0.16.2'),false);
 assert.equal(releaseUpdate(release(),'0.16.2').version,'0.17.0');assert.equal(releaseUpdate(release(),'0.17.0'),null);assert.equal(releaseUpdate({...release(),prerelease:true},'0.16.2'),null);
 const bad=release();bad.assets[0].browser_download_url='https://example.com/untrusted.dmg';assert.throws(()=>releaseUpdate(bad,'0.16.2'));assert.throws(()=>releaseUpdate({...release(),assets:[]},'0.16.2'));
});
test('automatic checks reuse cache and never launch an installation until explicitly requested',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-updates-'));let fetched=0,launched=0;
 try{const manager=createUpdateManager({home,current:'0.16.2',fetcher:async()=>{fetched++;return {ok:true,json:async()=>manifest()};},launch:()=>{launched++;return {pid:process.pid,unref(){}};}});
 const [first,second]=await Promise.all([manager.check(),manager.check(true)]);assert.equal(first.available,true);assert.deepEqual(first,second);await manager.check();assert.equal(fetched,1);assert.equal(launched,0);assert.equal(manager.status().available,true);
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
 try{const manager=createUpdateManager({home,current:'0.16.2',fetcher:async()=>({ok:true,json:async()=>manifest()}),launch:()=>{throw Error('launch failed');}});await manager.check();await assert.rejects(manager.install(),/launch failed/);assert.equal(manager.status().phase,'error');assert.equal(manager.status().available,true);}finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('busy installer volumes retry detach and retain files if still mounted',async()=>{
 let attempts=0;assert.equal(await detachUpdateMount('/mount',{run:async()=>{if(++attempts<3)throw Error('busy');},pause:async()=>{}}),true);assert.equal(attempts,3);
 assert.equal(await detachUpdateMount('/mount',{run:async()=>{throw Error('busy');},pause:async()=>{}}),false);
});

test('release-file checks need no API call and validate the manifest before use',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-feed-'));const calls=[];
 try{const manager=createUpdateManager({home,current:'0.16.2',fetcher:async url=>{calls.push(url);assert.equal(url,releaseManifestURL);return new Response(JSON.stringify(manifest()));}});const result=await manager.check();assert.equal(result.source,'release-file');assert.equal(result.available,true);assert.equal(calls.length,1);
 for(const change of [{schemaVersion:2},{tag:'v0.99.0'},{filename:'../bad.dmg'},{size:0},{sha256:'wrong'}])assert.throws(()=>manifestCandidate({...manifest(),...change}));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('older releases without a manifest use the legacy API as fallback',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-feed-fallback-'));const calls=[];
 try{const manager=createUpdateManager({home,current:'0.16.2',fetcher:async url=>{calls.push(url);return url===releaseManifestURL?new Response('{}',{status:404}):new Response(JSON.stringify(release()));}});const result=await manager.check();assert.equal(result.source,'github-api');assert.equal(result.available,true);assert.deepEqual(calls,[releaseManifestURL,releaseAPI]);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('API rate limits are explained, not hammered, and do not block recovery through the file',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-feed-limit-'));let time=1000000,ready=false;const calls=[];
 try{const manager=createUpdateManager({home,current:'0.16.2',now:()=>time,fetcher:async url=>{calls.push(url);if(url===releaseManifestURL)return ready?new Response(JSON.stringify(manifest())):new Response('{}',{status:404});return new Response(JSON.stringify({message:'API rate limit exceeded'}),{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String((time+3600000)/1000)}});}});
 let result=await manager.check(true);assert.match(result.error,/限流/);assert.equal(result.retryAt,time+60000);await manager.check(true);assert.equal(calls.length,2);
 time+=60001;ready=true;result=await manager.check(true);assert.equal(result.source,'release-file');assert.equal(result.error,null);assert.equal(calls.filter(x=>x===releaseAPI).length,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('a generic 403 is not misreported as rate limiting and manual checks have a cooldown',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-feed-forbidden-'));let calls=0;
 try{const manager=createUpdateManager({home,current:'0.16.2',fetcher:async()=>{calls++;return new Response('<html>Forbidden</html>',{status:403});}});const result=await manager.check(true);assert.match(result.error,/403/);assert.ok(!result.error.includes('限流'));await manager.check(true);assert.equal(calls,2);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('a manifest checksum mismatch stops installation before writing the image',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-feed-hash-')),update=manifestCandidate(manifest());
 try{await assert.rejects(downloadVerified(update,home,{fetcher:async()=>new Response('b'.repeat(64)+'  '+update.filename)}),/不一致/);assert.deepEqual(fs.readdirSync(home),[]);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
