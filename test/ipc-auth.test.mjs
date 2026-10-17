import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {authenticateClient,authenticateServer} from '../src/ipc-auth.mjs';
import {Peer} from '../src/ipc.mjs';
test('local authentication rejects wrong keys and fake servers without revealing the key',{timeout:10000},async()=>{
  const key='a'.repeat(64),sockets=new Set();let handled=0;
  const server=net.createServer(async socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));try{await authenticateServer(socket,key);new Peer(socket,async()=>{handled++;return {alive:true};});}catch{socket.destroy();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const connect=async()=>{const s=net.createConnection(server.address().port,'127.0.0.1');s.on('error',()=>{});await once(s,'connect');return s;};
  try{
    const bad=await connect();await assert.rejects(authenticateClient(bad,'b'.repeat(64)),/identity/);bad.destroy();assert.equal(handled,0);
    const s=await connect();await authenticateClient(s,key);const peer=new Peer(s);assert.deepEqual(await peer.call('ping'),{alive:true});assert.equal(handled,1);peer.close();
    const malformed=await connect();const closed=once(malformed,'close');malformed.write('x'.repeat(1025));await closed;assert.equal(handled,1);
  }finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
});
