import fs from 'node:fs';
import path from 'node:path';

export function pruneElectron(payload) {
  const locales = path.join(payload, 'locales');
  // These match the app's two supported languages. Keep the English fallback;
  // desktop/main.mjs selects the matching Chromium locale before ready.
  for (const locale of ['en-US.pak', 'zh-CN.pak']) {
    if (!fs.existsSync(path.join(locales, locale))) throw Error('Missing Electron locale: ' + locale);
  }
  for (const name of fs.readdirSync(locales)) {
    if (name.endsWith('.pak') && !['en-US.pak', 'zh-CN.pak'].includes(name)) fs.unlinkSync(path.join(locales, name));
  }
  fs.rmSync(path.join(payload, 'resources/default_app.asar'), {force: true});
}
