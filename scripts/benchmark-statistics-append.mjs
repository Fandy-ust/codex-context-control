// Read-only source capture; append exclusively to an isolated temporary copy.
// Output contains counters/timings only, never conversation text.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';import {DatabaseSync} from 'node:sqlite';
import {readHistory,createHistoryCache} from '../src/context-history.mjs';import {statisticsEvent} from '../src/statistics-events.mjs';import {analyzeEvents} from '../src/context-statistics.mjs';
const id=process.argv[2];if(!id)throw Error('Pass a chat ID; the original history will not be changed.');
const source=process.env.CONTEXT_CONTROL_CODEX_HOME||process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-append-bench-'));fs.chmodSync(temp,0o700);
const raw=createHistoryCache(),projected=createHistoryCache({projectEvent:statisticsEvent});const samples={raw:[],projected:[]};
const stable=result=>{const {generatedAt,...rest}=result;return rest;};
try{
 const sources=readHistory(source,id).sources,db=new DatabaseSync(path.join(temp,'state_5.sqlite'));
 try{db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');for(const record of sources){const target=path.join(temp,record.threadId+'.jsonl');fs.copyFileSync(record.file,target);db.prepare('INSERT OR REPLACE INTO threads VALUES(?,?)').run(record.threadId,target);}}finally{db.close();}
 const file=path.join(temp,id+'.jsonl'),initialBytes=fs.statSync(file).size;
 // An active source may end in an incomplete line; only the isolated copy is trimmed.
 const bytes=fs.readFileSync(file);fs.truncateSync(file,bytes.lastIndexOf(10)+1);
 for(const cache of [raw,projected])analyzeEvents(readHistory(temp,id,cache),id);
 const before={raw:raw.metrics.bytesRead,projected:projected.metrics.bytesRead};let appendedBytes=0;
 for(let n=0;n<30;n++){
  const timestamp=new Date(Date.UTC(2026,9,17,12,0,n)).toISOString();
  const records=[{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Offline appended input '+n}]}},{type:'response_item',payload:{type:'message',role:'assistant',phase:'final',content:[{type:'output_text',text:'Offline output '+n}]}},{type:'token_usage_record',payload:{response_id:'offline-append-'+n,usage:{input_tokens:20000+n*100,cached_input_tokens:19000,cache_write_input_tokens:0,output_tokens:10,reasoning_output_tokens:0}}}];
  const body=records.map(record=>JSON.stringify({...record,timestamp})).join('\n')+'\n';fs.appendFileSync(file,body);appendedBytes+=Buffer.byteLength(body);
  const results={};
  for(const label of n%2?['projected','raw']:['raw','projected']){const start=performance.now();results[label]=analyzeEvents(readHistory(temp,id,label==='raw'?raw:projected),id);samples[label].push(performance.now()-start);}
  assert.deepEqual(stable(results.raw),stable(results.projected));
 }
 const timings=values=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:sorted[15],p95Ms:sorted[28]};};
 console.log(JSON.stringify({isolated:true,remoteModelRequests:0,appends:30,initialBytes,appendedBytes,raw:{...timings(samples.raw),bytesRead:raw.metrics.bytesRead-before.raw},projected:{...timings(samples.projected),bytesRead:projected.metrics.bytesRead-before.projected,retainedBytes:[...projected.files.values()].reduce((n,e)=>n+e.retainedBytes,0)},allResultsEquivalent:true},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
