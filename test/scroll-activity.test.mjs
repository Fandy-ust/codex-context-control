import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollActivity} from '../desktop/renderer/scroll-activity.mjs';

test('continuous wheel input defers repaint until idle and starts a fresh gesture afterward',()=>{
  let now=0,id=0;const timers=new Map(),events=[];
  const activity=scrollActivity({onStart:()=>events.push('cancel pointer'),onIdle:()=>events.push('repaint'),
    setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id)});
  const advance=ms=>{now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}};
  for(let i=0;i<30;i++){activity.touch();assert.equal(activity.active,true);advance(30);}
  assert.deepEqual(events,['cancel pointer']);assert.equal(timers.size,1);
  advance(149);assert.equal(activity.active,true);advance(1);
  assert.equal(activity.active,false);assert.deepEqual(events,['cancel pointer','repaint']);
  activity.touch();assert.equal(activity.active,true);advance(180);
  assert.deepEqual(events,['cancel pointer','repaint','cancel pointer','repaint']);
});
