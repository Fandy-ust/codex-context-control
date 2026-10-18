import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('native chart aggregation is bounded and preserves original records, gaps and reset boundaries',{skip:process.platform!=='darwin',timeout:90000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'timeline-data-'));
 try{
  const models=fs.readFileSync(path.join(repo,'macos/ContextDetails.swift'),'utf8').split('\n@MainActor')[0];fs.writeFileSync(path.join(temp,'Models.swift'),models);
  const binary=path.join(temp,'check');const build=spawnSync('xcrun',['swiftc','-O','-parse-as-library',path.join(repo,'macos/Localization.swift'),path.join(temp,'Models.swift'),path.join(repo,'macos/TimelineData.swift'),path.join(repo,'scripts/test-timeline-data.swift'),'-o',binary],{encoding:'utf8',timeout:60000});assert.equal(build.status,0,build.stderr);
  const result=spawnSync(binary,[],{encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
