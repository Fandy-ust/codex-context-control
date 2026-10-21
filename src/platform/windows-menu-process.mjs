import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {canonicalLocalPath} from '../local-path.mjs';

// An older version can still own Electron's single-instance lock after the
// install pointer has moved. Recognize that owned UI so the installer can ask
// it to quit before launching the new version; never target a Codex runtime.
export function ownedWindowsMenuProcess({app,installBase,status,info}){
  if(!app||!Number.isSafeInteger(status?.pid)||status.pid<=1||!info?.executable)return null;
  try{
    const executable=canonicalLocalPath(info.executable).toLowerCase();
    if(fs.existsSync(app)&&executable===canonicalLocalPath(app).toLowerCase())return status.pid;
    if(!installBase||status.bundleIdentifier!=='io.github.codex-context-control')return null;
    const base=canonicalLocalPath(installBase).toLowerCase();
    const relative=path.relative(base,executable);
    const match=relative.match(/^versions[\\/](\d+\.\d+\.\d+)-([a-f0-9]{12})[\\/]contextmanager\.exe$/);
    if(!match)return null;
    const data=fs.readFileSync(path.join(path.dirname(info.executable),'payload-manifest.json')),manifest=JSON.parse(data);
    if(manifest.platform!=='win32'||manifest.version!==match[1]||crypto.createHash('sha256').update(data).digest('hex').slice(0,12)!==match[2])return null;
    return status.pid;
  }catch{return null;}
}
