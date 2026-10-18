import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('native fork names and archive state refresh without stale bridge titles or budget changes',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-names-')),home=path.join(temp,'codex'),root=path.join(temp,'control');
  fs.mkdirSync(home);fs.mkdirSync(root);process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  try{
    db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,title TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');
    const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)');
    for(const [id,name,archived] of [['parent','Context tools',0],['first','Context tools (2)',0],['second','Context tools (3)',0],['old','Archived fork',1]])insert.run(id,name,'PRIVATE_PROMPT_NOT_A_NAME','/tmp/project',1,archived);
    const policies={first:{window:382106,compact:326000,revision:1},old:{window:400000,revision:2}};
    const threads=Object.fromEntries(['parent','first','second','old'].map(id=>[id,{id,name:id==='second'?'Context tools (2)':'Context tools'}]));
    fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({version:2,threads,policies}));
    const {Store}=await import('../src/store.mjs');const store=new Store();await store.seedRecentMetadata();
    assert.equal(store.publicThread('first').name,'Context tools (2)');assert.equal(store.publicThread('second').name,'Context tools (3)');
    store.data.threads.first.name='Context tools';
    assert.equal(store.publicThread('first').name,'Context tools (2)','old bridge reports cannot replace the native name');
    assert.equal(store.publicThread('old').archived,true);
    db.prepare('UPDATE threads SET name=? WHERE id=?').run('Renamed branch','first');
    db.prepare('UPDATE threads SET archived=0 WHERE id=?').run('old');
    store.metadataCheckedAt=0;
    assert.equal(store.publicThread('first').name,'Renamed branch');assert.equal(store.publicThread('old').archived,false);
    db.prepare('UPDATE threads SET name=? WHERE id=?').run('PRIVATE_MULTILINE\nNOT_A_TITLE','second');
    store.refreshMetadata(true);assert.equal(store.publicThread('second').name,null);
    store.save();assert.deepEqual(store.data.policies,policies);
    assert.ok(!fs.readFileSync(path.join(root,'state.json'),'utf8').includes('PRIVATE_'));
    for(const version of [9,10]){
      const newer=new DatabaseSync(path.join(home,`state_${version}.sqlite`));
      try{newer.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,archived INTEGER)');newer.prepare('INSERT INTO threads VALUES(?,?,0)').run('first','Schema '+version);}finally{newer.close();}
    }
    store.refreshMetadata(true);assert.equal(store.publicThread('first').name,'Schema 10');

  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
