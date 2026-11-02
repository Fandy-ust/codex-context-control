import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {request} from '../src/ipc.mjs';
import {root} from '../src/paths.mjs';

// Developer-only, bounded, read-only sampling. No model calls, runtime startup,
// persistent monitor, process interruption, or user configuration changes.
const seconds=Number(process.argv[2]??15);if(!Number.isInteger(seconds)||seconds<1||seconds>55)throw Error('Sample duration must be 1–55 seconds.');
const connection=JSON.parse(fs.readFileSync(path.join(root,'connection.json'))),state=await request('state');
const labels=new Map([[connection.pid,'manager-service'],...state.bridges.map(b=>[b.pid,'manager-bridge'])]);
const cpuTime=value=>value.split(':').reverse().reduce((n,v,i)=>n+Number(v)*60**i,0);
function inventory(){
 if(process.platform==='win32'){
  const ps=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const script="Get-Process | ForEach-Object { try { [PSCustomObject]@{pid=$_.Id;cpu=$_.TotalProcessorTime.TotalSeconds;rss=$_.WorkingSet64;file=$_.Path} } catch {} } | ConvertTo-Json -Compress";
  const data=JSON.parse(execFileSync(ps,['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}));return (Array.isArray(data)?data:[data]).map(p=>({...p,ppid:null}));
 }
 return execFileSync('/bin/ps',['-axo','pid=,ppid=,time=,rss=,comm='],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);return m?[{pid:Number(m[1]),ppid:Number(m[2]),cpu:cpuTime(m[3]),rss:Number(m[4])*1024,file:m[5]}]:[];});
}
let first=inventory();for(const p of first){
 if(p.file?.endsWith('/Codex Context Control.app/Contents/MacOS/ContextControl')||p.file?.endsWith('\\ContextManager.exe'))labels.set(p.pid,'manager-ui');
 if(labels.get(p.pid)==='manager-bridge'&&p.ppid)labels.set(p.ppid,'official-runtime-baseline');
}
const snapshots=[{at:performance.now(),rows:first.filter(p=>labels.has(p.pid))}];
const deadline=performance.now()+seconds*1000;
while(performance.now()<deadline){await new Promise(r=>setTimeout(r,Math.min(2000,Math.max(1,deadline-performance.now()))));snapshots.push({at:performance.now(),rows:inventory().filter(p=>labels.has(p.pid))});}
const results=[...labels].map(([pid,role])=>{
 const samples=snapshots.flatMap(s=>{const p=s.rows.find(p=>p.pid===pid);return p?[{...p,at:s.at}]:[];}),a=samples[0],b=samples.at(-1),cpuSeconds=a&&b?b.cpu-a.cpu:null;
 return {pid,role,samples:samples.length,executable:a?.file??null,cpuSeconds,oneCoreCpuPercent:cpuSeconds!=null&&b.at>a.at?Number((cpuSeconds/((b.at-a.at)/1000)*100).toFixed(2)):null,rssMiB:samples.length?{min:Number((Math.min(...samples.map(p=>p.rss))/1048576).toFixed(1)),max:Number((Math.max(...samples.map(p=>p.rss))/1048576).toFixed(1))}:null};
});
let ui=null;try{const value=JSON.parse(fs.readFileSync(path.join(root,'ui-status.json')));ui={menuWindowVisible:value.menuWindowVisible??null,windowVisible:value.windowVisible??null};}catch{}
const report={schemaVersion:1,platform:process.platform,arch:process.arch,logicalCores:os.cpus().length,version:state.version,at:new Date().toISOString(),durationSeconds:(snapshots.at(-1).at-snapshots[0].at)/1000,connectedBridges:state.bridges.length,activeChats:state.threads.filter(t=>['active','inProgress'].includes(t.status)).length,monitoringEnabled:state.taskQueues.monitoringEnabled,enabledQueues:state.taskQueues.queues.filter(q=>q.enabled).length,pendingHandoffs:state.taskQueues.schedules.filter(s=>['waiting_for_turn','waiting_context','waiting_quota','dispatching','running'].includes(s.state)).length,ui,processes:results,limits:['One host/window, not an idle or cross-platform performance claim.','CPU is percent of one logical core, not total-machine CPU.','RSS includes shared pages and worker threads; summing processes is not unique physical footprint.','Network bytes, disk IO and wakeups are not measured.','Windows parent ancestry is not measured by this sampler.']};
const file=path.resolve('build/manager-resources.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
