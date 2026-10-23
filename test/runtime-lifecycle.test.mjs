import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchRuntimeLifecycle} from '../src/runtime-lifecycle.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}){
 const child=new EventEmitter(),input=new EventEmitter(),output=new EventEmitter(),exitEvents=new EventEmitter(),signals=[];let ended=0,disconnected=0;
 Object.assign(child,{exitCode:null,signalCode:null,stdin:{end:()=>ended++},kill:signal=>signals.push(signal)});
 const watcher=watchRuntimeLifecycle({child,input,output,exitEvents,parentPid:123,parentAlive:()=>true,interval:10,grace:20,onDisconnect:()=>disconnected++,...options});
 return {child,input,output,exitEvents,signals,watcher,get ended(){return ended;},get disconnected(){return disconnected;}};
}
test('client EOF releases IPC and terminates a native runtime that ignores EOF',async()=>{
 const f=fixture();try{f.input.emit('end');f.input.emit('close');assert.equal(f.disconnected,1);assert.equal(f.ended,1);assert.deepEqual(f.signals,['SIGTERM']);await sleep(40);assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);}finally{f.watcher.close();}
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
