import fs from 'node:fs';
import path from 'node:path';

// Native Windows rollouts can use extended-length drive and UNC paths. Keep
// native resolution, then normalize namespaces before comparing containment.
export function normalizeLocalPath(file){
  if(process.platform!=='win32')return file;
  if(/^\\\\\?\\UNC\\/i.test(file))return '\\\\'+file.slice(8);
  if(/^\\\\\?\\[a-z]:\\/i.test(file))return file.slice(4);
  return file;
}
export function canonicalLocalPath(file){return normalizeLocalPath(fs.realpathSync.native(file));}
export function pathInside(directory,file){
  const relative=path.relative(normalizeLocalPath(directory),normalizeLocalPath(file));
  return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
}
