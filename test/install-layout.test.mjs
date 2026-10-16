import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {replaceDirectory} from '../src/install-layout.mjs';import {installBundledNode} from '../src/bundled-node.mjs';
test('a failed package copy preserves the existing installation and successful replacement removes stale files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-replace-')),target=path.join(root,'Application.app');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'old'),'existing');
 try{assert.throws(()=>replaceDirectory(target,stage=>{fs.writeFileSync(path.join(stage,'partial'),'bad');throw Error('copy failed');}));assert.equal(fs.readFileSync(path.join(target,'old'),'utf8'),'existing');assert.deepEqual(fs.readdirSync(root),['Application.app']);
 replaceDirectory(target,stage=>fs.writeFileSync(path.join(stage,'new'),'ready'));assert.equal(fs.readFileSync(path.join(target,'new'),'utf8'),'ready');assert.equal(fs.existsSync(path.join(target,'old')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('bundled runtime survives removal of the installer, is immutable and checks existing content',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-node-')),binary=path.join(root,'source-node'),license=path.join(root,'LICENSE');fs.writeFileSync(binary,'runtime fixture');fs.writeFileSync(license,'license fixture');
 try{const target=installBundledNode({home:path.join(root,'support'),executable:binary,license,version:'v22.23.3',arch:'arm64'});assert.equal(installBundledNode({home:path.join(root,'support'),executable:binary,license,version:'v22.23.3',arch:'arm64'}),target);fs.rmSync(binary);assert.equal(fs.readFileSync(target,'utf8'),'runtime fixture');fs.writeFileSync(binary,'runtime fixture');fs.writeFileSync(target,'corrupted');assert.throws(()=>installBundledNode({home:path.join(root,'support'),executable:binary,version:'v22.23.3',arch:'arm64'}),/checksum/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
