import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {powershell} from '../src/platform/index.mjs';

// Public-domain reduced 7-Zip from the LZMA SDK. Pin both release and bytes.
export const decoderVersion='26.05';
export const decoderSHA256='9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7';
const repo=fileURLToPath(new URL('../',import.meta.url));
export function verifyLzma2Decoder(file){
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==decoderSHA256)throw Error('LZMA2 decoder checksum mismatch');
  return file;
}
export async function ensureLzma2Decoder(){
  const file=process.env.CONTEXT_CONTROL_7ZR||path.join(repo,'build/tools',`7zr-${decoderVersion}.exe`);
  if(fs.existsSync(file))return verifyLzma2Decoder(file);
  if(process.env.CONTEXT_CONTROL_7ZR)throw Error('Configured LZMA2 decoder is missing');
  const response=await fetch(`https://github.com/ip7z/7zip/releases/download/${decoderVersion}/7zr.exe`,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Unable to download the pinned LZMA2 decoder: '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==decoderSHA256)throw Error('LZMA2 decoder checksum mismatch');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
  return file;
}

// Wrap a stored ZIP in LZMA2. Only ZIP decides output paths at install time;
// 7zr writes stdout, never archive-selected paths. OTA stays standard ZIP.
export function compressLzma2Zip(zip,destination,decoder){
  verifyLzma2Decoder(decoder);
  zip=path.resolve(zip);destination=path.resolve(destination);
  if(fs.statSync(zip).size>2*1024*1024*1024)throw Error('Installer ZIP exceeds the decoder 2 GiB size limit');
  const temporary=destination+'.'+crypto.randomUUID()+'.7z';
  try{
    const result=spawnSync(decoder,['a','-t7z','-m0=LZMA2','-mx=9','-md=64m','-mmt=2','-y',temporary,path.basename(zip)],{cwd:path.dirname(zip),encoding:'utf8',windowsHide:true,timeout:600000});
    if(result.error||result.status!==0)throw Error(result.error?.message||result.stdout+result.stderr);
    fs.renameSync(temporary,destination);
  }finally{fs.rmSync(temporary,{force:true});}
}
export async function createWindowsLzma2(source,destination){
  source=path.resolve(source);destination=path.resolve(destination);
  const relative=path.relative(source,destination);
  if(!relative||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)))throw Error('Archive must be outside its source directory');
  const decoder=await ensureLzma2Decoder();
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const staging=fs.mkdtempSync(path.join(path.dirname(destination),'lzma2-build-'));
  const zip=path.join(staging,'payload.zip');
  try{
    powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:CTC_SOURCE,$env:CTC_ZIP,[IO.Compression.CompressionLevel]::NoCompression,$false)',{CTC_SOURCE:source,CTC_ZIP:zip},{timeout:180000});
    compressLzma2Zip(zip,destination,decoder);
  }finally{fs.rmSync(zip,{force:true});fs.rmdirSync(staging);}
  console.log(JSON.stringify({archive:path.basename(destination),compressor:'lzma2',bytes:fs.statSync(destination).size}));
  return decoder;
}
