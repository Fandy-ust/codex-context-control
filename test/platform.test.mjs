import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRoot,ipcEndpoint} from '../src/platform/index.mjs';
test('Windows paths support Unicode, non-default drives, and user-isolated pipe names',()=>{
  assert.equal(defaultRoot({platform:'win32',home:'C:\\Users\\测试',env:{LOCALAPPDATA:'D:\\本地数据'}}),'D:\\本地数据\\CodexContextControl');
  const options={platform:'win32',home:'C:\\Users\\测试'},a=ipcEndpoint('D:\\App Data\\控制',options);
  assert.match(a,/^\\\\\.\\pipe\\codex-context-[a-f0-9]{32}$/);
  assert.equal(a,ipcEndpoint('d:\\app data\\控制',options));
  assert.notEqual(a,ipcEndpoint('D:\\App Data\\控制',{...options,home:'C:\\Users\\SomeoneElse'}));
  assert.notEqual(a,ipcEndpoint('D:\\Other',options));
});
