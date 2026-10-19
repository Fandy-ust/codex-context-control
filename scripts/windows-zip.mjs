import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {powershell} from '../src/platform/index.mjs';

// Keep standard ZIP/Deflate so existing .NET installers and OTA readers work.
// 7-Zip is a build-time optimization, never an end-user prerequisite.
export function createWindowsZip(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  const relative = path.relative(source, destination);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw Error('Archive must be outside its source directory');
  const candidates = [process.env.CONTEXT_CONTROL_7ZIP, path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip/7z.exe')].filter(Boolean);
  const sevenZip = candidates.find(file => fs.existsSync(file));
  const temporary = destination + '.' + randomUUID() + '.zip';
  try {
    if (sevenZip) {
      const result = spawnSync(sevenZip, ['a', '-tzip', '-mm=Deflate', '-mx=9', '-mfb=258', '-mpass=5', '-mmt=2', '-mcu=on', '-y', temporary, '*'], {cwd: source, encoding: 'utf8', windowsHide: true, timeout: 600000});
      if (result.error || result.status !== 0) throw Error(result.error?.message || result.stdout + result.stderr);
    } else {
      powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem;[System.IO.Compression.ZipFile]::CreateFromDirectory($env:CONTEXT_CONTROL_PACKAGE,$env:CONTEXT_CONTROL_ZIP,[System.IO.Compression.CompressionLevel]::Optimal,$false)', {CONTEXT_CONTROL_PACKAGE: source, CONTEXT_CONTROL_ZIP: temporary}, {timeout: 180000});
    }
    fs.renameSync(temporary, destination);
    console.log(JSON.stringify({archive: path.basename(destination), compressor: sevenZip ? '7zip-deflate' : 'dotnet-deflate', bytes: fs.statSync(destination).size}));
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}
