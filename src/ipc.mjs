import net from 'node:net';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {socketPath} from './paths.mjs';

export class Peer {
  constructor(socket,handler=async()=>{throw new Error('Unknown operation');}) {
    this.socket=socket;this.pending=new Map();this.handler=handler;
    this.lines=readline.createInterface({input:socket,crlfDelay:Infinity});
    this.lines.on('line',line=>{if(line.length>1024*1024){socket.destroy();return;}try{this.receive(JSON.parse(line));}catch{socket.destroy();}});
    socket.on('error',()=>{});
    socket.on('close',()=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('连接已断开'));}this.pending.clear();});
  }
  send(message) {if(this.socket.destroyed)throw new Error('连接已断开');this.socket.write(JSON.stringify(message)+'\n');}
  async receive(message) {
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
  const socket=net.createConnection(socketPath);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  return new Peer(socket,handler);
}
export async function request(op,params={},timeout=15000) {
  const peer=await connect();try{return await peer.call(op,params,timeout);}finally{peer.close();}
}
