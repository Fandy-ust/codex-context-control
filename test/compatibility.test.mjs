import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeSupported,isStdioServer} from '../src/compatibility.mjs';
test('recognized runtimes are accepted without a version allowlist',()=>{
  assert.ok(runtimeSupported('codex-cli 0.160.0'));assert.ok(runtimeSupported('codex-cli 0.159.2'));
  assert.ok(runtimeSupported('codex-cli 0.161.0'));assert.ok(runtimeSupported('codex-cli 0.200.0-alpha.1'));assert.ok(runtimeSupported('codex-cli 9.42.0-preview.7'));assert.ok(runtimeSupported('codex-cli 99.0.0'));assert.ok(!runtimeSupported('unavailable'));
});
test('Code Mode websocket arguments do not disable the stdio bridge',()=>{
  assert.ok(isStdioServer(['app-server','--code-mode-host','ws://127.0.0.1:1','--listen','stdio://']));
  assert.ok(!isStdioServer(['app-server','--listen','ws://127.0.0.1:2']));
  assert.ok(!isStdioServer(['app-server','daemon','version']));assert.ok(!isStdioServer(['--version']));
});
