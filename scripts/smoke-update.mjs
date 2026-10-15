import assert from 'node:assert/strict';
import { copyFile, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const modules = resolve('.build/typescript/src');
const { extractUpdate } = /** @type {typeof import('../src/adapters/updates/archive.mjs')} */ (
  await import(pathToFileURL(join(modules, 'adapters/updates/archive.mjs')).href)
);
const { selectRelease } = /** @type {typeof import('../src/domain/updates.mjs')} */ (
  await import(pathToFileURL(join(modules, 'domain/updates.mjs')).href)
);
const archive = resolve(/** @type {string} */ (process.argv[2]));
const version = /** @type {{version: string}} */ (
  JSON.parse(await readFile('package.json', 'utf8'))
).version;
const release = selectRelease(
  {
    draft: false,
    prerelease: false,
    tag_name: `v${version}`,
    assets: [basename(archive), basename(archive) + '.sha256'].map((name) => ({
      name,
      state: 'uploaded',
    })),
  },
  process.platform,
  process.arch,
);
const directory = await mkdtemp(join(tmpdir(), 'gog-live-update-smoke-'));
try {
  await extractUpdate(await readFile(archive), directory, release);
  const executable = join(
    directory,
    process.platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements',
  );
  // Run a private copy of Node from the installed executable path. Its process
  // must move its own loaded image aside, then install and verify the real CLI.
  await copyFile(process.execPath, executable);
  await chmod(executable, 0o755);
  const queue = '{"preserve":"local queue"}\n';
  await writeFile(join(directory, 'queue.json'), queue);
  const worker = `
    import { readFile } from 'node:fs/promises';
    const { installPackage, preparePackage } = await import(process.argv[1]);
    const release = JSON.parse(process.argv[4]);
    const bytes = await readFile(process.argv[2]);
    const checksum = await readFile(process.argv[2] + '.sha256');
    const backup = await installPackage(process.argv[3], release,
      staging => preparePackage(bytes, checksum, staging, release));
    process.stdout.write(JSON.stringify({ backup }));
  `;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE'].includes(key.toUpperCase()),
    ),
  );
  const options = { cwd: directory, env, timeout: 30000, maxBuffer: 128000, windowsHide: true };
  const swapped = await execute(
    executable,
    [
      '--input-type=module',
      '-e',
      worker,
      pathToFileURL(join(modules, 'adapters/updates/install.mjs')).href,
      archive,
      directory,
      JSON.stringify(release),
    ],
    options,
  );
  const { backup } = /** @type {{backup: string}} */ (JSON.parse(swapped.stdout));
  const help = await execute(executable, ['--help', '--json'], options);
  assert.equal(JSON.parse(help.stdout).data.version, version);
  const previous = await execute(join(backup, basename(executable)), ['--version'], options);
  assert.equal(previous.stdout.trim(), process.version);
  assert.equal(await readFile(join(directory, 'queue.json'), 'utf8'), queue);
  process.stdout.write(
    'Packaged update smoke passed (running executable replacement, full package verification, backup and queue preservation).\n',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
