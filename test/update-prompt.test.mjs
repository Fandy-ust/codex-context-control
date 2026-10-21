import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdatePrompt} from '../desktop/update-prompt.mjs';

function fixture(choice='skip'){
 const calls=[];let enabled=true;
 const controller=createUpdatePrompt({currentVersion:()=>'0.9.0',enabled:()=>enabled,setEnabled:value=>{enabled=value;calls.push('disable');},check:async()=>{calls.push('check');return {available:true,currentVersion:'0.9.0',version:'1.0.0',phase:'idle'};},install:async()=>{calls.push('install');return {phase:'downloading'};},prompt:async()=>{calls.push('prompt');return choice;}});
 return {controller,calls,enabled:()=>enabled};
}
test('skip only dismisses this prompt; the next startup checks again without installing',async()=>{
 const f=fixture();await f.controller.run(true);await f.controller.run(true);
 assert.deepEqual(f.calls,['check','prompt','check','prompt']);assert.equal(f.enabled(),true);
});
test('disable persists and suppresses automatic checks while manual checks remain available',async()=>{
 const f=fixture('disable');await f.controller.run(true);await f.controller.run(true);
 assert.deepEqual(f.calls,['check','prompt','disable']);assert.equal(f.enabled(),false);
 await f.controller.run();assert.deepEqual(f.calls,['check','prompt','disable','check','prompt','disable']);
});
test('installation requires explicit update choice and simultaneous checks share one prompt',async()=>{
 const f=fixture('install');await Promise.all([f.controller.run(true),f.controller.run()]);
 assert.deepEqual(f.calls,['check','prompt','install']);
});
test('no update, a running installer, and disabling during a check never prompt',async()=>{
 for(const update of [{available:false},{available:true,phase:'installing'},{available:true,phase:'downloading'}]){
  const c=createUpdatePrompt({currentVersion:()=>'0.9.0',enabled:()=>true,check:async()=>update,prompt:()=>assert.fail('Unexpected prompt')});await c.run(true);
 }
 let enabled=true;
 const c=createUpdatePrompt({currentVersion:()=>'0.9.0',enabled:()=>enabled,check:async()=>{enabled=false;return {available:true};},prompt:()=>assert.fail('Unexpected prompt')});await c.run(true);
});
test('failed checks can be retried',async()=>{
 let calls=0;const c=createUpdatePrompt({currentVersion:()=>'0.9.0',enabled:()=>true,check:async()=>{if(++calls===1)throw Error('offline');return {available:false};}});
 await assert.rejects(c.run(true),/offline/);await c.run(true);assert.equal(calls,2);
});


test('the desktop rejects stale available flags for equal, older and invalid versions',async()=>{
 for(const version of ['0.24.3','0.24.2','invalid']){
  let prompted=0,installed=0;
  const prompt=createUpdatePrompt({currentVersion:()=> '0.24.3',enabled:()=>true,setEnabled(){},check:async()=>({available:true,currentVersion:'0.24.1',version}),prompt:async()=>{prompted++;return 'install';},install:async()=>{installed++;}});
  await prompt.run(true);await prompt.run(false);assert.equal(prompted,0);assert.equal(installed,0);
 }
});
