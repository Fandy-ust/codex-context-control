import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('legacy SQLite prompt titles are not imported and preview caches are migrated',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-privacy-'));const home=path.join(temp,'codex');const root=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(root);
  process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
  try{
    const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('fixture','PRIVATE_FIRST_PROMPT_DO_NOT_IMPORT','/tmp/project',1,0);db.close();
    fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({version:1,threads:{older:{id:'older',name:'OLD_IMPORTED_FIRST_PROMPT'}},policies:{older:{window:400000}}}));
    const {Store}=await import('../src/store.mjs');const store=new Store();await store.seedRecentMetadata();store.save();
    const data=fs.readFileSync(path.join(root,'state.json'),'utf8');assert.ok(!data.includes('PRIVATE_FIRST_PROMPT')&&!data.includes('OLD_IMPORTED_FIRST_PROMPT'));
    assert.equal(store.data.policies.older.window,400000);assert.equal(store.data.threads.fixture.name,null);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
