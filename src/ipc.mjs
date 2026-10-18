import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {socketPath,ipcKey} from './paths.mjs';
import {authenticateClient} from './ipc-auth.mjs';

export class Peer {
  constructor(socket,handler=async()=>{throw new Error('Unknown operation');}) {
    this.socket=socket;this.pending=new Map();this.handler=handler;
    // Bound incomplete frames too: waiting for a newline must not grow memory forever.
    let chunks=[],bytes=0;
    socket.on('data',data=>{
      const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);let start=0;
      while(start<buffer.length){
        const newline=buffer.indexOf(10,start),end=newline<0?buffer.length:newline;
        const part=buffer.subarray(start,end);bytes+=part.length;
        if(bytes>1024*1024){chunks=[];socket.destroy();return;}
        if(part.length)chunks.push(part);
        if(newline<0)break;
        const line=Buffer.concat(chunks,bytes).toString('utf8');chunks=[];bytes=0;
        try{void this.receive(JSON.parse(line)).catch(()=>socket.destroy());}catch{socket.destroy();return;}
        if(socket.destroyed)return;
        start=newline+1;
      }
    });
    socket.on('error',()=>{});
    socket.on('close',()=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('连接已断开'));}this.pending.clear();});
    socket.resume();
  }
  send(message) {if(this.socket.destroyed)throw new Error('连接已断开');this.socket.write(JSON.stringify(message)+'\n');}
  async receive(message) {
    if(!message||typeof message!=='object'||Array.isArray(message)||
      (message.replyTo!=null?typeof message.replyTo!=='string':typeof message.id!=='string'||typeof message.op!=='string')){
      this.socket.destroy();return;
    }
    if(message.replyTo) {
      const item=this.pending.get(message.replyTo);if(!item)return;
      this.pending.delete(message.replyTo);clearTimeout(item.timer);
      message.error?item.reject(new Error(message.error)):item.resolve(message.result);return;
    }
    if(!message.id)return;
    try {this.send({replyTo:message.id,result:await this.handler(message.op,message.params||{})});}
    catch(error){try{this.send({replyTo:message.id,error:error.message});}catch{}}
  }
  call(op,params={},timeout=15000) {
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('操作超时'));},timeout);
      this.pending.set(id,{resolve,reject,timer});try{this.send({id,op,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  close(){this.socket.end();}
}
export async function connect(handler) {
  const key=ipcKey();
  const socket=net.createConnection(socketPath);
  try{await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});if(key)await authenticateClient(socket,key);}catch(error){socket.destroy();throw error;}
  return new Peer(socket,handler);
}
export async function request(op,params={},timeout=15000) {
  const peer=await connect();try{return await peer.call(op,params,timeout);}finally{peer.close();}
}
