import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('native UI uses its bundle version to reject equal, older and malformed update offers',{skip:process.platform!=='darwin'},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-version-ui-'));
 try{
  const source=path.join(temp,'main.swift'),binary=path.join(temp,'test');fs.writeFileSync(source,'import Foundation\nfor candidate in ["0.24.3","0.24.2","0.24.3-preview.1","invalid"]{precondition(!newerProductVersion(candidate,than:"0.24.3"))}\nprecondition(newerProductVersion("0.25.0",than:"0.24.3"));precondition(newerProductVersion("0.24.10",than:"0.24.9"));precondition(!newerProductVersion("0.24.3",than:"—"))\n');
  const built=spawnSync('xcrun',['swiftc',fileURLToPath(new URL('../macos/ProductVersion.swift',import.meta.url)),source,'-o',binary],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
