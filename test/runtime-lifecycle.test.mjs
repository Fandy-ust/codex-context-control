import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {watchRuntimeLifecycle} from '../src/runtime-lifecycle.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('real native process flushes a delayed startup response after client EOF',async()=>{
 const child=spawn(process.execPath,['-e',`process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>process.stdout.write('startup-policy-ok'),100));`],{stdio:['pipe','pipe','pipe']});
 const input=new PassThrough(),output=new PassThrough(),exitEvents=new EventEmitter();let response='';
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>response+=chunk);
 const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 const watcher=watchRuntimeLifecycle({child,input,output,exitEvents,parentPid:0,eofGrace:5000});
 try{input.resume();input.end();assert.deepEqual(await completed,{code:0,signal:null});assert.equal(response,'startup-policy-ok');}
 finally{watcher.close();if(child.exitCode==null&&child.signalCode==null)child.kill();input.destroy();output.destroy();}
});
function fixture(options={}){
 const child=new EventEmitter(),input=new EventEmitter(),output=new EventEmitter(),exitEvents=new EventEmitter(),signals=[];let ended=0,disconnected=0;
 Object.assign(child,{exitCode:null,signalCode:null,stdin:{end:()=>ended++},kill:signal=>signals.push(signal)});
 const watcher=watchRuntimeLifecycle({child,input,output,exitEvents,parentPid:123,parentAlive:()=>true,interval:10,grace:20,eofGrace:25,onDisconnect:()=>disconnected++,...options});
 return {child,input,output,exitEvents,signals,watcher,get ended(){return ended;},get disconnected(){return disconnected;}};
}
test('client EOF lets a native runtime finish its final response before cleanup',async()=>{
 const f=fixture();try{f.input.emit('end');f.input.emit('close');assert.equal(f.disconnected,0);assert.equal(f.ended,1);assert.deepEqual(f.signals,[]);f.child.exitCode=0;f.child.emit('exit',0);await sleep(50);assert.equal(f.disconnected,0);assert.deepEqual(f.signals,[]);}finally{f.watcher.close();}
});
test('client EOF eventually terminates a native runtime that ignores EOF',async()=>{
 const f=fixture();try{f.input.emit('end');f.input.emit('close');await sleep(35);assert.equal(f.disconnected,1);assert.equal(f.ended,2);assert.deepEqual(f.signals,['SIGTERM']);await sleep(30);assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);}finally{f.watcher.close();}
});
test('parent death cleans up while a healthy parent and idle runtime stay connected',async()=>{
 let live=true;const f=fixture({parentAlive:()=>live});try{await sleep(25);assert.equal(f.disconnected,0);live=false;await sleep(25);assert.equal(f.disconnected,1);assert.equal(f.signals[0],'SIGTERM');}finally{f.watcher.close();}
});
test('broken frontend output and abrupt wrapper exit both clean up the owned child',()=>{
 const f=fixture();f.output.emit('error',Error('EPIPE'));assert.equal(f.disconnected,1);f.exitEvents.emit('exit');assert.equal(f.signals.at(-1),'SIGKILL');f.watcher.close();
});
test('native child exit removes watchers and never kills an exited process',async()=>{
 const f=fixture();f.child.exitCode=0;f.child.emit('exit',0);f.input.emit('end');f.exitEvents.emit('exit');await sleep(30);assert.equal(f.disconnected,0);assert.deepEqual(f.signals,[]);assert.equal(f.exitEvents.listenerCount('exit'),0);
});

test('disconnect reasons distinguish output errors, parent death and EOF timeout',async()=>{
  for(const [reason,trigger]of [
    ['stdout-error',f=>f.output.emit('error',Error('EPIPE'))],
    ['stdout-closed',f=>f.output.emit('close')],
    ['stdin-error',f=>f.input.emit('error',Error('EPIPE'))],
    ['stdin-eof-timeout',f=>f.input.emit('end')],
  ]){
    const reasons=[],f=fixture({onDisconnect:value=>reasons.push(value)});
    try{trigger(f);await sleep(35);assert.deepEqual(reasons,[reason]);}finally{f.watcher.close();}
  }
  const reasons=[],f=fixture({parentAlive:()=>false,onDisconnect:value=>reasons.push(value)});
  try{await sleep(35);assert.deepEqual(reasons,['parent-exited']);}finally{f.watcher.close();}
});
