import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {removeInstallationTree} from '../src/platform/windows-install.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const filename=`Context-Manager-${pkg.version}-windows-${process.arch}.zip`,archive=path.join(repo,'build',filename);
if(!fs.existsSync(archive))throw Error('Run npm run package:win:update first');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-update-')),home=path.join(temp,'control'),codex=path.join(temp,'codex'),apps=path.join(temp,'apps');fs.mkdirSync(home);fs.mkdirSync(codex);
Object.assign(process.env,{CONTEXT_CONTROL_HOME:home,CONTEXT_CONTROL_CODEX_HOME:codex,CONTEXT_CONTROL_APPLICATIONS:apps});
const {applyWindowsUpdate}=await import('../src/windows-update-worker.mjs');
const bytes=fs.readFileSync(archive),digest=crypto.createHash('sha256').update(bytes).digest('hex');
const base=`https://github.com/Fandy-ust/codex-context-control/releases/download/v${pkg.version}/`;
const update={version:pkg.version,filename,size:bytes.length,url:base+filename,checksumURL:base+filename+'.sha256'};
const fetcher=async url=>new Response(url.endsWith('.sha256')?digest+'  '+filename:bytes);
try{
  await applyWindowsUpdate(update,{fetcher,runInstaller:async payload=>{
    const result=spawnSync(process.execPath,[path.join(payload,'resources/app/scripts/install-win.mjs'),'--payload',payload,'--no-auto-start','--no-open','--no-shortcut'],{env:process.env,windowsHide:true,encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stdout+result.stderr);
  }});
  const settings=JSON.parse(fs.readFileSync(path.join(home,'settings.json'),'utf8'));assert.ok(fs.existsSync(settings.installedApp));assert.equal(settings.productVersion,pkg.version);assert.equal(fs.readdirSync(home).some(name=>name.startsWith('update-')),false);
  const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=255;
  await assert.rejects(applyWindowsUpdate(update,{fetcher:async url=>new Response(url.endsWith('.sha256')?digest+'  '+filename:corrupt)}),/校验失败/);
  assert.ok(fs.existsSync(settings.installedApp));assert.equal(fs.readdirSync(home).some(name=>name.startsWith('update-')),false);
  console.log('WINDOWS_UPDATE_TEST passed: local archive download, checksum, extraction, manifest, installation, cleanup and corruption rejection; no network requests');
}finally{removeInstallationTree(os.tmpdir(),temp);}
