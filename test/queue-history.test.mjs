import test from 'node:test';
import assert from 'node:assert/strict';
import {queueTaskHistory} from '../src/core/queue-history.mjs';
const now=1800000000000;
test('unfinished execution order stays intact while newest completed tasks appear before older ones',()=>{
 const tasks=[{id:'old',status:'completed',finishedAt:now-2000},{id:'first',status:'waiting'},{id:'new',status:'completed',finishedAt:now-1000},{id:'second',status:'waiting'}];
 assert.deepEqual(queueTaskHistory(tasks,now).map(t=>t.id),['first','second','new','old']);assert.equal(tasks[0].id,'old');
});
test('only completed tasks archive twelve hours after completion, with persisted creation fallback',()=>{
 const tasks=[{id:'done',status:'completed',finishedAt:now-12*3600000},{id:'recent',status:'completed',finishedAt:now-12*3600000+1},{id:'legacy',status:'completed',createdAt:now-13*3600000},{id:'pending',status:'waiting',createdAt:0},{id:'error',status:'error',finishedAt:0}];
 const rows=queueTaskHistory(tasks,now);assert.deepEqual(rows.filter(t=>t.archivedAt!=null).map(t=>t.id),['done','legacy']);assert.equal(rows.find(t=>t.id==='done').archivedAt,now);
});

test('shared queue snapshots archive completion while leaving persisted execution order intact',async()=>{
 const {createTaskQueues,defaultQueueConfig}=await import('../src/task-queues.mjs');
 const queue={id:'chat',enabled:false,config:defaultQueueConfig(),revision:1,tasks:[{id:'old',prompt:'Old task',status:'completed',finishedAt:now-13*3600000},{id:'waiting',prompt:'Next task',status:'waiting',createdAt:now}]};
 const engine=createTaskQueues({load:()=>({queues:{chat:queue}}),thread:()=>({id:'chat',status:'idle'}),now:()=>now});
 try{
  const result=engine.list();assert.equal(result.sleepPrevented,false);assert.deepEqual(result.queues[0].tasks.map(t=>t.id),['waiting','old']);assert.ok(result.queues[0].tasks[1].archivedAt);assert.equal(engine.get('chat').tasks[0].id,'old');
  const {queueDetail}=await import('../desktop/renderer/task-queues.mjs');
  const html=queueDetail({id:'chat',queues:result,chats:[{id:'chat'}],quota:null,e:s=>String(s??''),t:s=>s});
  assert.ok(html.includes('queue-archive'));assert.ok(html.indexOf('Next task')<html.indexOf('Old task'));
 }finally{engine.close();}
});
