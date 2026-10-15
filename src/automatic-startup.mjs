import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,readJSON,atomicJSON} from './paths.mjs';

const label='io.github.codex-context-control.environment';
const key='CODEX_CLI_PATH';
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const xml=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function launchctl(args,required=true){
  const result=spawnSync('/bin/launchctl',args,{encoding:'utf8',timeout:10000});
  if(required&&(result.error||result.status!==0))throw new Error(`自动接入设置失败：${result.error?.message||result.stderr.trim()||args[0]}`);
  return result;
}
export function guiEnvironment(name=key){return launchctl(['getenv',name]).stdout.replace(/\n$/,'');}
function restoreEnvironment(name,value){launchctl(value?['setenv',name,value]:['unsetenv',name]);}
function locations(options={}){
  const directory=options.directory||path.join(os.homedir(),'Library/LaunchAgents');
  const name=options.label||label;
  return {recordFile:options.recordFile||path.join(root,'automatic-startup.json'),plist:path.join(directory,name+'.plist'),label:name,key:options.key||key,domain:`gui/${process.getuid()}`};
}
export function automaticStartupStatus(options={}){
  const record=readJSON(locations(options).recordFile);
  if(!record)return {installed:false,environmentActive:false,loginJobLoaded:false};
  return {installed:fs.existsSync(record.plist),environmentActive:guiEnvironment(record.key)===record.value,
    loginJobLoaded:launchctl(['print',`${record.domain}/${record.label}`],false).status===0};
}
export function enableAutomaticStartup(shim,options={}){
  if(process.platform!=='darwin')throw new Error('自动桌面接入仅支持 macOS');
  const loc=locations(options);const previous=readJSON(loc.recordFile);
  const before=guiEnvironment(loc.key);
  if(before&&before!==shim)throw new Error(`${loc.key} 已有其他自定义设置；已保留原值，未启用自动接入。`);
  const oldPlist=fs.existsSync(loc.plist)?fs.readFileSync(loc.plist,'utf8'):null;
  if(oldPlist&&(!previous||digest(oldPlist)!==previous.plistHash))throw new Error('自动接入的登录项已被其他程序修改；已保留原文件。');
  const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xml(loc.label)}</string><key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string><string>${xml(loc.key)}</string><string>${xml(shim)}</string></array><key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string><key>ProcessType</key><string>Background</string></dict></plist>\n`;
  const loaded=launchctl(['print',`${loc.domain}/${loc.label}`],false).status===0;
  const record={version:1,...loc,value:shim,previousValue:previous?.previousValue??(before===shim?'':before),plistHash:digest(plist)};
  fs.mkdirSync(path.dirname(loc.plist),{recursive:true});
  try{
    if(loaded)launchctl(['bootout',`${loc.domain}/${loc.label}`]);
    fs.writeFileSync(loc.plist,plist,{mode:0o600});
    launchctl(['bootstrap',loc.domain,loc.plist]);
    // Apply synchronously as well: a RunAtLoad job is dispatched asynchronously.
    launchctl(['setenv',loc.key,shim]);
    if(guiEnvironment(loc.key)!==shim)throw new Error('自动接入环境未读回确认');
    atomicJSON(loc.recordFile,record);
  }catch(error){
    launchctl(['bootout',`${loc.domain}/${loc.label}`],false);
    if(oldPlist!=null)fs.writeFileSync(loc.plist,oldPlist);else fs.rmSync(loc.plist,{force:true});
    if(guiEnvironment(loc.key)===shim)restoreEnvironment(loc.key,before);
    if(loaded&&oldPlist!=null)launchctl(['bootstrap',loc.domain,loc.plist],false);
    throw error;
  }
  return automaticStartupStatus(options);
}
export function disableAutomaticStartup(options={}){
  const loc=locations(options);const record=readJSON(loc.recordFile);if(!record)return {removed:false};
  if(fs.existsSync(record.plist)&&digest(fs.readFileSync(record.plist,'utf8'))!==record.plistHash)throw new Error('自动接入的登录项已被修改；为保留你的设置，未自动删除。');
  launchctl(['bootout',`${record.domain}/${record.label}`],false);
  if(guiEnvironment(record.key)===record.value)restoreEnvironment(record.key,record.previousValue);
  fs.rmSync(record.plist,{force:true});fs.rmSync(loc.recordFile,{force:true});
  return {removed:true};
}
