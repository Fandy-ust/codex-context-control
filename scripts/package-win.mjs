import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createWindowsZip} from './windows-zip.mjs';
import {createWindowsLzma2} from './windows-lzma2.mjs';
import {verifyWindowsPayload} from '../src/platform/windows-install.mjs';
import {compileWindowsInstaller} from './windows-installer.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const name=`Context-Manager-${pkg.version}-windows-${process.arch}`,folder=path.join(repo,'build',name),zip=folder+'.zip';
if(!fs.existsSync(path.join(folder,'payload/payload-manifest.json')))throw Error('Run npm run build:win or npm run build:win:dir first');
verifyWindowsPayload(path.join(folder,'payload'),{version:pkg.version});
const updateOnly=process.argv.includes('--update-only');
if(!updateOnly){
const setupName=process.env.CONTEXT_CONTROL_SETUP_NAME||name+'-Setup.exe';
if(path.basename(setupName)!==setupName||!setupName.endsWith('.exe'))throw Error('Setup output must be an .exe filename');
const native=path.join(repo,'build/windows-native'),embedded=path.join(native,name+'-payload.7z'),setup=path.join(repo,'build',setupName);
const decoder=await createWindowsLzma2(path.join(folder,'payload'),embedded);
fs.writeFileSync(embedded+'.sha256',crypto.createHash('sha256').update(fs.readFileSync(embedded)).digest('hex')+'\n');
compileWindowsInstaller({output:setup,icon:path.join(native,'ContextManager.ico'),archive:embedded,checksum:embedded+'.sha256',format:'lzma2',decoder});
console.log(setup);
}
if(updateOnly||process.argv.includes('--with-update-zip')){
createWindowsZip(folder,zip);
fs.writeFileSync(zip+'.sha256',crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')+'  '+path.basename(zip)+'\n');console.log(zip);
}
