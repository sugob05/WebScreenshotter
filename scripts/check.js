import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ['node_modules', 'data', 'aufnahmen', 'dist'].includes(entry.name) ||
      entry.name.startsWith('.')
    )
      continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], {
        stdio: 'inherit',
        windowsHide: true,
      });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
await check(root);
console.log('Alle JavaScript-Dateien sind syntaktisch gültig.');
