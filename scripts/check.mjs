import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const files = [
  'src/index.js',
  'src/lib/navdata.js',
  'src/lib/route-parser.js',
  'src/lib/notam-engine.js',
  'src/lib/providers/autorouter.js',
  'src/lib/providers/faa.js'
];

for (const file of files) {
  readFileSync(resolve(root, file));
}

for (const file of files) {
  await import(pathToFileURL(resolve(root, file)).href);
}

console.log('OK: module imports passed');
