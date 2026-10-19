import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {prepareUpgrade,inheritedSettings,completeUpgrade} from '../src/upgrade-state.mjs';
test('version upgrades preserve configuration and unknown fields with one bounded snapshot',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-upgrade-'));try{
 fs.mkdirSync(path.join(home,'code'));fs.writeFileSync(path.join(home,'code/package.json'),JSON.stringify({version:'0.17.0'}));
 const saved={version:2,policies:{chat:{window:900000,revision:9}},futureSetting:'keep'};fs.writeFileSync(path.join(home,'state.json'),JSON.stringify(saved));fs.writeFileSync(path.join(home,'language.json'),JSON.stringify({choice:'en'}));fs.writeFileSync(path.join(home,'thread-cache.json'),'large cache');
 const ui={version:3,shortcut:{accelerator:'Control+Alt+K',enabled:true},future:'keep'};fs.writeFileSync(path.join(home,'ui-settings.json'),JSON.stringify(ui));
 const queue={version:1,queues:{chat:{tasks:[{id:'task',requestId:'agent-1',requestHash:'preserve',prompt:'keep task'}],revision:4}}},compensation={enabled:true,future:'keep'};fs.writeFileSync(path.join(home,'task-queues.json'),JSON.stringify(queue));fs.writeFileSync(path.join(home,'compaction-compensation.json'),JSON.stringify(compensation));
 const change=prepareUpgrade({home,version:'0.17.1'});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/state.json'))),saved);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/ui-settings.json'))),ui);assert.equal(fs.existsSync(path.join(home,'upgrade-backup/thread-cache.json')),false);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/task-queues.json'))),queue);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/compaction-compensation.json'))),compensation);
 assert.equal(inheritedSettings({version:3},{version:1}).version,3);
 assert.deepEqual(inheritedSettings({node:'old',custom:{keep:true}},{node:'new'}),{node:'new',custom:{keep:true}});
 const original=fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'),'utf8');prepareUpgrade({home,version:'0.17.1'});assert.equal(fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'),'utf8'),original);completeUpgrade({home,...change});
 fs.writeFileSync(path.join(home,'code/package.json'),JSON.stringify({version:'0.17.1'}));prepareUpgrade({home,version:'0.17.1'});assert.equal(fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'),'utf8'),original);
 prepareUpgrade({home,version:'0.18.0'});assert.equal(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'))).from,'0.17.1');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'state.json'))),saved);assert.equal(fs.readFileSync(path.join(home,'thread-cache.json'),'utf8'),'large cache');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
