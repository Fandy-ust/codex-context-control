import fs from 'node:fs';
import path from 'node:path';

// Both desktop packages use only the ESM lite entry and o200k_base. Keep the
// package metadata and license, but omit other encodings and CommonJS bundles.
export function pruneTokenizer(nodeModules) {
  const distribution = path.join(nodeModules, 'js-tiktoken/dist');
  for (const name of fs.readdirSync(distribution)) {
    if (name !== 'lite.js' && !/^chunk-.*\.js$/.test(name) && name !== 'ranks') {
      fs.rmSync(path.join(distribution, name), {recursive: true, force: true});
    }
  }
  for (const name of fs.readdirSync(path.join(distribution, 'ranks'))) {
    if (name !== 'o200k_base.js') fs.rmSync(path.join(distribution, 'ranks', name));
  }
}
