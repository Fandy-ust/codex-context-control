import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),core=path.join(root,'src/core');
for(const name of fs.readdirSync(core)){
 if(!name.endsWith('.mjs'))continue;const file=path.join(core,name),source=fs.readFileSync(file,'utf8');
 if(/import\s*\(/.test(source))throw Error('Core may not load runtime dependencies dynamically: '+name);
 for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
  const target=path.resolve(path.dirname(file),match[1]);
  if(!match[1].startsWith('.')||!target.startsWith(core+path.sep))throw Error('Core depends on an outer layer: '+name+' -> '+match[1]);
 }
 if(/\bprocess\.(?:platform|env)|\b(?:fetch|spawn|execFile)\s*\(/.test(source))throw Error('Platform/IO operation in core: '+name);
}
const {CONTROL_ROUTES,controlOperation}=await import('../src/contracts/control-api.mjs');
for(const [operation,route] of Object.entries(CONTROL_ROUTES))if(controlOperation(route.method,route.path)!==operation)throw Error('Duplicate control route');
process.argv.push('--check');await import('./generate-contracts.mjs');
console.log('Core boundaries and shared control routes validated.');
