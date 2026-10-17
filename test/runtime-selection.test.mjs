import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectDesktopRuntime} from '../src/runtime-selection.mjs';

test('automatic registration uses the calling desktop bundle runtime and excludes unrelated callers',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-runtime-'));
  try{
    const app=path.join(temp,'Codex.app'),executable=path.join(app,'Contents/MacOS/Codex');
    const binary=path.join(app,'Contents/Resources/codex-cli/bin/codex');
    fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'fixture');
    assert.deepEqual(selectDesktopRuntime(executable,'/Applications/Unrelated.app/Contents/MacOS/Other','/another/runtime'),{binary,desktop:true});
    assert.deepEqual(selectDesktopRuntime('/opt/homebrew/bin/node',executable,'/another/runtime'),{binary:'/another/runtime',desktop:false});
    fs.unlinkSync(binary);
    assert.deepEqual(selectDesktopRuntime(executable,'/Applications/Unrelated.app/Contents/MacOS/Other','/another/runtime'),{binary:'/another/runtime',desktop:false});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
