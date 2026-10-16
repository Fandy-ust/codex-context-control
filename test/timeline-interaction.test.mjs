import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('chart hit mapping accepts the horizontal axis and clears outside positions without ChartProxy calls',{skip:process.platform!=='darwin',timeout:30000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-timeline-hit-'));
 try{
  const source=fs.readFileSync(path.join(repo,'macos/TimelineInteraction.swift'),'utf8');fs.writeFileSync(path.join(temp,'Mapping.swift'),source.split('struct TimelineBucketPresentation')[0]);
  fs.writeFileSync(path.join(temp,'main.swift'),`import Foundation\nlet m=TimelineHoverMapping(plot:CGRect(x:20,y:10,width:800,height:100),viewSize:CGSize(width:900,height:145),scaleStart:25,scaleEnd:815,upperBound:1000)\nprecondition(m.position(at:CGPoint(x:420,y:125))==500)\nprecondition(m.position(at:CGPoint(x:420,y:50))==500)\nprecondition(m.position(at:CGPoint(x:10,y:50))==nil)\nprecondition(m.position(at:CGPoint(x:830,y:50))==nil)\nprecondition(m.position(at:CGPoint(x:420,y:150))==nil)\nprecondition(m.x(for:500)==420)\nfor i in 0...1000{let x=m.x(for:Double(i));precondition(abs(m.position(at:CGPoint(x:x,y:130))!-Double(i))<0.00001)}\n`);
  const binary=path.join(temp,'test');let r=spawnSync('xcrun',['swiftc',path.join(temp,'Mapping.swift'),path.join(temp,'main.swift'),'-o',binary],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
