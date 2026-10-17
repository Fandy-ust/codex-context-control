import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {resolveLanguage,languagePreference,localize} from '../src/localization.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
test('automatic language uses time-zone identifiers and manual overrides take priority',()=>{
 for(const zone of ['Asia/Shanghai','Asia/Hong_Kong','Asia/Macau','Asia/Taipei','Asia/Urumqi','PRC','Hongkong','ROC'])assert.equal(resolveLanguage('auto',zone),'zh');
 for(const zone of ['America/New_York','Europe/London','Asia/Tokyo','Asia/Singapore','Australia/Perth','UTC','invalid'])assert.equal(resolveLanguage('auto',zone),'en');
 assert.equal(resolveLanguage('en','Asia/Shanghai'),'en');assert.equal(resolveLanguage('zh','America/New_York'),'zh');
});
test('local language preferences recover from missing, invalid, or partially written files',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-language-pref-'));
 try{assert.equal(languagePreference(home),'auto');for(const body of ['{broken',JSON.stringify({selection:'bad'})]){fs.writeFileSync(path.join(home,'language.json'),body);assert.equal(languagePreference(home),'auto');}fs.writeFileSync(path.join(home,'language.json'),JSON.stringify({selection:'en'}));assert.equal(languagePreference(home),'en');}
 finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('the shared catalog preserves placeholders, covers native literals and translates runtime status',()=>{
 const catalog=JSON.parse(fs.readFileSync(path.join(repo,'src/locales/en.json')));
 for(const [source,target] of Object.entries(catalog)){assert.ok(target.trim());assert.deepEqual([...source.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),[...target.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),source);}
 for(const dir of ['macos','packaging'])for(const name of fs.readdirSync(path.join(repo,dir)).filter(x=>x.endsWith('.swift')&&x!=='Localization.swift')){
  const text=fs.readFileSync(path.join(repo,dir,name),'utf8');for(const match of text.matchAll(/\bL\(("(?:[^"\\]|\\.)*")/g)){const source=JSON.parse(match[1]);assert.ok(catalog[source],`Missing translation in ${name}: ${source}`);}
 }
 assert.equal(localize('已生效 · 上限 920K',{selection:'en'}),'Active · 920K limit');
 assert.equal(localize('当前模型最多可用 920000 tokens',{selection:'en'}),'The current model supports up to 920000 usable tokens');
 assert.equal(localize('读取失败：测试',{selection:'en'}),'Unable to read: 测试');
 assert.equal(localize('用户自己的对话名称',{selection:'en'}),'用户自己的对话名称');
});
test('native preference persistence and mixed-language status switching preserve user arguments',{skip:process.platform!=='darwin',timeout:30000},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-language-native-')),source=path.join(temp,'Main.swift'),binary=path.join(temp,'check');
 try{
  fs.writeFileSync(source,`import Foundation
@main struct Test {static func main() throws {
 for zone in ["Asia/Hong_Kong","Asia/Shanghai","Asia/Macau","Asia/Taipei"]{precondition(Localization.resolve(.auto,timeZone:zone) == .zh)}
 for zone in ["Australia/Perth","Asia/Singapore","America/New_York","UTC"]{precondition(Localization.resolve(.auto,timeZone:zone) == .en)}
 if CommandLine.arguments.contains("--read"){precondition(Localization.choice == .en);precondition(L("应用")=="Apply");print("persisted");return}
 try Localization.setChoice(.en);precondition(L("应用")=="Apply")
 precondition(L("当前模型最多可用 {0} tokens",920000)=="The current model supports up to 920000 usable tokens")
 let message=L("读取失败：{0}","用户自己的输入");precondition(message=="Unable to read: 用户自己的输入")
 try Localization.setChoice(.zh);precondition(L("应用")=="应用");precondition(L(message)=="读取失败：用户自己的输入")
 try Localization.setChoice(.en);print("ok")
}}
`);
  let r=spawnSync('xcrun',['swiftc','-parse-as-library',path.join(repo,'macos/Localization.swift'),source,'-o',binary],{encoding:'utf8',timeout:25000});assert.equal(r.status,0,r.stderr);
  const env={...process.env,CONTEXT_CONTROL_HOME:path.join(temp,'home'),CONTEXT_CONTROL_LOCALIZATION_FILE:path.join(repo,'src/locales/en.json')};
  r=spawnSync(binary,[],{env,encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/ok/);
  r=spawnSync(binary,['--read'],{env,encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/persisted/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
