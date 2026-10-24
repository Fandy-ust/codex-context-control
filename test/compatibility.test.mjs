import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeSupported,isStdioServer,classifyRuntimeCommand} from '../src/compatibility.mjs';
test('recognized runtimes are accepted without a version allowlist',()=>{
  assert.ok(runtimeSupported('codex-cli 0.160.0'));assert.ok(runtimeSupported('codex-cli 0.159.2'));
  assert.ok(runtimeSupported('codex-cli 0.161.0'));assert.ok(runtimeSupported('codex-cli 0.200.0-alpha.1'));assert.ok(runtimeSupported('codex-cli 9.42.0-preview.7'));assert.ok(runtimeSupported('codex-cli 99.0.0'));assert.ok(!runtimeSupported('unavailable'));
});

test('only unambiguous direct stdio commands enable enhancements',()=>{
  for(const args of [
    ['app-server'],['app-server','--stdio'],['app-server','--listen=stdio://'],
    ['-c','model="proxy"','--enable','feature','app-server','--strict-config'],
    ['app-server','--cloud-skills-snapshot','proxy','--startup-client-info','{"name":"help"}'],
    ['app-server','--code-mode-host=ws://127.0.0.1:1','--analytics-default-enabled'],
  ])assert.equal(isStdioServer(args),true,JSON.stringify(args));
  for(const args of [
    ['app-server','--print-startup-config'],['app-server','--startup-sign-out'],
    ['app-server','--help'],['app-server','-h'],['app-server','future-subcommand'],
    ['app-server','--future-flag'],['app-server','--future-option','stdio://'],
    ['--unknown','app-server'],['--config','app-server'],
    ['app-server','--listen'],['app-server','--listen='],
    ['app-server','--listen','--strict-config'],['app-server','--listen','off'],
    ['app-server','--listen','unix://'],['app-server','--listen','stdio://','--listen','ws://localhost:1'],
    ['app-server','--stdio','--listen=stdio://'],['app-server','--'],
  ])assert.equal(isStdioServer(args),false,JSON.stringify(args));
  assert.equal(classifyRuntimeCommand(['app-server','--listen','stdio://','--stdio']).reason,'ambiguous-transport');
});
test('Code Mode websocket arguments do not disable the stdio bridge',()=>{
  assert.ok(isStdioServer(['app-server','--code-mode-host','ws://127.0.0.1:1','--listen','stdio://']));
  assert.ok(!isStdioServer(['app-server','--listen','ws://127.0.0.1:2']));
  assert.ok(!isStdioServer(['app-server','daemon','version']));assert.ok(!isStdioServer(['app-server','proxy','--sock','control.sock']));assert.ok(!isStdioServer(['app-server','help']));assert.ok(!isStdioServer(['--version']));
});
