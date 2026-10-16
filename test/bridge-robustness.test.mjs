import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {Bridge} from '../src/bridge.mjs';
function fixture(){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=new PassThrough(),output=new PassThrough(),writes=[],responses=[];const bridge=new Bridge(child,input,output,async()=>({}),async()=>null,{contextCeiling:1});child.stdin.on('data',d=>writes.push(...d.toString().trim().split('\n')));output.on('data',d=>responses.push(...d.toString().trim().split('\n')));return {bridge,writes,responses,close(){bridge.frontLines.close();bridge.backLines.close();for(const s of [input,output,child.stdin,child.stdout])s.destroy();}};}
test('malformed RPC shapes and input items are forwarded for native validation without crashing the bridge',()=>{
 const f=fixture();try{for(const line of ['null','[]','42','"text"','bad json']){assert.doesNotThrow(()=>f.bridge.fromClient(line));assert.doesNotThrow(()=>f.bridge.fromServer(line));}
 Object.assign(f.bridge.record('chat'),{status:'idle',observedWindow:920000,lastUsage:{totalTokens:100}});
 for(const input of [null,{},[null],[{}],[{type:'text',text:42}]])assert.doesNotThrow(()=>f.bridge.fromClient(JSON.stringify({id:1,method:'turn/start',params:{threadId:'chat',input}})));
 assert.equal(f.writes.length,10);
 }finally{f.close();}
});
test('input flood during reload remains bounded and produces explicit backpressure',()=>{
 const f=fixture();try{const r=f.bridge.record('chat');r.locked=true;for(let i=0;i<2000;i++)f.bridge.fromClient(JSON.stringify({id:i+1,method:'turn/start',params:{threadId:'chat',input:[{type:'text',text:'test'}]}}));
 assert.equal(r.queue.length,128);assert.equal(f.responses.length,1872);assert.equal(f.writes.length,0);assert.ok(r.queueBytes<128*1024*1024);
 }finally{f.close();}
});
