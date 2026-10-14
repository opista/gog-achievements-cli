import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run npm run verify:package.');
const directory = await mkdtemp(join(tmpdir(), 'gog-source-package-'));
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const cache = join(directory, 'cache');
  const options = { cwd: root, timeout: 30000, maxBuffer: 1_000_000 };
  const packed = await execute(
    process.execPath,
    [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory, '--cache', cache],
    options,
  );
  const metadata = /** @type {unknown} */ (JSON.parse(packed.stdout));
  assert.ok(Array.isArray(metadata) && metadata.length === 1);
  const entry = /** @type {{filename?: unknown}} */ (metadata[0]);
  assert.equal(typeof entry.filename, 'string');
  const archive = join(directory, String(entry.filename));
  await execute(
    process.execPath,
    [
      npm,
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--prefix',
      directory,
      '--cache',
      cache,
      archive,
    ],
    options,
  );
  const installed = join(directory, 'node_modules', 'gog-achievements-cli');
  await access(join(installed, '.build/typescript/src/index.d.mts'));
  await assert.rejects(access(join(installed, '.build/typescript/test')));
  await assert.rejects(access(join(installed, 'node_modules/typescript')));
  const help = await execute(
    process.execPath,
    [join(installed, 'bin/gog-achievements.mjs'), '--help', '--json'],
    { ...options, cwd: directory },
  );
  assert.equal(help.stderr, '');
  const exported = await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const m = await import('gog-achievements-cli'); if (typeof m.GogAchievements !== 'function' || typeof m.runCLI !== 'function') process.exit(1);",
    ],
    { ...options, cwd: directory },
  );
  assert.equal(exported.stderr, '');
  process.stdout.write(
    'Source package installs and runs without scripts, tests or compiler dependencies.\n',
  );
} finally {
  await rm(resolve(directory), { recursive: true, force: true });
}
