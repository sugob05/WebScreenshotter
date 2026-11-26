/** Windows release packaging. Inputs are already installed and verified; this
 * build never downloads software or includes local settings/capture results.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const target = path.join(dist, 'WebScreenshotter-Windows-x64');
const archive = `${target}.zip`;
if (process.platform !== 'win32')
  throw new Error('Dieser Paketbau verwendet die Windows-ZIP-Funktion.');
for (const filename of ['runtime/node/node.exe', 'runtime/node/LICENSE', 'runtime/versions.json']) {
  await access(path.join(root, filename));
}
const versions = JSON.parse(await readFile(path.join(root, 'runtime/versions.json'), 'utf8'));
const nodeBytes = await readFile(path.join(root, 'runtime/node/node.exe'));
if (createHash('sha256').update(nodeBytes).digest('hex') !== versions.node?.executableSha256)
  throw new Error('Die Node.js-Laufzeit stimmt nicht mit runtime/versions.json überein.');
// Only this generated directory may be replaced; never accept an arbitrary rm target.
if (path.dirname(path.resolve(target)) !== path.resolve(dist))
  throw new Error('Unsicherer Paketpfad.');
await mkdir(dist, { recursive: true });
await rm(target, { recursive: true, force: true });
await mkdir(target);
const inputs = [
  '.gitignore',
  'src',
  'public',
  'docs',
  'scripts',
  'test',
  'runtime/node',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'server.js',
  'README.md',
  'ANLEITUNG.html',
  'WARTUNG.md',
  'PRUEFBERICHT.md',
  'THIRD_PARTY.md',
  'prettier.config.js',
  'WebScreenshotter-starten.cmd',
];
for (const filename of inputs)
  await cp(path.join(root, filename), path.join(target, filename), {
    recursive: true,
    filter: (source) => !source.endsWith('.local.json'),
  });

// Only the required runtime and its provenance belong in a public release.
// Never copy the whole runtime directory or machine-specific configuration.
await writeFile(
  path.join(target, 'runtime/versions.json'),
  JSON.stringify({ platform: 'win32', architecture: 'x64', node: versions.node }, null, 2) + '\n',
);

// Copy precisely the locked production packages, preserving their license files.
const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const directory of Object.keys(lockfile.packages).filter((name) =>
  name.startsWith('node_modules/'),
)) {
  const installed = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'));
  if (installed.version !== lockfile.packages[directory].version)
    throw new Error(`Versionskonflikt: ${directory}`);
  await cp(path.join(root, directory), path.join(target, directory), { recursive: true });
}
const launcherFile = path.join(target, 'WebScreenshotter-starten.cmd');
const launcherText = await readFile(launcherFile, 'utf8');
await writeFile(launcherFile, launcherText.replace(/\r?\n/g, '\r\n'), 'ascii');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
console.log(`Packe ${target}`);
await rm(archive, { force: true });
await promisify(execFile)(
  'powershell.exe',
  [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(target)}, ${quote(archive)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`,
  ],
  { windowsHide: true, timeout: 300000 },
);
console.log(archive);
