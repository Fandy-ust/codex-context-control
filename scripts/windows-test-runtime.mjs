import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
// This fixture is only for installation tests, never real model/desktop validation.
export function createWindowsTestRuntime(directory){
 const source=path.join(directory,'FixtureCodex.cs'),binary=path.join(directory,'fixture-codex.exe');
 fs.writeFileSync(source,'using System; class FixtureCodex { public static int Main(string[] args) { if(args.Length>0 && args[0]=="--version") { Console.WriteLine("codex-cli 0.163.0"); return 0; } return 2; } }');
 const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const r=spawnSync(compiler,['/nologo','/target:exe','/out:'+binary,source],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stdout+r.stderr);return binary;
}
