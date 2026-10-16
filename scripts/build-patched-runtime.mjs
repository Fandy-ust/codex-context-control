// Build the pinned community fix from official source, then verify it offline.
// Requires Rust/rustup, Git, Node, and Apple's command-line build tools.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const pin=JSON.parse(fs.readFileSync(path.join(repo,'runtime-patches/manifest.json')));
const build=path.join(repo,'build/patched-runtime-build'),source=path.join(build,'source');
const output=path.join(repo,'build/patched-runtime');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('This package currently targets Apple Silicon macOS.');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const patch=path.join(repo,`runtime-patches/${pin.baseVersion}.patch`);
if(hash(patch)!==pin.patchSHA256)throw Error('Patch checksum mismatch');
const env={...process.env,CARGO_PROFILE_RELEASE_LTO:'false',CARGO_PROFILE_RELEASE_DEBUG:'0',CARGO_PROFILE_RELEASE_CODEGEN_UNITS:'16',CARGO_INCREMENTAL:'0',MACOSX_DEPLOYMENT_TARGET:'14.0'};
// Rust release builds are memory-heavy. Scale with the host without forcing
// small CI machines to swap; dedicated builders can explicitly override this.
const cpuCount=os.availableParallelism(),memoryGiB=os.totalmem()/1024**3;
const requestedJobs=process.env.CONTEXT_CONTROL_BUILD_JOBS;
if(requestedJobs!==undefined&&!/^[1-9]\d*$/.test(requestedJobs))throw Error('CONTEXT_CONTROL_BUILD_JOBS must be a positive integer');
const jobs=requestedJobs===undefined?Math.max(1,Math.min(cpuCount,Math.floor(memoryGiB/2))):Number(requestedJobs);
if(!Number.isSafeInteger(jobs))throw Error('CONTEXT_CONTROL_BUILD_JOBS is too large');
console.log(`Build resources: ${cpuCount} CPUs, ${memoryGiB.toFixed(1)} GiB RAM; ${jobs} parallel jobs`);
function run(cmd,args,cwd=repo,extraEnv={}){
  const r=spawnSync(cmd,args,{cwd,env:{...env,...extraEnv},stdio:'inherit'});
  if(r.error||r.status!==0)throw Error(`${cmd} failed (${r.status??r.error?.message})`);
}
fs.mkdirSync(build,{recursive:true});
if(!fs.existsSync(path.join(source,'.git'))){
  fs.mkdirSync(source,{recursive:true});run('git',['init'],source);
  run('git',['remote','add','origin',pin.sourceURL],source);
}
run('git',['fetch','--depth','1','origin',pin.sourceCommit],source);
run('git',['checkout','--detach','FETCH_HEAD'],source);
const actual=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).stdout.trim();
if(actual!==pin.sourceCommit)throw Error('Source revision mismatch');
// On retries the same patch may already be applied. Never silently use another diff.
const applied=spawnSync('git',['apply','--reverse','--check',patch],{cwd:source,stdio:'ignore'}).status===0;
if(!applied){run('git',['apply','--check',patch],source);run('git',['apply',patch],source);}
run('rustup',['toolchain','install',pin.toolchain,'--profile','minimal']);
run('cargo',[`+${pin.toolchain}`,'build','--release','--jobs',String(jobs),'--package','codex-cli','--bin','codex'],path.join(source,'codex-rs'));
fs.mkdirSync(output,{recursive:true});
const binary=path.join(output,'codex');
fs.copyFileSync(path.join(source,'codex-rs/target/release/codex'),binary);fs.chmodSync(binary,0o755);
run('/usr/bin/codesign',['--force','--sign','-',binary]);
run(binary,['--version']);
const manifest={...pin,platform:'darwin',arch:'arm64',binarySHA256:hash(binary),validated:false,builtAt:new Date().toISOString()};
const manifestFile=path.join(output,'runtime.json');
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
fs.copyFileSync(path.join(source,'LICENSE'),path.join(output,'CODEX-LICENSE'));
fs.copyFileSync(path.join(source,'NOTICE'),path.join(output,'CODEX-NOTICE'));
fs.copyFileSync(path.join(repo,'runtime-patches/LICENSE'),path.join(output,'PATCH-LICENSE'));
run(process.execPath,[path.join(repo,'scripts/probe-compaction-accounting.mjs')],repo,{CONTEXT_CONTROL_TEST_CODEX:binary,CONTEXT_CONTROL_EXPECT_FIXED:'1'});
run(process.execPath,['--test','test/integration.test.mjs'],repo,{CONTEXT_CONTROL_TEST_CODEX:binary});
const validation=JSON.parse(fs.readFileSync(path.join(repo,'build/compaction-accounting-probe.json')));
if(!validation.expectedFixed)throw Error('Patched behavior was not validated');
fs.copyFileSync(path.join(repo,'build/compaction-accounting-probe.json'),path.join(output,'validation.json'));
manifest.validated=true;fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log('Patched runtime built, signed and checked without remote inference.');
