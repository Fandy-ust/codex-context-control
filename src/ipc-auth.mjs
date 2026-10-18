import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';

const nonce=()=>randomBytes(32).toString('hex');
const valid=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const proof=(key,role,a,b)=>createHmac('sha256',key).update(`${role}:${a}:${b}`).digest('hex');
function equal(a,b){return valid(a)&&valid(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function read(socket){return new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0);
  const done=(error,value)=>{clearTimeout(timer);socket.pause();socket.off('data',data);socket.off('error',fail);socket.off('close',close);error?reject(error):resolve(value);};
  const fail=error=>done(error),close=()=>fail(Error('IPC authentication closed'));
  const data=chunk=>{bytes=Buffer.concat([bytes,chunk]);const at=bytes.indexOf(10);if((at<0?bytes.length:at)>1024){fail(Error('IPC authentication frame too large'));return;}if(at>=0){if(bytes.length>at+1)socket.unshift(bytes.subarray(at+1));try{done(null,JSON.parse(bytes.subarray(0,at).toString()));}catch{fail(Error('Invalid IPC authentication'));}}};
  const timer=setTimeout(()=>fail(Error('IPC authentication timeout')),2000);
  socket.on('data',data);socket.once('error',fail);socket.once('close',close);socket.resume();
});}
const send=(socket,message)=>socket.write(JSON.stringify(message)+'\n');
export async function authenticateClient(socket,key){
  const a=nonce();send(socket,{hello:a});const response=await read(socket),b=response.nonce;
  if(!valid(b)||!equal(response.proof,proof(key,'server',a,b)))throw Error('IPC server identity could not be verified');
  send(socket,{proof:proof(key,'client',a,b)});if((await read(socket)).ready!==true)throw Error('IPC authentication failed');
}
export async function authenticateServer(socket,key){
  const a=(await read(socket)).hello,b=nonce();if(!valid(a))throw Error('Invalid IPC nonce');
  send(socket,{nonce:b,proof:proof(key,'server',a,b)});
  if(!equal((await read(socket)).proof,proof(key,'client',a,b)))throw Error('IPC client identity could not be verified');
  send(socket,{ready:true});
}
