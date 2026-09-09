import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = '/pocket-partner/';
const files = [base, base + 'icon.svg'];
for (const directory of ['assets', 'fonts'])
  for (const file of await readdir('dist/' + directory))
    if (!file.startsWith('.') && !file.endsWith('.txt')) files.push(base + directory + '/' + file);
const version = createHash('sha256')
  .update(await readFile('dist/index.html'))
  .digest('hex')
  .slice(0, 16);
const template = await readFile('public/sw.js', 'utf8');
await writeFile(
  'dist/sw.js',
  `self.__POCKET_VERSION=${JSON.stringify(version)};\nself.__POCKET_PRECACHE=${JSON.stringify(files)};\n` +
    template,
);
console.log(
  `Offline shell includes ${files.length} public assets. Private data is never cached by the service worker.`,
);
