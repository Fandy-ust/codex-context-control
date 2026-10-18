import fs from 'node:fs';
const metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export const version=metadata.version;
export const buildId=metadata.buildId??null;
