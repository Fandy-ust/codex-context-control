import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installSkill} from '../src/skill-install.mjs';
import {runManagerCLI} from '../src/manager-cli.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-skill-'));
  t.after(() => fs.rm(base, {recursive: true, force: true}));
  const source = path.join(base, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'SKILL.md'), 'first version');
  return {base, source, skillsRoot: path.join(base, 'skills')};
}

test('skill installation is repeatable, upgrades owned content and preserves unrelated files', async t => {
  const options = await fixture(t);
  const first = await installSkill(options);
  assert.equal(first.changed, true);
  assert.equal((await installSkill(options)).changed, false);
  await fs.writeFile(path.join(first.path, 'notes.txt'), 'user notes');
  await fs.writeFile(path.join(options.source, 'SKILL.md'), 'second version');
  assert.equal((await installSkill(options)).changed, true);
  assert.equal(await fs.readFile(path.join(first.path, 'SKILL.md'), 'utf8'), 'second version');
  assert.equal(await fs.readFile(path.join(first.path, 'notes.txt'), 'utf8'), 'user notes');
});

test('local edits and unmanaged installations require explicit force', async t => {
  const options = await fixture(t);
  const {path: target} = await installSkill(options);
  const file = path.join(target, 'SKILL.md');
  await fs.writeFile(file, 'my edits');
  await assert.rejects(installSkill(options), {code: 'SKILL_MODIFIED'});
  assert.equal(await fs.readFile(file, 'utf8'), 'my edits');
  await fs.rm(path.join(target, '.context-manager-skill.json'));
  await assert.rejects(installSkill(options), {code: 'SKILL_MODIFIED'});
  await installSkill({...options, force: true});
  assert.equal(await fs.readFile(file, 'utf8'), 'first version');
});

test('Codex home defaults and custom CLI directory work without a running controller', async t => {
  const options = await fixture(t);
  const customHome = path.join(options.base, 'codex home');
  const result = await installSkill({source: options.source, env: {CODEX_HOME: customHome}});
  assert.equal(result.path, path.join(customHome, 'skills', 'context-manager'));
  const fallback = await installSkill({source: options.source, env: {}, home: options.base});
  assert.equal(fallback.path, path.join(options.base, '.codex', 'skills', 'context-manager'));
  const cli = await runManagerCLI(['skill', 'install', '--path', options.skillsRoot], {client: () => assert.fail('No daemon required')});
  assert.equal(cli.path, path.join(options.skillsRoot, 'context-manager'));
  assert.match(await fs.readFile(path.join(cli.path, 'SKILL.md'), 'utf8'), /name: context-manager/);
});

test('unsafe destinations cannot redirect installer writes, even with force', async t => {
  const options = await fixture(t);
  await fs.mkdir(options.skillsRoot);
  const target = path.join(options.skillsRoot, 'context-manager');
  await fs.symlink(options.source, target, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installSkill({...options, force: true}), {code: 'SKILL_UNSAFE_PATH'});
  assert.equal(await fs.readFile(path.join(options.source, 'SKILL.md'), 'utf8'), 'first version');
});
