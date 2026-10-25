import crypto from 'node:crypto';
import path from 'node:path';
import {atomicJSON,readJSON} from './paths.mjs';
import {syncSecrets} from './sync-secrets.mjs';

// Only a small encryption key goes into DPAPI/Keychain, not an unbounded token pool.
export function accountVault(home,{keys=syncSecrets(home,{name:'account-vault-key'})}={}){
  const file=path.join(home,'account-vault.json'),aad=Buffer.from('context-manager-account-vault-v1');
  function key(create=false){let value=keys.get().key;if(!value&&create){value=crypto.randomBytes(32).toString('hex');keys.set({key:value});}if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('账号保险库密钥不可用');return Buffer.from(value,'hex');}
  return {get(){const saved=readJSON(file);if(!saved)return {version:1,profiles:{}};try{const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(saved.iv,'base64'));decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(saved.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.data,'base64')),decipher.final()]).toString());}catch{throw Error('无法解锁账号保险库，请检查系统凭据存储');}},
    set(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(true),iv);cipher.setAAD(aad);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);atomicJSON(file,{version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}};
}
