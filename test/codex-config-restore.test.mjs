import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'smol-toml';
import {prepareConfigRestore} from '../src/codex-config-restore.mjs';

test('quoted root notify survives the desktop bootstrap replacement without a duplicate key',()=>{
 for(const spelling of ['"notify"',"'notify'",'"\\u006eotify"']){
  const source=`# keep comments\r\nmodel = "saved"\r\n${spelling} = ["old-helper.exe", "turn-ended"] # keep this\r\n["mcp_servers".node_repl]\r\ncommand = 'old-node.exe'\r\n`;
  const replacement='notify = ["current-helper.exe", "turn-ended"]';
  const bootstrap=text=>/^notify\s*=/m.test(text)?text.replace(/^notify\s*=.*$/m,replacement):replacement+'\n'+text;
  assert.throws(()=>parse(bootstrap(source)),/./);
  const prepared=prepareConfigRestore(source);
  assert.deepEqual(parse(prepared),parse(source));
  assert.equal(prepared,source.replace(spelling,'notify'));
  assert.deepEqual(parse(bootstrap(prepared)).notify,['current-helper.exe','turn-ended']);
  assert.equal(prepareConfigRestore(prepared),prepared);
 }
});

test('multiline values and nested notify lookalikes are left intact',()=>{
 const source=`description = '''\n"notify" = ["text only"]\n'''\n"notify" = [\n "custom-helper",\n "turn-ended",\n]\n[plugin]\n"notify" = ["nested"]\n`;
 const result=prepareConfigRestore(source);
 assert.deepEqual(parse(result),parse(source));
 assert.ok(result.includes('description = \'\'\'\n"notify" = ["text only"]'));
 assert.ok(result.includes('\nnotify = [\n'));
 assert.ok(result.includes('[plugin]\n"notify"'));
 for(const unchanged of ['model="saved"\n','notify=["custom"]\n[plugin]\n"notify"=["nested"]\n','[plugin]\n"notify"=["nested"]\n'])assert.equal(prepareConfigRestore(unchanged),unchanged);
});

test('conflicting duplicate keys are rejected rather than guessed or silently removed',()=>{
 assert.throws(()=>prepareConfigRestore('"notify"=["custom"]\nnotify=["other"]\n'));
 assert.throws(()=>prepareConfigRestore('model="one"\nmodel="two"\n'));
});
