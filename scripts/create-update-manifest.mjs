import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {artifactFilename,manifestCandidate} from '../src/core/update-artifact.mjs';
const directory=path.resolve(process.argv[2]??'release'),version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version,tag=`v${version}-preview.1`;
const assets={};
for(const target of [{platform:'darwin',arch:'arm64'},{platform:'win32',arch:'x64'}]){
 const filename=artifactFilename(version,target),file=path.join(directory,filename),digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const expected=fs.readFileSync(file+'.sha256','utf8').trim().split(/\s+/);
 if(expected[0]!==digest||expected.at(-1)!==filename)throw Error('Release checksum mismatch: '+filename);
 assets[`${target.platform}-${target.arch}`]={filename,size:fs.statSync(file).size,sha256:digest};
}
const matrix={schemaVersion:2,version,tag,assets};for(const target of [{platform:'darwin',arch:'arm64'},{platform:'win32',arch:'x64'}])manifestCandidate(matrix,target);
fs.writeFileSync(path.join(directory,'update-v2.json'),JSON.stringify(matrix,null,2)+'\n');
// Existing 0.18.x Mac clients understand schema 1. Keep their public feed valid.
fs.writeFileSync(path.join(directory,'update.json'),JSON.stringify({schemaVersion:1,version,tag,...assets['darwin-arm64']},null,2)+'\n');
console.log('Validated both platforms and generated legacy + multi-platform update feeds.');
