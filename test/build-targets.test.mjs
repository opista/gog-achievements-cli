import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBuildArguments, selectBuildTarget } from '../scripts/build-targets.mjs';

const execute = promisify(execFile);
const targets = [
  ['macos-arm64', 'darwin', 'arm64'],
  ['macos-x64', 'darwin', 'x64'],
  ['windows-arm64', 'win32', 'arm64'],
  ['windows-x64', 'win32', 'x64'],
];

test('build defaults and explicit targets use the matching OS and Node architecture', () => {
  for (const [name, platform, architecture] of targets) {
    const host = { platform, architecture };
    const expected = { name, platform, architecture };
    assert.deepEqual(selectBuildTarget(undefined, host), expected);
    assert.deepEqual(selectBuildTarget(name, host), expected);
  }
});

test('build rejects unknown targets and unsupported runtimes', () => {
  assert.throws(() => selectBuildTarget('linux-x64'), /Unknown build target/);
  for (const host of [
    { platform: 'linux', architecture: 'x64' },
    { platform: 'darwin', architecture: 'ia32' },
    { platform: 'win32', architecture: 'arm' },
  ]) {
    assert.throws(() => selectBuildTarget(undefined, host), /macOS or Windows.*arm64 or x64 Node/);
  }
});

test('build rejects every OS and Node architecture mismatch with a clear target error', () => {
  for (const [name, platform, architecture] of targets) {
    for (const [other] of targets) {
      if (other === name) continue;
      assert.throws(
        () => selectBuildTarget(other, { platform, architecture }),
        (error) => error.message.includes(other) && error.message.includes(`runtime is ${name}`),
      );
    }
  }
});

test('build arguments accept a target, equals syntax, and help', () => {
  assert.deepEqual(parseBuildArguments([]), { target: undefined, help: false });
  assert.deepEqual(parseBuildArguments(['--target', 'macos-arm64']), {
    target: 'macos-arm64',
    help: false,
  });
  assert.deepEqual(parseBuildArguments(['--target=windows-x64']), {
    target: 'windows-x64',
    help: false,
  });
  for (const flag of ['--help', '-h']) {
    assert.deepEqual(parseBuildArguments([flag]), { target: undefined, help: true });
  }
});

test('build rejects missing, duplicate and unknown arguments', () => {
  for (const args of [['--target'], ['--target='], ['--target', '--help']]) {
    assert.throws(() => parseBuildArguments(args), /requires a target name/);
  }
  for (const args of [
    ['--target', 'macos-arm64', '--target', 'macos-x64'],
    ['--target=macos-arm64', '--target=macos-arm64'],
  ]) {
    assert.throws(() => parseBuildArguments(args), /only once/);
  }
  for (const args of [['macos-arm64'], ['--unknown'], ['--target', 'macos-arm64', 'extra']]) {
    assert.throws(() => parseBuildArguments(args), /Unknown build argument/);
  }
});

test('build help and invalid targets work outside the checkout without creating files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-build-options-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
  const options = { cwd: directory, timeout: 10000, maxBuffer: 100000 };
  const help = await execute(process.execPath, [script, '--help'], options);
  assert.equal(help.stderr, '');
  assert.match(help.stdout, /Usage: npm run build/);
  for (const [name] of targets) assert.ok(help.stdout.includes(name));
  await assert.rejects(
    execute(process.execPath, [script, '--target', 'unknown-target'], options),
    (error) =>
      error.code === 1 &&
      error.stdout === '' &&
      error.stderr.startsWith('Build failed: Unknown build target:'),
  );
  const host = targets.find(
    ([, platform, architecture]) => platform === process.platform && architecture === process.arch,
  );
  if (host) {
    const [other] = targets.find(([name]) => name !== host[0]);
    await assert.rejects(
      execute(process.execPath, [script, '--target', other], options),
      (error) => error.code === 1 && error.stderr.includes(`Target ${other} requires`),
    );
  }
  assert.deepEqual(await readdir(directory), []);
});
