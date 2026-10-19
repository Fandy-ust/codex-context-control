import {DAY, HOUR, WEEK} from '../src/core/quota-statistics.mjs';
import {buildQuotaAnalytics} from '../src/core/quota-analytics.mjs';
export function quotaFixture(now = Date.UTC(2026, 9, 18, 12)) {
  const snapshots = [], requests = [], currentReset = now + 3 * DAY - 7.5 * HOUR;
  for (let week = 3; week >= 0; week--) {
    const weeklyReset = (currentReset - week * WEEK) / 1000, beginning = weeklyReset * 1000 - WEEK;
    for (let day = 0; day < 7; day++) {
      const start = beginning + day * DAY + 6 * HOUR, fiveReset = (start + 5 * HOUR) / 1000;
      const model = ['Sol', 'Luna', 'Astra'][day % 3];
      for (let tick = 0; tick < 7; tick++) {
        const at = start + tick * 10 * 60000;if (at > now) continue;
        const weeklyUsed = day * 9 + tick * (.7 + (week % 2) * .2) + .05 * tick * (tick + 1);
        const delta = .7 + (week % 2) * .2 + .1 * tick;
        snapshots.push({at, scope: 'history', bucket: 'codex', weeklyUsed, weeklyReset, fiveUsed: tick * 11, fiveReset});
        if (tick) {
          const input = (160000 + day * 5000) * delta * (model === 'Luna' ? 1.4 : model === 'Astra' ? .8 : 1);
          requests.push({id: `demo-${week}-${day}-${tick}`, at: at - 1000, thread: `chat-${day}`, name: ['项目设计', '代码检查', '资料整理'][day % 3], project: ['Context Manager', 'Research'][day % 2], model, input: Math.floor(input), output: 1200 + tick * 100, usd: input / 1e6 * 0.6 + (1200 + tick * 100) / 1e6 * 5, cached: Math.floor(input * (.25 + day * .09))});
        }
      }
    }
  }
  return {snapshots, requests, progress: {files: 7, pending: 0, unreadable: 0, bytesRead: 0}};
}
export function demoQuotaAnalytics(options = {}) {
  const now=Date.UTC(2026,9,18,12),fixture=quotaFixture(),currentScope='account:demo';
  const addCycle=(age,key)=>{
    for(let i=0;i<=18;i++){
      const at=now-age-(18-i)*5*60000;
      fixture.snapshots.push({scope:currentScope,bucket:'codex',at,credits:175-i*.5,weeklyUsed:10+i*.1,weeklyReset:Math.floor((now+2*DAY-Math.floor(age/WEEK)*WEEK)/1000),fiveUsed:24+i*2,fiveReset:Math.floor((now+2*HOUR-age)/1000)});
      if(i)fixture.requests.push({id:`live-${key}-${i}`,at:at-1000,thread:'demo-live',name:'周期对比',project:'Context Manager',model:'Sol',input:100000,output:1000,cached:70000,usd:.08+i*.002});
    }
  };
  for(let week=6;week>=1;week--)addCycle(week*WEEK,'week-'+week);
  for(let cycle=7;cycle>=1;cycle--)addCycle(cycle*5*HOUR,'five-'+cycle);
  addCycle(0,'current');
  return buildQuotaAnalytics({...fixture,currentScope},{now,days:28,timeZone:'Asia/Hong_Kong',...options});
}
