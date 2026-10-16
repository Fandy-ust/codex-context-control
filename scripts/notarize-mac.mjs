// Run only after enrolling and configuring a local notarytool keychain profile.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url)),dir=path.join(repo,'build/distribution'),file=path.join(dir,'package-info.json'),info=JSON.parse(fs.readFileSync(file));
if(!info.developerIDSigned)throw Error('Build with CONTEXT_CONTROL_SIGN_IDENTITY set to a Developer ID Application certificate first.');
const profile=process.env.CONTEXT_CONTROL_NOTARY_PROFILE;if(!profile)throw Error('Set CONTEXT_CONTROL_NOTARY_PROFILE to your existing keychain profile name.');
function run(command,args,encoding){const r=spawnSync(command,args,{cwd:repo,encoding,stdio:encoding?'pipe':'inherit',timeout:1800000});if(r.error||r.status!==0)throw Error(command+' failed'+(r.stderr?'\n'+r.stderr:''));return r;}
const archive=path.join(repo,info.archive),app=path.join(dir,'Install Context Manager.app');
const submitted=run('xcrun',['notarytool','submit',archive,'--keychain-profile',profile,'--wait','--output-format','json'],'utf8');const result=JSON.parse(submitted.stdout);
if(result.status!=='Accepted')throw Error(`Notarization did not pass (${result.status}); inspect submission ${result.id}`);
run('xcrun',['stapler','staple',app]);run('xcrun',['stapler','validate',app]);run('/usr/bin/codesign',['--verify','--strict','--deep',app]);
fs.rmSync(archive);run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
const readme=path.join(dir,'README-FIRST.txt');if(fs.existsSync(readme)){fs.writeFileSync(readme,fs.readFileSync(readme,'utf8').replace(/当前包尚未 Apple 公证。[^\n]+/,'此包已使用 Developer ID 签名并通过 Apple 公证。首次打开时请按 macOS 的正常确认提示操作。'));}if(fs.existsSync(readme))run('/usr/bin/zip',['-q','-j',archive,readme]);
const sha=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');fs.writeFileSync(archive+'.sha256',sha+'  '+path.basename(archive)+'\n');
Object.assign(info,{notarized:true,notarizationId:result.id,archiveBytes:fs.statSync(archive).size});fs.writeFileSync(file,JSON.stringify(info,null,2)+'\n');console.log('Accepted, stapled and repackaged with updated checksum.');
