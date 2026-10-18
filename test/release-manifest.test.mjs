import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {artifactFilename, manifestCandidate} from '../src/core/update-artifact.mjs';

test('release packaging produces both update feeds and rejects mismatched artifacts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctc-release-'));
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
  const mac = {platform: 'darwin', arch: 'arm64'}, windows = {platform: 'win32', arch: 'x64'};
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/create-update-manifest.mjs', import.meta.url)), directory], {encoding: 'utf8'});
  try {
    for (const target of [mac, windows]) {
      const filename = artifactFilename(version, target), content = Buffer.from(target.platform);
      fs.writeFileSync(path.join(directory, filename), content);
      fs.writeFileSync(path.join(directory, filename + '.sha256'), crypto.createHash('sha256').update(content).digest('hex') + '  ' + filename + '\n');
    }
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const legacy = JSON.parse(fs.readFileSync(path.join(directory, 'update.json')));
    const matrix = JSON.parse(fs.readFileSync(path.join(directory, 'update-v2.json')));
    assert.equal(legacy.schemaVersion, 1);
    assert.equal(matrix.schemaVersion, 2);
    assert.deepEqual(manifestCandidate(legacy, mac), manifestCandidate(matrix, mac));
    assert.equal(manifestCandidate(matrix, windows).filename, artifactFilename(version, windows));
    fs.appendFileSync(path.join(directory, artifactFilename(version, windows)), 'corrupted');
    assert.notEqual(run().status, 0);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
