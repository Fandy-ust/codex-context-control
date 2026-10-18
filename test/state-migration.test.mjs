import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('opening corrupt or incompatible saved state never replaces the original file', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-state-migration-'));
  process.env.CONTEXT_CONTROL_HOME = home;
  process.env.CONTEXT_CONTROL_CODEX_HOME = path.join(home, 'codex');
  try {
    const {Store} = await import('../src/store.mjs');
    const file = path.join(home, 'state.json');
    for (const text of ['{"version":2,"policies":', '{"version":2,"threads":[]}', '{"version":2,"policies":null}']) {
      fs.writeFileSync(file, text);
      assert.throws(() => new Store());
      assert.equal(fs.readFileSync(file, 'utf8'), text);
    }
    const future = {version: 9, policies: {}, threads: {}, futurePreference: {enabled: true}};
    fs.writeFileSync(file, JSON.stringify(future));
    new Store().save();
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), future);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
