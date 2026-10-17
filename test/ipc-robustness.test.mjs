import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import {once} from 'node:events';import {Peer} from '../src/ipc.mjs';

test('IPC contains malformed and oversized frames while other peers keep working',{timeout:15000},async()=>{
 const sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));new Peer(s,async(op,p)=>({op,text:p.text}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const connect=async()=>{const s=net.createConnection(server.address().port,'127.0.0.1');await once(s,'connect');return s;};
 try{
  const healthy=new Peer(await connect());
  for(const frame of ['null\n','[]\n','true\n','12\n','{}\n','{"id":1,"op":"ping"}\n','{invalid}\n', 'x'.repeat(1024*1024+1)]){
   const s=await connect();s.on('error',()=>{});const closed=new Promise(resolve=>s.once('close',resolve));s.write(frame);await closed;
   assert.equal((await healthy.call('ping',{text:'still alive'})).text,'still alive');
  }
  const s=await connect();let raw='';s.on('data',b=>raw+=b.toString());
  const body=Buffer.from(JSON.stringify({id:'split',op:'echo',params:{text:'中文🙂'}})+'\r\n');
  const split=body.indexOf(Buffer.from('中'))+1;s.write(body.subarray(0,split));s.write(body.subarray(split));
  while(!raw.includes('\n'))await new Promise(r=>setTimeout(r,5));assert.equal(JSON.parse(raw).result.text,'中文🙂');s.destroy();
  healthy.close();
 }finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
});
