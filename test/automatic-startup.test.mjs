import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {enableAutomaticStartup,disableAutomaticStartup,guiEnvironment} from '../src/automatic-startup.mjs';

test('ordinary macOS application launch inherits automatic registration; reinstall and removal are reversible',{skip:process.platform!=='darwin',timeout:60000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-auto-'));
  const suffix=randomUUID().replaceAll('-','');const key='CONTEXT_CONTROL_PROBE_'+suffix.toUpperCase();
  const options={key,label:'io.github.codex-context-control.probe.'+suffix,directory:path.join(temp,'LaunchAgents'),recordFile:path.join(temp,'startup.json')};
  const productionBefore=guiEnvironment();
  const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr||r.error?.message);return r;};
  const app=path.join(temp,'Startup Probe.app'),contents=path.join(app,'Contents'),output=path.join(temp,'report.json');
  const bundle='io.github.codex-context-control.probe-app.'+suffix;
  try{
    const state=enableAutomaticStartup('/tmp/context-control-probe',options);
    assert.equal(state.environmentActive,true);assert.equal(state.loginJobLoaded,true);
    enableAutomaticStartup('/tmp/context-control-probe',options);
    fs.mkdirSync(path.join(contents,'MacOS'),{recursive:true});
    fs.writeFileSync(path.join(contents,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleExecutable</key><string>Probe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
    const source=path.join(temp,'Probe.swift');
    fs.writeFileSync(source,`import AppKit\nlet app=NSApplication.shared\nlet args=CommandLine.arguments\nlet result:[String:Any]=["value":ProcessInfo.processInfo.environment[args[2]] ?? "", "bundle":Bundle.main.bundleIdentifier ?? "", "parent":getppid()]\ntry JSONSerialization.data(withJSONObject:result).write(to:URL(fileURLWithPath:args[1]))\n`);
    run('/usr/bin/xcrun',['swiftc',source,'-o',path.join(contents,'MacOS/Probe'),'-framework','AppKit']);
    // No --env and no direct executable spawn: use the same Launch Services path as normal app opening.
    run('/usr/bin/open',['-g','-a',app,'--args',output,key]);
    for(let n=0;n<200&&!fs.existsSync(output);n++)await new Promise(r=>setTimeout(r,50));
    const report=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(report.value,'/tmp/context-control-probe');assert.equal(report.bundle,bundle);assert.equal(report.parent,1);
    disableAutomaticStartup(options);assert.equal(guiEnvironment(key),'');assert.ok(!fs.existsSync(options.recordFile));
    run('/bin/launchctl',['setenv',key,'external-value']);
    assert.throws(()=>enableAutomaticStartup('/tmp/context-control-probe',options),/其他自定义设置/);
    assert.equal(guiEnvironment(key),'external-value');run('/bin/launchctl',['unsetenv',key]);
    enableAutomaticStartup('/tmp/context-control-probe',options);
    run('/bin/launchctl',['setenv',key,'later-external-edit']);
    disableAutomaticStartup(options);assert.equal(guiEnvironment(key),'later-external-edit');
    assert.equal(guiEnvironment(),productionBefore);
  }finally{
    try{disableAutomaticStartup(options);}catch{}
    spawnSync('/bin/launchctl',['unsetenv',key]);fs.rmSync(temp,{recursive:true,force:true});
  }
});
