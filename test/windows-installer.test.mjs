import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {powershell} from '../src/platform/index.mjs';
import {removeInstallationTree} from '../src/platform/windows-install.mjs';
import {compileWindowsInstaller} from '../scripts/windows-installer.mjs';

test('self-contained Windows installer extracts without siblings, forwards options, rejects corruption and unsafe paths, and cleans failures',{
  skip:process.platform!=='win32',timeout:60000
},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-setup-测试-'));
  const payload=path.join(temp,'source'),extraction=path.join(temp,'temporary'),meta=path.join(temp,'child.json');
  const env={...process.env,TEMP:extraction,TMP:extraction,CTC_SETUP_TEST_META:meta};
  fs.mkdirSync(extraction);fs.mkdirSync(path.join(payload,'resources/app/vendor'),{recursive:true});
  const archive=path.join(temp,'payload.zip'),checksum=archive+'.sha256',setup=path.join(temp,'独立 安装器.exe');
  const run=(extra=[])=>spawnSync(setup,['--install','--no-auto-start','--no-open','--no-shortcut',...extra],{env,cwd:temp,encoding:'utf8',windowsHide:true,timeout:15000});
  const compile=()=>compileWindowsInstaller({output:setup,archive,checksum});
  try{
    // A tiny substitute child verifies invocation and failure cleanup without touching any user installation.
    const child=path.join(temp,'Child.cs');
    fs.writeFileSync(child,'using System;using System.IO;using System.Web.Script.Serialization;class Child{static int Main(string[] args){Console.OutputEncoding=new System.Text.UTF8Encoding(false);File.WriteAllText(Environment.GetEnvironmentVariable("CTC_SETUP_TEST_META"),new JavaScriptSerializer().Serialize(new {args=args,cwd=Environment.CurrentDirectory}));Console.WriteLine("中文输出");return 7;}}');
    const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const built=spawnSync(compiler,['/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+path.join(payload,'resources/app/vendor/node.exe'),child],{encoding:'utf8',windowsHide:true});
    assert.equal(built.status,0,built.stdout+built.stderr);
    fs.writeFileSync(path.join(payload,'payload-manifest.json'),'{}');
    powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:CTC_SOURCE,$env:CTC_ZIP)',{CTC_SOURCE:payload,CTC_ZIP:archive});
    fs.writeFileSync(checksum,crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
    compile();
    const invoked=run();assert.equal(invoked.status,7,invoked.stdout+invoked.stderr);assert.match(invoked.stdout,/中文输出/);
    const recorded=JSON.parse(fs.readFileSync(meta,'utf8'));
    assert.deepEqual(recorded.args.slice(1),['--payload',path.dirname(path.dirname(recorded.cwd)),'--no-auto-start','--no-open','--no-shortcut']);
    assert.equal(recorded.args[0],path.join(recorded.cwd,'scripts/install-win.mjs'));
    assert.ok(recorded.cwd.startsWith(extraction+path.sep));assert.deepEqual(fs.readdirSync(extraction),[]);
    fs.unlinkSync(meta);
    const invalid=run(['--unexpected']);assert.equal(invalid.status,1);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
    fs.writeFileSync(checksum,'0'.repeat(64));compile();
    const corrupt=run();assert.equal(corrupt.status,1);assert.match(corrupt.stderr,/checksum verification failed/);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
    const unsafe=path.join(temp,'unsafe.zip');
    powershell('Add-Type -AssemblyName System.IO.Compression;$file=[IO.File]::Create($env:CTC_ZIP);$zip=New-Object IO.Compression.ZipArchive($file,[IO.Compression.ZipArchiveMode]::Create);$entry=$zip.CreateEntry("../escape.txt");$writer=New-Object IO.StreamWriter($entry.Open());$writer.Write("outside");$writer.Dispose();$zip.Dispose();$file.Dispose()',{CTC_ZIP:unsafe});
    fs.copyFileSync(unsafe,archive);fs.writeFileSync(checksum,crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));compile();
    const escaped=run();assert.equal(escaped.status,1);assert.match(escaped.stderr,/unsafe path/);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
  }finally{removeInstallationTree(os.tmpdir(),temp);}
});
