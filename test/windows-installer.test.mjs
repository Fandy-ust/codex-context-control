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
import {ensureLzma2Decoder,compressLzma2Zip} from '../scripts/windows-lzma2.mjs';

for(const format of ['zip','lzma2'])test(`${format} Windows installer preserves files, forwards options, rejects corruption and unsafe paths, and cleans failures`,{
  skip:process.platform!=='win32',timeout:60000
},async()=>{
  const decoder=format==='lzma2'?await ensureLzma2Decoder():null;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-setup-测试-'));
  const payload=path.join(temp,'source'),extraction=path.join(temp,'temporary'),meta=path.join(temp,'child.json');
  const env={...process.env,TEMP:extraction,TMP:extraction,CTC_SETUP_TEST_META:meta};
  fs.mkdirSync(extraction);fs.mkdirSync(path.join(payload,'resources/app/vendor'),{recursive:true});
  const archive=path.join(temp,'payload.zip'),checksum=archive+'.sha256',setup=path.join(temp,'独立 安装器.exe');
  const run=(extra=[])=>spawnSync(setup,['--install','--no-auto-start','--no-open','--no-shortcut',...extra],{env,cwd:temp,encoding:'utf8',windowsHide:true,timeout:15000});
  const embedded=format==='lzma2'?path.join(temp,'payload.7z'):archive;
  const compile=()=>{
    if(format==='lzma2')compressLzma2Zip(archive,embedded,decoder);
    // Keep explicitly invalid checksums invalid for both archive formats.
    if(fs.readFileSync(checksum,'utf8')!=='0'.repeat(64))fs.writeFileSync(checksum,crypto.createHash('sha256').update(fs.readFileSync(embedded)).digest('hex'));
    compileWindowsInstaller({output:setup,archive:embedded,checksum,format,decoder});
  };
  try{
    // A tiny substitute child verifies invocation and failure cleanup without touching any user installation.
    const child=path.join(temp,'Child.cs');
    fs.writeFileSync(child,'using System;using System.IO;using System.Web.Script.Serialization;using System.Security.Cryptography;class Child{static int Main(string[] args){Console.OutputEncoding=new System.Text.UTF8Encoding(false);string digest;using(var sha=SHA256.Create())digest=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Path.Combine(args[2],"资料","ui.bin")))).Replace("-", "").ToLowerInvariant();File.WriteAllText(Environment.GetEnvironmentVariable("CTC_SETUP_TEST_META"),new JavaScriptSerializer().Serialize(new {args=args,cwd=Environment.CurrentDirectory,digest=digest}));Console.WriteLine("中文输出");return 7;}}');
    const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const built=spawnSync(compiler,['/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+path.join(payload,'resources/app/vendor/node.exe'),child],{encoding:'utf8',windowsHide:true});
    assert.equal(built.status,0,built.stdout+built.stderr);
    fs.writeFileSync(path.join(payload,'payload-manifest.json'),'{}');
    const fixture=crypto.randomBytes(65537);
    fs.mkdirSync(path.join(payload,'资料'));fs.writeFileSync(path.join(payload,'资料/ui.bin'),fixture);
    powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:CTC_SOURCE,$env:CTC_ZIP)',{CTC_SOURCE:payload,CTC_ZIP:archive});
    fs.writeFileSync(checksum,crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
    compile();
    const invoked=run();assert.equal(invoked.status,7,invoked.stdout+invoked.stderr);assert.match(invoked.stdout,/中文输出/);
    const recorded=JSON.parse(fs.readFileSync(meta,'utf8'));
    assert.equal(recorded.digest,crypto.createHash('sha256').update(fixture).digest('hex'));
    const extractedCode=path.dirname(path.dirname(recorded.args[0]));
    assert.deepEqual(recorded.args.slice(1),['--payload',path.dirname(path.dirname(extractedCode)),'--no-auto-start','--no-open','--no-shortcut']);
    assert.equal(fs.realpathSync.native(recorded.cwd),fs.realpathSync.native(extraction));assert.ok([extraction,fs.realpathSync.native(extraction)].some(prefix=>extractedCode.toLowerCase().startsWith((prefix+path.sep).toLowerCase())));assert.deepEqual(fs.readdirSync(extraction),[]);
    fs.unlinkSync(meta);
    const invalid=run(['--unexpected']);assert.equal(invalid.status,1);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
    fs.writeFileSync(checksum,'0'.repeat(64));compile();
    const corrupt=run();assert.equal(corrupt.status,1);assert.match(corrupt.stderr,/checksum verification failed/);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
    const unsafe=path.join(temp,'unsafe.zip');
    powershell('Add-Type -AssemblyName System.IO.Compression;$file=[IO.File]::Create($env:CTC_ZIP);$zip=New-Object IO.Compression.ZipArchive($file,[IO.Compression.ZipArchiveMode]::Create);$entry=$zip.CreateEntry("../escape.txt");$writer=New-Object IO.StreamWriter($entry.Open());$writer.Write("outside");$writer.Dispose();$zip.Dispose();$file.Dispose()',{CTC_ZIP:unsafe});
    fs.copyFileSync(unsafe,archive);fs.writeFileSync(checksum,crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));compile();
    const escaped=run();assert.equal(escaped.status,1);assert.match(escaped.stderr,/unsafe path/);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
    if(format==='lzma2'){
      const executable=fs.readFileSync(setup),decoderBytes=fs.readFileSync(decoder),offset=executable.indexOf(decoderBytes);
      assert.notEqual(offset,-1,'decoder must be embedded in Setup');executable[offset+decoderBytes.length-1]^=1;fs.writeFileSync(setup,executable);
      const altered=run();assert.equal(altered.status,1);assert.match(altered.stderr,/decoder checksum verification failed/);assert.deepEqual(fs.readdirSync(extraction),[]);
      fs.writeFileSync(embedded,'invalid 7z with a valid outer checksum');
      fs.writeFileSync(checksum,crypto.createHash('sha256').update(fs.readFileSync(embedded)).digest('hex'));
      compileWindowsInstaller({output:setup,archive:embedded,checksum,format,decoder});
      const failed=run();assert.equal(failed.status,1);assert.match(failed.stderr,/decompression failed/);assert.equal(fs.existsSync(meta),false);assert.deepEqual(fs.readdirSync(extraction),[]);
      const tampered=path.join(temp,'tampered-decoder.exe');fs.copyFileSync(decoder,tampered);fs.appendFileSync(tampered,'tampered');
      assert.throws(()=>compileWindowsInstaller({output:setup,archive:embedded,checksum,format,decoder:tampered}),/decoder checksum mismatch/);
    }
  }finally{removeInstallationTree(os.tmpdir(),temp);}
});
