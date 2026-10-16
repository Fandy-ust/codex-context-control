import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
// Build completely beside the destination before replacing it. Never leave a
// half-copied application or code directory after a copy/validation failure.
export function replaceDirectory(destination,prepare){
 const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true});
 const nonce=crypto.randomBytes(8).toString('hex'),stage=path.join(parent,`.ctc-stage-${nonce}${destination.endsWith('.app')?'.app':''}`),backup=path.join(parent,`.ctc-previous-${nonce}`);
 fs.mkdirSync(stage,{mode:0o700});let moved=false,installed=false;
 try{prepare(stage);if(fs.existsSync(destination)){fs.renameSync(destination,backup);moved=true;}fs.renameSync(stage,destination);installed=true;}
 catch(error){if(moved&&!fs.existsSync(destination))fs.renameSync(backup,destination);throw error;}
 finally{fs.rmSync(stage,{recursive:true,force:true});if(installed)fs.rmSync(backup,{recursive:true,force:true});}
}
