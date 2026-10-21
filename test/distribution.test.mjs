import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const archive=process.env.CONTEXT_CONTROL_TEST_INSTALLER_ZIP;
const installer=process.env.CONTEXT_CONTROL_TEST_INSTALLER_APP;
test('downloaded installer validates payload, installs with empty PATH, and survives deletion of the download',{skip:(!archive&&!installer)||process.platform!=='darwin'||process.arch!=='arm64',timeout:120000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-distribution-')),unpacked=path.join(temp,'download'),control=path.join(temp,'support'),home=path.join(temp,'codex');fs.mkdirSync(unpacked);fs.mkdirSync(home);
 const run=(cmd,args,env=process.env)=>spawnSync(cmd,args,{env,encoding:'utf8',timeout:60000});
 try{
  let r;
  if(installer)fs.cpSync(path.resolve(installer),path.join(unpacked,'Install Context Manager.app'),{recursive:true});
  else{r=run('/usr/bin/ditto',['-x','-k',path.resolve(archive),unpacked]);assert.equal(r.status,0,r.stderr);}
  const app=path.join(unpacked,'Install Context Manager.app'),resources=path.join(app,'Contents/Resources'),payload=path.join(resources,'payload');
  const manifest=JSON.parse(fs.readFileSync(path.join(resources,'payload-manifest.json')));assert.equal(manifest.arch,'arm64');assert.ok(!Object.keys(manifest.files).some(f=>f.startsWith('test/')||f.includes('auth.json')||f.includes('patched-runtime/codex')));
  r=run('/usr/bin/codesign',['--verify','--strict','--deep',app]);assert.equal(r.status,0,r.stderr);
  const panel=path.join(payload,'build/Codex Context Control.app');
  const readPlist=(bundle,key)=>{const result=run('/usr/libexec/PlistBuddy',['-c','Print :'+key,path.join(bundle,'Contents/Info.plist')]);assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  assert.equal(readPlist(panel,'CFBundleShortVersionString'),manifest.version);
  const panelIcon=readPlist(panel,'CFBundleIconFile'),installerIcon=readPlist(app,'CFBundleIconFile');
  assert.equal(installerIcon,panelIcon);
  assert.deepEqual(fs.readFileSync(path.join(resources,'localization-en.json')),fs.readFileSync(path.join(panel,'Contents/Resources/localization-en.json')));
  assert.ok(manifest.files['src/locales/en.json']);
  assert.ok(!manifest.files['node_modules/js-tiktoken/dist/index.js']);
  assert.ok(manifest.files['node_modules/js-tiktoken/dist/ranks/o200k_base.js']);
  r=run(path.join(payload,'vendor/node'),['--input-type=module','-e',`const {Bridge}=await import(${JSON.stringify('file://'+path.join(payload,'src/bridge.mjs'))}); const {Tiktoken}=await import(${JSON.stringify('file://'+path.join(payload,'node_modules/js-tiktoken/dist/lite.js'))}); const {default:ranks}=await import(${JSON.stringify('file://'+path.join(payload,'node_modules/js-tiktoken/dist/ranks/o200k_base.js'))}); if(new Tiktoken(ranks).encode('你好 world').length<1)process.exit(1);`]);assert.equal(r.status,0,r.stderr);
  assert.ok(manifest.files['THIRD_PARTY_NOTICES.md']);
  assert.ok(manifest.files['third-party-licenses/js-tiktoken.txt']);
  assert.deepEqual(fs.readFileSync(path.join(resources,installerIcon+'.icns')),fs.readFileSync(path.join(panel,'Contents/Resources',panelIcon+'.icns')));

  const original=path.join(temp,'Fixture Codex.app/Contents'),binary=path.join(original,'Resources/codex-cli/bin/codex');fs.mkdirSync(path.dirname(binary),{recursive:true});fs.mkdirSync(path.join(original,'MacOS'));
  fs.writeFileSync(binary,'#!/bin/sh\nprintf "codex-cli 0.160.0\\n"\n',{mode:0o700});fs.writeFileSync(path.join(original,'MacOS/Fixture'),'#!/bin/sh\nexit 0\n',{mode:0o700});fs.writeFileSync(path.join(original,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleIdentifier</key><string>io.github.context-manager.fixture</string></dict></plist>');
  const env={...process.env,PATH:path.join(temp,'empty-path'),CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_APPLICATIONS:path.join(temp,'Applications'),CONTEXT_CONTROL_REAL_CODEX:binary};fs.mkdirSync(env.PATH);
  const main=path.join(temp,'Main.swift'),verifier=path.join(temp,'verify');
  // Exercise the same native verifier/launcher, disabling only OS startup registration in this isolated test.
  const source=fs.readFileSync(path.join(repo,'packaging/Installer.swift'),'utf8').replace('["--use-built-panel","--bundled-node","--require-supported-runtime"]','["--use-built-panel","--bundled-node","--require-supported-runtime","--no-auto-start"]');fs.writeFileSync(path.join(temp,'Installer.swift'),source);
  fs.writeFileSync(main,'import Foundation\n@main struct Check {static func main(){do{_ = try InstallerModel.execute(resources:URL(fileURLWithPath:CommandLine.arguments[1]),uninstall:false)}catch{print(error.localizedDescription);exit(1)}}}\n');
  r=run('xcrun',['swiftc','-D','INSTALLER_TESTING','-parse-as-library',path.join(repo,'macos/Localization.swift'),path.join(temp,'Installer.swift'),main,'-o',verifier,'-framework','SwiftUI','-framework','AppKit','-framework','CryptoKit']);assert.equal(r.status,0,r.stderr);
  const rogue=path.join(payload,'src/extra-file.txt');fs.writeFileSync(rogue,'unexpected');r=run(verifier,[resources],env);assert.notEqual(r.status,0);assert.match(r.stdout,/额外文件/);assert.equal(fs.existsSync(path.join(control,'settings.json')),false);fs.rmSync(rogue);
  const changed=path.join(payload,'src/cli.mjs'),old=fs.readFileSync(changed);fs.appendFileSync(changed,'\n// tampered');r=run(verifier,[resources],env);assert.notEqual(r.status,0);assert.match(r.stdout,/校验失败/);assert.equal(fs.existsSync(path.join(control,'settings.json')),false);fs.writeFileSync(changed,old);
  r=run(verifier,[resources],env);assert.equal(r.status,0,r.stdout+r.stderr);
  const settings=JSON.parse(fs.readFileSync(path.join(control,'settings.json')));assert.ok(settings.node.startsWith(path.join(control,'runtime')));assert.ok(!settings.node.startsWith(unpacked));assert.ok(fs.existsSync(path.join(control,'runtime/Node-'+manifest.nodeVersion+'-LICENSE.txt')));
  fs.writeFileSync(path.join(control,'thread-cache.json'),JSON.stringify({version:1,entries:{cached:{summary:{lastUsage:{totalTokens:123}}}}}));
  const oldPackage=path.join(control,'code/package.json');const packageData=JSON.parse(fs.readFileSync(oldPackage));fs.writeFileSync(oldPackage,JSON.stringify({...packageData,version:'0.17.0'}));
  const oldSettings=JSON.parse(fs.readFileSync(path.join(control,'settings.json')));fs.writeFileSync(path.join(control,'settings.json'),JSON.stringify({...oldSettings,futurePreference:'preserved'}));
  const language='{"version":1,"choice":"en"}';fs.writeFileSync(path.join(control,'language.json'),language);
  const obsolete=path.join(control,'runtime/node-v22.0.0-arm64-111111111111');fs.writeFileSync(obsolete,'obsolete runtime');fs.writeFileSync(path.join(control,'runtime/Node-v22.0.0-LICENSE.txt'),'obsolete license');
  fs.writeFileSync(path.join(control,'compaction-compensation.json'),JSON.stringify({enabled:true,futureField:'keep'}));
  const retainedState={version:2,threads:{},policies:{saved:{window:400000,compact:360000,revision:3}}};fs.writeFileSync(path.join(control,'state.json'),JSON.stringify(retainedState));
  r=run(path.join(app,'Contents/MacOS/Installer'),['--install-update','--no-auto-start'],env);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(control,'state.json'))),retainedState);
  const compensation=JSON.parse(fs.readFileSync(path.join(control,'compaction-compensation.json')));assert.equal(compensation.enabled,false);assert.equal(compensation.futureField,'keep');
  assert.equal(JSON.parse(fs.readFileSync(path.join(control,'settings.json'))).futurePreference,'preserved');assert.equal(fs.readFileSync(path.join(control,'language.json'),'utf8'),language);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(control,'upgrade-backup/state.json'))),retainedState);
  assert.equal(fs.existsSync(obsolete),false);assert.equal(fs.existsSync(path.join(control,'runtime/Node-v22.0.0-LICENSE.txt')),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(control,'thread-cache.json'))).entries.cached.summary.lastUsage.totalTokens,123);
  fs.rmSync(unpacked,{recursive:true,force:true});
  r=run(settings.node,['-e','const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(":memory:"); db.close(); console.log(process.version)'],env);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),manifest.nodeVersion);
  r=run(path.join(control,'bin/codex-context'),['--version'],env);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/0.160.0/);
  const skillRoot=path.join(temp,'agent skills');
  r=run(path.join(control,'bin/context-manager'),['skill','install','--path',skillRoot],env);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).data.changed,true);assert.match(fs.readFileSync(path.join(skillRoot,'context-manager/SKILL.md'),'utf8'),/name: context-manager/);
  r=run(settings.node,[path.join(control,'code/scripts/install.mjs'),'--uninstall'],env);assert.equal(r.status,0,r.stderr);assert.equal(fs.existsSync(path.join(env.CONTEXT_CONTROL_APPLICATIONS,'Codex Context Control.app')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
