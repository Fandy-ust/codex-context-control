import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// A release gate over behavioral tests, not a substitute for a signed-in
// browser/peer-authorization test. It never attaches to the user's runtime.
const repo=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(repo,'build/runtime-release');fs.mkdirSync(output,{recursive:true});
const version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'))).version;
const groups=[
 ['launch',process.platform==='darwin'?['mac-runtime-launcher']:process.platform==='win32'?['windows-launcher','windows-launcher-retarget']:[]],
 ['lifecycle',['runtime-lifecycle','runtime-lifecycle-process']],
 ['passive-observation',['passive-quota','passive-quota-http','runtime-compatibility','compatibility']],
 ['budget-and-handoff',['compaction-compensation','context-operations','context-schedule-quota','context-schedules']],
 ['bounded-local-work',['statistics-performance','statistics-projection','hot-chats']]
];
const report={schemaVersion:1,version,commit:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout?.trim()??null,platform:process.platform,arch:process.arch,startedAt:new Date().toISOString(),groups:[],artifact:null,liveBrowser:{status:'not_run',requiredBeforeRelease:true,reason:'Hosted CI has no signed-in desktop/Chrome connection. A fixture or unsigned preview cannot prove OpenAI peer acceptance.'},resourceBenchmarks:{status:'not_run',reason:'Functional contracts do not measure idle CPU/RSS, network bytes or production history latency. Follow docs/RUNTIME-VALIDATION.md.'}};
async function group(name,names){
 const started=performance.now(),log=path.join(output,name+'.tap');
 if(!names.length)return {name,status:'failed',reason:'unsupported_platform',durationMs:0};
 const stream=fs.createWriteStream(log);let tail='',spawnError=null,timedOut=false;
 const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...names.map(n=>'test/'+n+'.test.mjs')],{cwd:repo,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const source of [child.stdout,child.stderr])source.on('data',data=>{stream.write(data);tail=(tail+data.toString()).slice(-16000);});
 const timer=setTimeout(()=>{timedOut=true;child.kill();},120000);child.once('error',e=>spawnError=e.message);
 const code=await new Promise(resolve=>child.once('close',resolve));clearTimeout(timer);await new Promise(resolve=>stream.end(resolve));
 const number=key=>{const m=tail.match(new RegExp('^# '+key+' (\\d+)\\s*$','m'));return m?Number(m[1]):null;};
 const tests=number('tests'),passed=number('pass'),failed=number('fail'),skipped=number('skipped'),cancelled=number('cancelled');
 return {name,status:code===0&&tests>0&&passed===tests&&failed===0&&skipped===0&&cancelled===0?'passed':'failed',tests,passed,failed,skipped,cancelled,exitCode:code,timedOut,spawnError,durationMs:Math.round(performance.now()-started),log:path.relative(repo,log).split(path.sep).join('/')};
}
for(const [name,names]of groups){const result=await group(name,names);report.groups.push(result);console.log(`${name}: ${result.status} (${result.passed??0}/${result.tests??0}; skipped ${result.skipped??'unknown'})`);}
try{
 const file=process.platform==='darwin'?path.join(repo,'build/Codex Context Control.app/Contents/MacOS/ContextControl'):path.join(repo,`build/Context-Manager-${version}-windows-${process.arch}/payload/ContextManager.exe`);
 report.artifact={file:path.relative(repo,file).split(path.sep).join('/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),status:'passed'};
 if(process.platform==='darwin')for(const target of [path.dirname(path.dirname(path.dirname(file))),path.join(path.dirname(path.dirname(file)),'Helpers/ContextRuntimeLauncher')]){
  const r=spawnSync('/usr/bin/codesign',['--verify','--strict',target],{encoding:'utf8'});if(r.status!==0)throw Error('Built manager signature verification failed: '+r.stderr);
 }
 report.artifact.signatureScope=process.platform==='darwin'?'Built manager/launcher only; not OpenAI identity or browser authorization.':'SHA256 only; not Authenticode identity or browser authorization.';
}catch(error){report.artifact={...report.artifact,status:'failed',reason:error.message};}
report.completedAt=new Date().toISOString();report.automatedPassed=report.groups.every(g=>g.status==='passed')&&report.artifact.status==='passed';
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const lines=['## Runtime release contract',`Version ${version} · ${process.platform}/${process.arch} · automated ${report.automatedPassed?'passed':'FAILED'}`,'','| Group | Result | Tests | Skipped |','| --- | --- | ---: | ---: |',...report.groups.map(g=>`| ${g.name} | ${g.status} | ${g.passed??0}/${g.tests??0} | ${g.skipped??'?'} |`),'',`Artifact: ${report.artifact.status}.`,'','Live Chrome / official signing identity: **not tested by hosted CI**; release acceptance required.','CPU/RSS/network/history latency: **not measured by this functional gate**.',''];
const markdown=lines.join('\n');fs.writeFileSync(path.join(output,'summary.md'),markdown);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown);
if(!report.automatedPassed)process.exitCode=1;
