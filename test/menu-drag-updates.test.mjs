import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('menu drag coalesces pointer bursts, preserves final values and cancels stale work',{skip:process.platform!=='darwin',timeout:30000},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-drag-'));
 try{
  const source=path.join(temp,'Probe.swift'),binary=path.join(temp,'probe');
  fs.writeFileSync(source,String.raw`
import Foundation
@main @MainActor struct Probe {
 static func main() async throws {
  var now=0.0,values:[Int]=[]
  let updates=MenuDragUpdates(clock:{now})
  for n in 0..<10000{updates.submit{values.append(n)}}
  precondition(values==[0])
  try await Task.sleep(for:.milliseconds(60))
  precondition(values==[0,9999])
  now=1;updates.submit{values.append(100)}
  now=1.001;updates.submit{values.append(101)}
  updates.finish{values.append(102)}
  precondition(values.last==102)
  try await Task.sleep(for:.milliseconds(60))
  precondition(!values.contains(101) && values.last==102)
  now=2;updates.submit{values.append(200)}
  now=2.001;updates.submit{values.append(201)};updates.cancel()
  try await Task.sleep(for:.milliseconds(60))
  precondition(values.last==200 && !values.contains(201))
  updates.reset();updates.submit{values.append(300)}
  precondition(values.last==300)
 }
}
`);
  const built=spawnSync('xcrun',['swiftc','-parse-as-library',fileURLToPath(new URL('../macos/MenuDragUpdates.swift',import.meta.url)),source,'-o',binary],{encoding:'utf8',timeout:20000});assert.equal(built.status,0,built.stderr);
  const ran=spawnSync(binary,[],{encoding:'utf8',timeout:5000});assert.equal(ran.status,0,ran.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
