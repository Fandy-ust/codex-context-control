import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readClipboardAttachments} from '../desktop/clipboard-attachments.mjs';

const item=values=>({types:Object.keys(values),getType:async type=>new Blob([values[type]],{type})});
test('Electron 44 ClipboardItem images are decoded and saved without readImage',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'queue-clipboard-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const png=Buffer.from('fixture-png'),nativeImage={createFromBuffer:bytes=>{assert.deepEqual(bytes,png);return {isEmpty:()=>false,toPNG:()=>png};}};
 const result=await readClipboardAttachments({directory,nativeImage,clipboard:{read:async()=>[item({'image/png':png})]}});
 assert.equal(result.attachments.length,1);assert.equal(result.attachments[0].kind,'image');assert.deepEqual(fs.readFileSync(result.attachments[0].path),png);
});
test('native copied files take priority over previews; text paths and remote URLs remain text',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'queue-file-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'photo with spaces.png');fs.writeFileSync(file,'photo');
 const clipboard={read:async()=>[item({'image/png':'preview','text/uri-list':`# copied files\r\n${pathToFileURL(file)}\r\nhttps://example.com/a.png\r\n${pathToFileURL(file)}`})]};
 const result=await readClipboardAttachments({directory,clipboard});assert.deepEqual(result.attachments,[{path:file,name:path.basename(file),kind:'image'}]);
 const text=await readClipboardAttachments({directory,clipboard:{read:async()=>[item({'text/plain':file})]}});assert.deepEqual(text.attachments,[]);
});
test('oversized clipboard images are rejected before decoding',async()=>{
 await assert.rejects(readClipboardAttachments({clipboard:{read:async()=>[{types:['image/png'],getType:async()=>({size:32*1024*1024+1})}]}}),/32 MB/);
});
