import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';

export const bundledSkillPath = fileURLToPath(new URL('../skills/context-manager', import.meta.url));
const metadataName = '.context-manager-skill.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
async function inspect(file, directory = false) {
  const info = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (info && (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))) {
    fail('SKILL_UNSAFE_PATH', `Expected a regular ${directory ? 'directory' : 'file'}: ${file}`);
  }
  return info;
}
async function atomicWrite(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, {flag: 'wx', mode: 0o600});
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

// This skill deliberately consists of one self-contained SKILL.md. Do not copy
// arbitrary neighboring files or let an ownership record select write paths.
export async function installSkill({skillsRoot, force = false, source = bundledSkillPath, env = process.env, home = os.homedir()} = {}) {
  const root = path.resolve(skillsRoot ?? path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'));
  const target = path.join(root, 'context-manager');
  const sourceFile = path.join(source, 'SKILL.md');
  await inspect(source, true);
  const sourceInfo = await inspect(sourceFile);
  if (!sourceInfo || sourceInfo.size > 1024 * 1024) fail('SKILL_SOURCE_INVALID', 'Bundled SKILL.md is missing or too large.');
  const bytes = await fs.readFile(sourceFile);
  const digest = hash(bytes);
  await fs.mkdir(root, {recursive: true});
  await inspect(target, true);
  const destination = path.join(target, 'SKILL.md');
  const metadataFile = path.join(target, metadataName);
  const currentInfo = await inspect(destination);
  const metadataInfo = await inspect(metadataFile);
  let previous = null;
  if (metadataInfo && metadataInfo.size <= 4096) {
    try { previous = JSON.parse(await fs.readFile(metadataFile, 'utf8')); } catch { /* Treat an unknown receipt as unmanaged. */ }
  }
  const currentHash = currentInfo ? hash(await fs.readFile(destination)) : null;
  const owned = previous?.schemaVersion === 1 && previous?.name === 'context-manager' && previous?.sha256 === currentHash;
  if (currentHash && currentHash !== digest && !owned && !force) {
    fail('SKILL_MODIFIED', `Local skill differs from the managed copy: ${destination}. Preserve your edits or use --force to replace SKILL.md.`);
  }
  await fs.mkdir(target, {recursive: true});
  const changed = currentHash !== digest;
  if (changed) await atomicWrite(destination, bytes);
  const receipt = {schemaVersion: 1, name: 'context-manager', sha256: digest};
  if (previous?.schemaVersion !== 1 || previous?.name !== receipt.name || previous?.sha256 !== digest) {
    await atomicWrite(metadataFile, JSON.stringify(receipt, null, 2) + '\n');
  }
  return {name: 'context-manager', path: target, changed, sha256: digest};
}
