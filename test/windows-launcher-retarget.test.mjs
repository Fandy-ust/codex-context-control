import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {retargetWindowsLaunchers} from '../src/platform/windows-launcher-retarget.mjs';

test('an inherited Windows launcher uses updated code on its next invocation',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-retarget-'));
  const make=(name,owner=home)=>{
    const folder=path.join(home,'bin',name);fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'codex-context.exe'),'fixture');
    const file=path.join(folder,'launcher.json');
    fs.writeFileSync(file,JSON.stringify({controlHome:owner,node:'old-node',codeRoot:'old-code'}));
    return file;
  };
  try{
    const old=make('aaaaaaaaaaaa-bbbbbbbbbbbb');
    const active=make('cccccccccccc-dddddddddddd');
    const foreign=make('eeeeeeeeeeee-ffffffffffff',path.join(home,'other'));
    const updated=retargetWindowsLaunchers({home,node:'new-node',codeRoot:path.join(home,'new-code'),activeShim:path.join(path.dirname(active),'codex-context.exe')});
    assert.equal(updated.length,1);
    assert.equal(JSON.parse(fs.readFileSync(old)).node,'new-node');
    assert.equal(JSON.parse(fs.readFileSync(old)).codeRoot,path.join(home,'new-code'));
    assert.equal(JSON.parse(fs.readFileSync(active)).node,'old-node');
    assert.equal(JSON.parse(fs.readFileSync(foreign)).node,'old-node');
    assert.equal(retargetWindowsLaunchers({home,node:'new-node',codeRoot:path.join(home,'new-code'),activeShim:path.join(path.dirname(active),'codex-context.exe')}).length,0);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
