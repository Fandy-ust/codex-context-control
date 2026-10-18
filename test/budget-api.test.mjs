import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('visible and legacy budget clients share validation, revisions and persisted raw units', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-budget-api-'));
  const control = path.join(temp, 'control'), home = path.join(temp, 'codex');
  fs.mkdirSync(control); fs.mkdirSync(home);
  fs.copyFileSync(new URL('fixtures/models.json', import.meta.url), path.join(home, 'models_cache.json'));
  fs.writeFileSync(path.join(control, 'state.json'), JSON.stringify({
    version: 9, futureField: {keep: true}, policies: {},
    threads: {existing: {id: 'existing', model: 'context-fixture', status: 'idle'}}
  }));
  process.env.CONTEXT_CONTROL_HOME = control;
  process.env.CONTEXT_CONTROL_CODEX_HOME = home;
  const {startDaemon} = await import('../src/daemon.mjs');
  const daemon = await startDaemon();
  try {
    const connection = JSON.parse(fs.readFileSync(path.join(control, 'connection.json')));
    const base = `http://127.0.0.1:${connection.port}`;
    const headers = {authorization: `Bearer ${connection.token}`};
    const post = (route, body, auth = headers) => fetch(base + route, {method: 'POST', headers: auth, body: JSON.stringify(body)});
    const state = await (await fetch(base + '/state', {headers})).json();
    assert.equal(state.capabilities.visibleBudget, true);
    const budget = {usableWindow: 400000, compact: 350000, reserve: 16000, retainedFloor: 0};
    const command = {id: 'existing', budget, expectedRevision: 0, apply: false};
    assert.equal((await post('/policy', command, {})).status, 403);
    const preflight = await (await post('/preflight', command)).json();
    assert.equal(preflight.expectedWindow, 400000);
    const response = await post('/policy', command);
    assert.equal(response.status, 200);
    const {policy} = await response.json();
    assert.equal(policy.window, 421053);
    assert.equal(policy.compact, budget.compact);
    assert.equal(policy.revision, 1);
    assert.equal(policy.enabled, false);
    assert.equal((await post('/policy', command)).status, 400, 'stale revision is rejected');
    assert.equal((await post('/policy', {...command, expectedRevision: 1, policy})).status, 400, 'ambiguous units are rejected');
    assert.equal((await post('/policy', {...command, expectedRevision: 1, budget: {...budget, usableWindow: 1000000}})).status, 400);
    const legacy = await post('/policy', {id: 'existing', policy, expectedRevision: 1, apply: false});
    assert.equal(legacy.status, 200);
    const saved = (await legacy.json()).policy;
    assert.equal(saved.window, policy.window);
    assert.equal(saved.revision, 2);
    const persisted = JSON.parse(fs.readFileSync(path.join(control, 'state.json')));
    assert.equal(persisted.version, 9);
    assert.deepEqual(persisted.futureField, {keep: true});
    assert.equal(persisted.policies.existing.window, 421053);
  } finally {
    daemon.web.closeAllConnections();
    await new Promise(resolve => daemon.web.close(resolve));
    await new Promise(resolve => daemon.ipcServer.close(resolve));
    fs.rmSync(temp, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
});
