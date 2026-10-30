import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {durableWrite} from './durable-files.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const safe=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
export function storeBlocks(directory,bytes){
 const chunks=[];for(let at=0;at<bytes.length;at+=65536){const block=bytes.subarray(at,at+65536),id=hash(block),file=path.join(directory,id+'.gz');chunks.push(id);let valid=false;try{valid=hash(gunzipSync(fs.readFileSync(file)))===id;}catch{}if(!valid)durableWrite(file,gzipSync(block));}
 return {sha256:hash(bytes),size:bytes.length,chunks};
}
export function loadBlocks(directory,entry){
 if(!entry||!Array.isArray(entry.chunks)||!entry.chunks.every(safe))throw Error('Invalid snapshot index');
 const bytes=Buffer.concat(entry.chunks.map(id=>{const b=gunzipSync(fs.readFileSync(path.join(directory,id+'.gz')),{maxOutputLength:65536});if(hash(b)!==id)throw Error('Damaged backup block');return b;}));
 if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)throw Error('Snapshot checksum mismatch');return bytes;
}
export function treeBytes(dir){let size=0;try{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())size+=treeBytes(file);else if(e.isFile())size+=fs.statSync(file).size;}}catch{}return size;}
export function collectBlocks(directory,generations){const used=new Set();for(const dir of generations)try{const doc=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));for(const entry of Object.values(doc.files))for(const id of entry.chunks??[])used.add(id);}catch{}try{for(const file of fs.readdirSync(directory))if(/^[a-f0-9]{64}\.gz$/.test(file)&&!used.has(file.slice(0,-3)))fs.unlinkSync(path.join(directory,file));}catch{}}
