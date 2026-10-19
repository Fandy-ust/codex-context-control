import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import {removeInstallationTree} from '../src/platform/windows-install.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const at=process.argv.indexOf('--packaged'),packaged=at>=0?process.argv[at+1]:null;
const electron=packaged?path.resolve(packaged):path.join(repo,'node_modules/electron/dist',process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron');
if(!fs.existsSync(electron))throw Error('Run npm ci first');
const env={...process.env,CONTEXT_CONTROL_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
const smoke=process.argv.includes('--smoke-test'),temporary=smoke?fs.mkdtempSync(path.join(os.tmpdir(),'ctc-ui-smoke-')):null;
if(temporary)env.CONTEXT_CONTROL_HOME=temporary;
const launchArgs=process.argv.slice(2);if(at>=0)launchArgs.splice(at-2,2);
const languageAt=launchArgs.indexOf('--smoke-language');if(languageAt>=0){const language=launchArgs[languageAt+1];if(!temporary||!['zh','en'].includes(language))throw Error('Smoke language requires an isolated smoke test');fs.writeFileSync(path.join(temporary,'language.json'),JSON.stringify({selection:language}));launchArgs.splice(languageAt,2);}
const child=spawn(electron,[...(packaged?[]:[path.join(repo,'desktop/main.mjs')]),...launchArgs],{env,stdio:'inherit',windowsHide:true});child.on('exit',code=>{if(temporary)try{removeInstallationTree(os.tmpdir(),temporary);}catch{}process.exitCode=code??1;});child.on('error',e=>{console.error(e.message);process.exitCode=1;});
