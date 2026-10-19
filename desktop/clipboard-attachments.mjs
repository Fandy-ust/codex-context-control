import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

// Electron 44 uses ClipboardItem/Blob rather than the removed readImage API.
export async function readClipboardAttachments({clipboard,nativeImage,directory}){
 const items=await clipboard.read(),attachments=[];
 for(const item of items){
  if(!item.types.includes('text/uri-list'))continue;
  const blob=await item.getType('text/uri-list');
  for(const line of (await blob.text()).split(/\r?\n/)){
   if(!line.trim()||line.startsWith('#'))continue;
   try{const url=new URL(line.trim());if(url.protocol!=='file:')continue;const file=fileURLToPath(url);if(!fs.statSync(file).isFile()||attachments.some(a=>a.path===file))continue;attachments.push({path:file,name:path.basename(file),kind:/\.(png|jpe?g|webp|gif|bmp)$/i.test(file)?'image':'file'});}catch{}
   if(attachments.length===20)return {attachments};
  }
 }
 // Native file references take precedence over their image preview representation.
 if(attachments.length)return {attachments};
 for(const item of items){
  const type=item.types.find(type=>/^image\/(png|jpeg|webp|gif|bmp|tiff)$/.test(type));if(!type)continue;
  const blob=await item.getType(type);if(blob.size>32*1024*1024)throw Error('图片过大，请插入小于 32 MB 的图片');
  const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));if(image.isEmpty())continue;
  const bytes=image.toPNG();if(bytes.length>32*1024*1024)throw Error('图片过大，请插入小于 32 MB 的图片');
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,randomUUID()+'.png');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  attachments.push({path:file,kind:'image',name:'Clipboard '+new Date().toISOString().slice(0,19).replace('T',' ')+'.png'});
  if(attachments.length===20)break;
 }
 return {attachments};
}
