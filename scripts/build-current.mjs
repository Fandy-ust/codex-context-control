const operation=process.argv.includes('--package')?'package':'build';
const platform=process.platform==='win32'?'win':process.platform==='darwin'?'mac':null;
if(!platform)throw Error('Build desktop packages on Windows or macOS; use the dual-platform GitHub Actions workflow for both.');
await import(new URL(`./${operation}-${platform}.mjs`,import.meta.url));
