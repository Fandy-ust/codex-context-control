import fs from 'node:fs';
import {analyzeEvents} from '../src/context-statistics.mjs';
const id='11111111-1111-1111-1111-111111111111',events=[];
const add=(type,payload,ms)=>events.push({type,payload,timestamp:new Date(1700000000000+ms).toISOString(),originThreadId:id});
add('session_meta',{},0);add('turn_context',{model:'gpt-6-astra',service_tier:'default',turn_id:'fixture'},1);
for(let n=0;n<200;n++){
 const time=n*10000+100;
 add('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic chart interaction fixture.'}]},time);
 add('event_msg',{type:'item_completed',item:{type:'Reasoning',id:`reason-${n}`},started_at_ms:1700000000000+time+1000,completed_at_ms:1700000000000+time+2000},time+2000);
 add('response_item',{type:'reasoning',id:`reason-${n}`},time+2000);
 add('response_item',{type:'message',role:'assistant',phase:n%10===0?'final':'commentary',content:[{type:'output_text',text:'Synthetic output.'}]},time+2400);
 add('token_usage_record',{response_id:`response-${n}`,usage:{input_tokens:10000+n*100,cached_input_tokens:n%30===0?0:9000+n*100,cache_write_input_tokens:0,output_tokens:100,reasoning_output_tokens:20}},time+2500);
}
fs.mkdirSync('build',{recursive:true});fs.writeFileSync('build/chart-fixture.json',JSON.stringify(analyzeEvents(events,id)));
