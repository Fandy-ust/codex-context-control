import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readForkParent} from '../src/fork-metadata.mjs';
import {Bridge} from '../src/bridge.mjs';

const id=n=>`11111111-1111-1111-1111-${String(n).padStart(12,'0')}`;
test('desktop forks missed by RPC inherit their actual parent, persist, and automatically queue application',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-native-fork-'));
  const home=path.join(temp,'codex'),root=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(root);
  process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  let bridge;
  try{
    db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,rollout_path TEXT)');
    for(const [n,parent] of [[1,null],[2,1],[3,2],[4,1],[5,6],[6,null],[7,1]]){
      const file=path.join(home,`${n}.jsonl`);
      fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:id(n),forked_from_id:parent?id(parent):null,thread_source:n===7?'agent':'user',history_base:{thread_id:id(99)},base_instructions:{text:'PRIVATE_HEADER_NOT_PERSISTED'}}})+'\n'+JSON.stringify({type:'response_item',payload:{text:'PRIVATE_BODY_NOT_READ'}})+'\n');
      db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)').run(id(n),`Chat ${n}`,temp,10-n,0,file);
    }
    const parentPolicy={window:757895,compact:646000,reserve:16000,retainedFloor:0,scope:'total',revision:2,enabled:true};
    const explicit={...parentPolicy,window:210527,compact:180000,revision:7,enabled:false};
    fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({version:2,threads:{},policies:{[id(1)]:parentPolicy,[id(4)]:explicit,[id(6)]:{...parentPolicy,enabled:false}}}));
    const {Store}=await import('../src/store.mjs');const store=new Store();await store.seedRecentMetadata();
    const child=store.publicThread(id(2));
    assert.equal(child.policy.window,757895);assert.equal(child.policy.compact,646000);
    assert.equal(child.policy.inheritedFrom,id(1));assert.equal(child.policy.inheritedFromRevision,2);
    assert.equal(store.data.policies[id(3)].inheritedFrom,id(2));
    assert.deepEqual(store.data.policies[id(4)],explicit);assert.equal(store.data.policies[id(5)],undefined);
    assert.equal(store.data.policies[id(7)],undefined,'managed agents do not inherit editable user-chat budgets');
    store.data.policies[id(1)]={...parentPolicy,window:500000,revision:3};store.refreshMetadata(true);
    assert.equal(store.data.policies[id(2)].window,757895,'fork snapshots do not follow later parent edits');
    assert.equal(new Store().data.policies[id(2)].window,757895);
    const persisted=fs.readFileSync(path.join(root,'state.json'),'utf8');assert.ok(!persisted.includes('PRIVATE_'));

    const backend=new EventEmitter();backend.stdin=new PassThrough();backend.stdout=new PassThrough();
    bridge=new Bridge(backend,new PassThrough(),new PassThrough(),async r=>({policy:store.data.policies[r.id],model:{slug:'fixture',effective_context_window_percent:95,max_context_window:872000}}));
    const record=bridge.record(id(2));Object.assign(record,{model:'fixture',status:'active',lastUsage:{totalTokens:250000},freshUsage:true,usageFresh:true});
    const applied=[];bridge.reload=async(r,policy,plan)=>{applied.push({policy,window:plan.expectedWindow});r.appliedRevision=policy.revision;return true;};
    bridge.notify(record);await new Promise(r=>setImmediate(r));
    assert.equal(record.policy.window,757895);assert.equal(applied.length,0);
    record.status='idle';bridge.schedule(record);await new Promise(r=>setImmediate(r));
    assert.equal(applied.length,1);assert.equal(applied[0].window,720000);assert.equal(applied[0].policy.compact,646000);
  }finally{
    if(bridge){bridge.frontLines.close();bridge.backLines.close();bridge.input.destroy();bridge.output.destroy();bridge.child.stdin.destroy();bridge.child.stdout.destroy();}
    db.close();fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('fork discovery bounds header reads, retries partial headers, and rejects outside/mismatched files',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-fork-header-')),cache=new Map();
  const file=path.join(home,'session.jsonl');
  const header=JSON.stringify({type:'session_meta',payload:{id:id(2),forked_from_id:id(1)}});
  try{
    fs.writeFileSync(file,header);assert.equal(readForkParent(home,id(2),file,cache),null);
    fs.appendFileSync(file,'\nNOT_JSON_BODY');assert.equal(readForkParent(home,id(2),file,cache),id(1));
    fs.appendFileSync(file,'more history');assert.equal(readForkParent(home,id(2),file,cache),id(1));
    assert.equal(readForkParent(home,id(3),file,cache),null);
    const replacement=path.join(home,'replacement');fs.writeFileSync(replacement,header.replace(id(1),id(4))+'\n');fs.renameSync(replacement,file);
    assert.equal(readForkParent(home,id(2),file,cache),id(4));
    assert.equal(readForkParent(path.join(home,'nested'),id(2),file,cache),null);
    fs.writeFileSync(file,'x'.repeat(1024*1024+1));assert.equal(readForkParent(home,id(3),file,cache),null);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
