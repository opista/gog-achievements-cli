import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { extractUpdate, validatePackage } from '../src/adapters/updates/archive.mjs';
import {
  installation,
  installPackage,
  installPackageResult,
  preparePackage,
  verifyChecksum,
  verifyExecutable,
} from '../src/adapters/updates/install.mjs';
import { CLIUpdater } from '../src/adapters/updates/updater.mjs';
import { packageFixture, releaseMetadata, zipFixture } from './update-fixture.mjs';
import { GogError } from '../src/domain/errors.mjs';
import { gogError } from './assertions.mjs';

async function temp(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'gog-update-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

const noVerify = async () => {};

async function installedFixture(t: TestContext, platform = 'darwin', architecture = 'arm64') {
  const directory = await temp(t);
  const previous = packageFixture(platform, architecture, '0.3.0');
  const next = packageFixture(platform, architecture);
  await extractUpdate(previous.bytes, directory, previous.release);
  const executable = join(
    directory,
    previous.release.layout === 'native_launcher_with_private_runtime'
      ? 'lib/node'
      : platform === 'darwin'
        ? 'gog-achievements'
        : 'gog-achievements.exe',
  );
  const checksum = Buffer.from(
    `${createHash('sha256').update(next.bytes).digest('hex')}  ${next.release.archive}\n`,
  );
  return { directory, executable, previous, next, checksum };
}

void test('all four distribution layouts extract and validate their full package', async (t) => {
  for (const platform of ['darwin', 'win32'])
    for (const architecture of ['arm64', 'x64']) {
      const f = await installedFixture(t, platform, architecture);
      assert.deepEqual(
        await installation(f.previous.release, { packaged: true, executable: f.executable }),
        { directory: f.directory },
      );
      assert.match(
        (await installation(f.previous.release, { packaged: false })).instructions!,
        /original installation method/,
      );
      assert.equal(
        (
          await installation(f.previous.release, {
            packaged: true,
            executable: join(f.directory, 'missing'),
          })
        ).directory,
        undefined,
      );
      const copied = join(f.directory, 'renamed');
      await copyFile(f.executable, copied);
      assert.equal(
        (await installation(f.previous.release, { packaged: true, executable: copied })).directory,
        undefined,
      );
    }
});

void test('desktop-managed CLI packages cannot update themselves', async (t) => {
  const root = await temp(t);
  for (const suffix of [
    'Example.app/Contents/Resources/cli',
    'resources/cli',
    'resources/cli/windows-x64',
  ]) {
    const directory = join(root, suffix);
    await mkdir(directory, { recursive: true });
    const executable = join(directory, 'gog-achievements');
    await writeFile(executable, 'placeholder');
    const result = await installation(packageFixture().release, { packaged: true, executable });
    assert.match(result.instructions!, /desktop app/);
    assert.equal(result.directory, undefined);
  }
});

void test('checksum mismatches and malformed packages fail before file replacement', async (t) => {
  const f = await installedFixture(t);
  assert.throws(
    () => verifyChecksum(f.next.bytes, Buffer.from('0'.repeat(64)), f.next.release),
    (error) => gogError(error).code === 'UPDATE_CHECKSUM_MISMATCH',
  );
  verifyChecksum(f.next.bytes, f.checksum, f.next.release);
  await assert.rejects(
    preparePackage(f.next.bytes, Buffer.from('wrong'), await temp(t), f.next.release),
  );
  const staging = await temp(t);
  await preparePackage(f.next.bytes, f.checksum, staging, f.next.release);
  await writeFile(join(staging, 'build.json'), '{}');
  await assert.rejects(validatePackage(staging, f.next.release));
  await writeFile(join(staging, 'build.json'), Buffer.alloc(65537));
  await assert.rejects(validatePackage(staging, f.next.release));
  await writeFile(join(staging, 'build.json'), f.next.files.get('build.json')!);
  await writeFile(join(staging, 'gog-achievements'), '');
  await assert.rejects(validatePackage(staging, f.next.release));
  await writeFile(join(staging, 'gog-achievements'), 'new');
  await chmod(join(staging, 'gog-achievements'), 0o644);
  if (process.platform !== 'win32') await assert.rejects(validatePackage(staging, f.next.release));
});

void test('archives reject traversal, links, collisions, unsupported data and missing files', async (t) => {
  const f = packageFixture();
  const root = f.release.archive.slice(0, -4);
  const malformed = [
    [{ name: `${root}/../outside`, bytes: Buffer.from('bad') }],
    [{ name: '/absolute', bytes: Buffer.from('bad') }],
    [{ name: `${root}/CON.txt`, bytes: Buffer.from('bad') }],
    [{ name: `${root}/licenses/bad.`, bytes: Buffer.from('bad') }],
    [{ name: `${root}/licenses\\outside`, bytes: Buffer.from('bad') }],
    [{ name: `${root}/licenses/bad\u0001`, bytes: Buffer.from('bad') }],
    [{ name: `${root}/licenses/link`, mode: 0o120777 }],
    [{ name: `${root}/queue.json`, bytes: Buffer.from('must not overwrite queues') }],
    [{ name: `${root}/README.md`, flags: 1 }],
    [{ name: `${root}/README.md`, method: 9 }],
    [{ name: `${root}/README.md`, declaredSize: 256 * 1024 * 1024 + 1, method: 8 }],
    [{ name: `${root}/README.md`, declaredSize: 1001, method: 8 }],
    [{ name: `${root}/licenses/`, bytes: Buffer.from('directory data') }],
    [{ name: `${root}/LICENSE` }, { name: `${root}/license` }],
    [{ name: `${root}/licenses`, bytes: Buffer.from('file') }, { name: `${root}/licenses/child` }],
    [{ name: 'wrong-root/LICENSE' }],
  ];
  for (const items of malformed)
    await assert.rejects(extractUpdate(zipFixture(items), await temp(t), f.release));
  await assert.rejects(extractUpdate(Buffer.from('not a ZIP'), await temp(t), f.release));
  await assert.rejects(
    extractUpdate(zipFixture([{ name: `${root}/LICENSE` }]), await temp(t), f.release),
  );
  const compressed = f.items.map((item) => ({ ...item, method: 8 }));
  await extractUpdate(zipFixture(compressed), await temp(t), f.release);
  const excessive = Array.from({ length: 1025 }, (_, index) => ({
    name: `${root}/licenses/${index}`,
  }));
  await assert.rejects(extractUpdate(zipFixture(excessive), await temp(t), f.release));
});

void test('AppleDouble files from existing Mac releases are validated and skipped', async (t) => {
  const f = packageFixture();
  const root = f.release.archive.slice(0, -4);
  const directory = await temp(t);
  const metadata = [
    { name: `${root}/._gog-achievements`, bytes: Buffer.from('resource data') },
    { name: `${root}/._licenses`, bytes: Buffer.from('directory resource data') },
    { name: `${root}/licenses/._NODE-LICENSE.txt`, bytes: Buffer.from('license resource data') },
  ];
  await extractUpdate(zipFixture([...f.items, ...metadata]), directory, f.release);
  assert.equal(
    (await readdir(directory)).some((name) => name.startsWith('._')),
    false,
  );
  assert.equal(
    (await readdir(join(directory, 'licenses'))).some((name) => name.startsWith('._')),
    false,
  );
  assert.deepEqual(
    await readFile(join(directory, 'gog-achievements')),
    f.files.get('gog-achievements'),
  );
  for (const item of [
    { name: `${root}/._gog-achievements`, mode: 0o120777 },
    { name: `${root}/._queue.json`, bytes: Buffer.from('unexpected metadata') },
  ])
    await assert.rejects(extractUpdate(zipFixture([...f.items, item]), await temp(t), f.release));
});

void test('replacement preserves queues, updates Intel runtime files, and retains a full backup', async (t) => {
  for (const [platform, architecture] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'x64'],
  ]) {
    const f = await installedFixture(t, platform, architecture);
    const queue = Buffer.from('{"keep":"my queue"}\n');
    await writeFile(join(f.directory, 'queue.json'), queue);
    const verified: string[] = [];
    const backup = await installPackage(
      f.directory,
      f.next.release,
      (staging) => preparePackage(f.next.bytes, f.checksum, staging, f.next.release),
      {
        verify: async (directory) => {
          verified.push(directory);
          await validatePackage(directory, f.next.release);
        },
      },
    );
    assert.equal(verified.length, 2);
    assert.equal(verified[1], f.directory);
    for (const [path, bytes] of f.next.files)
      assert.deepEqual(await readFile(join(f.directory, path)), bytes);
    for (const [path, bytes] of f.previous.files)
      assert.deepEqual(await readFile(join(backup, path)), bytes);
    assert.deepEqual(await readFile(join(f.directory, 'queue.json')), queue);
    assert.ok(!(await readdir(f.directory)).includes('.gog-achievements-update.lock'));
  }
});

void test('verification or replacement failures restore previous files and remove the update lock', async (t) => {
  for (const failure of ['prepare', 'staged-verification', 'move', 'installed-verification']) {
    const f = await installedFixture(t);
    let verifications = 0;
    let moves = 0;
    await assert.rejects(
      installPackage(
        f.directory,
        f.next.release,
        async (staging) => {
          if (failure === 'prepare') throw new Error('download failed');
          await preparePackage(f.next.bytes, f.checksum, staging, f.next.release);
        },
        {
          verify: async () => {
            verifications++;
            if (
              (failure === 'staged-verification' && verifications === 1) ||
              (failure === 'installed-verification' && verifications === 2)
            )
              throw new Error('does not start');
          },
          move: async (from, to) => {
            moves++;
            if (failure === 'move' && moves === 4) throw new Error('move failed');
            await rename(from, to);
          },
        },
      ),
      (error) => gogError(error).code === 'UPDATE_INSTALL_FAILED',
    );
    for (const [path, bytes] of f.previous.files)
      assert.deepEqual(await readFile(join(f.directory, path)), bytes);
    assert.equal(
      (await readdir(f.directory)).some((path) => path.startsWith('.gog-achievements-')),
      false,
    );
  }
});

void test('cleanup failures preserve a verified install and still release the lock', async (t) => {
  const f = await installedFixture(t);
  const attempts: string[] = [];
  const result = await installPackageResult(
    f.directory,
    f.next.release,
    (staging) => preparePackage(f.next.bytes, f.checksum, staging, f.next.release),
    {
      verify: noVerify,
      cleanup: async (path, options) => {
        attempts.push(String(path));
        if (String(path).includes('.gog-achievements-update-')) throw new Error('cleanup failed');
        await rm(path, options);
      },
    },
  );
  await validatePackage(f.directory, f.next.release);
  await validatePackage(result.backup_directory, f.previous.release);
  assert.equal(result.cleanup_paths.length, 1);
  assert.ok(attempts.includes(join(f.directory, '.gog-achievements-update.lock')));
  await assert.rejects(access(join(f.directory, '.gog-achievements-update.lock')));
});

void test('cleanup failures keep the original transaction error and attempt all paths', async (t) => {
  const f = await installedFixture(t);
  const original = new GogError('UPDATE_VERIFICATION_FAILED', 'Fixture verification failed.', 7);
  const attempts: string[] = [];
  let verifications = 0;
  await assert.rejects(
    installPackageResult(
      f.directory,
      f.next.release,
      (staging) => preparePackage(f.next.bytes, f.checksum, staging, f.next.release),
      {
        verify: async () => {
          if (++verifications === 2) throw original;
        },
        cleanup: async (path, options) => {
          attempts.push(String(path));
          if (!String(path).endsWith('.lock')) throw new Error('cleanup failed');
          await rm(path, options);
        },
      },
    ),
    (error) => {
      assert.equal(error, original);
      assert.equal(original.details?.cleanup_paths instanceof Array, true);
      assert.equal((original.details?.cleanup_paths as string[]).length, 2);
      return true;
    },
  );
  assert.equal(attempts.length, 3);
  await validatePackage(f.directory, f.previous.release);
  await assert.rejects(access(join(f.directory, '.gog-achievements-update.lock')));
});

void test('failed lock cleanup is reported without changing the installed version', async (t) => {
  const f = await installedFixture(t);
  const lock = join(f.directory, '.gog-achievements-update.lock');
  const result = await installPackageResult(
    f.directory,
    f.next.release,
    (staging) => preparePackage(f.next.bytes, f.checksum, staging, f.next.release),
    {
      verify: noVerify,
      cleanup: async (path, options) => {
        if (String(path) === lock) throw new Error('lock cleanup failed');
        await rm(path, options);
      },
    },
  );
  assert.deepEqual(result.cleanup_paths, [lock]);
  await validatePackage(f.directory, f.next.release);
  await access(lock);
});

void test('concurrent updates and non-writable locations fail with useful errors', async (t) => {
  const f = await installedFixture(t);
  const lock = join(f.directory, '.gog-achievements-update.lock');
  await writeFile(lock, 'existing updater');
  await assert.rejects(
    installPackage(f.directory, f.next.release, async () => assert.fail('Must not prepare')),
    (error) => gogError(error).code === 'UPDATE_LOCKED',
  );
  assert.equal(await readFile(lock, 'utf8'), 'existing updater');
  await assert.rejects(
    installPackage(join(f.directory, 'missing'), f.next.release, async () =>
      assert.fail('Must not prepare'),
    ),
    (error) => gogError(error).code === 'UPDATE_INSTALL_FAILED',
  );
});

void test('recovery errors retain the backup and lock despite staging cleanup failure', async (t) => {
  const f = await installedFixture(t);
  let moves = 0;
  await assert.rejects(
    installPackage(
      f.directory,
      f.next.release,
      (staging) => preparePackage(f.next.bytes, f.checksum, staging, f.next.release),
      {
        verify: noVerify,
        move: async (from, to) => {
          moves++;
          if (moves >= 3) throw new Error('disk unavailable');
          await rename(from, to);
        },
        cleanup: async () => {
          throw new Error('cleanup unavailable');
        },
      },
    ),
    (error) => {
      const problem = gogError(error);
      assert.equal(problem.code, 'UPDATE_RECOVERY_REQUIRED');
      assert.equal(typeof problem.details?.backup_directory, 'string');
      return true;
    },
  );
  const backup = (await readdir(f.directory)).find((entry) =>
    entry.startsWith('.gog-achievements-backup-'),
  );
  assert.ok(backup);
  await access(join(f.directory, '.gog-achievements-update.lock'));
  assert.equal(
    await readFile(join(f.directory, backup, 'gog-achievements'), 'utf8'),
    'executable 0.3.0',
  );
});

void test(
  'symlinked tool files are not replaced',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await installedFixture(t);
    const outside = join(await temp(t), 'readme');
    await writeFile(outside, 'keep outside');
    await rm(join(f.directory, 'README.md'));
    await symlink(outside, join(f.directory, 'README.md'));
    await assert.rejects(
      installPackage(
        f.directory,
        f.next.release,
        (staging) => preparePackage(f.next.bytes, f.checksum, staging, f.next.release),
        { verify: noVerify },
      ),
    );
    assert.equal(await readFile(outside, 'utf8'), 'keep outside');
    assert.equal((await lstat(join(f.directory, 'README.md'))).isSymbolicLink(), true);
  },
);

void test('executable verification checks the version and strips Node startup injection', async () => {
  for (const platform of ['darwin', 'win32']) {
    await verifyExecutable(
      '/fixture',
      { platform, version: '0.4.0' },
      async (file, args, options) => {
        assert.equal(
          file,
          join('/fixture', platform === 'darwin' ? 'gog-achievements' : 'gog-achievements.exe'),
        );
        assert.deepEqual(args, ['--help', '--json']);
        assert.equal(options.env.NODE_OPTIONS, undefined);
        assert.equal(options.env.NODE_PATH, undefined);
        assert.equal(options.timeout, 10000);
        return {
          stdout: JSON.stringify({
            ok: true,
            data: { name: 'gog-achievements', version: '0.4.0' },
          }),
        };
      },
    );
  }
  await assert.rejects(
    verifyExecutable('/fixture', { platform: 'darwin', version: '0.4.0' }, async () => ({
      stdout: '{"ok":false}',
    })),
    (error) => gogError(error).code === 'UPDATE_VERIFICATION_FAILED',
  );
});

void test('the updater checks, downloads, verifies and installs using only a local release server', async (t) => {
  const f = await installedFixture(t);
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    assert.equal(req.headers.authorization, undefined);
    if (req.url!.endsWith('/latest')) res.end(JSON.stringify(releaseMetadata()));
    else if (req.url!.endsWith('.sha256')) res.end(f.checksum);
    else res.end(f.next.bytes);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const options = {
    version: '0.3.0',
    platform: 'darwin',
    architecture: 'arm64',
    packaged: true,
    executable: f.executable,
    verify: noVerify,
    request: (url: string, init: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init),
  };
  const updater = new CLIUpdater(options);
  await assert.rejects(
    updater.install(),
    (error) => gogError(error).code === 'UPDATE_CHECK_REQUIRED',
  );
  const check = await updater.check();
  assert.equal(check.update_available, true);
  assert.equal(check.can_update, true);
  assert.equal(requests.length, 1);
  const result = await updater.install();
  assert.equal(result.updated, true);
  assert.equal(requests.length, 3);
  assert.ok(result.backup_directory);
  await access(result.backup_directory);
  await assert.rejects(updater.install());
  const current = new CLIUpdater({ ...options, version: '0.4.0' });
  assert.equal((await current.check()).update_available, false);
  assert.equal((await current.install()).updated, false);
  const source = new CLIUpdater({ ...options, version: '0.3.0', packaged: false });
  assert.equal((await source.check()).can_update, false);
  await assert.rejects(
    source.install(),
    (error) => gogError(error).code === 'SELF_UPDATE_UNSUPPORTED',
  );
  const defaults = new CLIUpdater({
    request: async () =>
      new Response(
        JSON.stringify(
          releaseMetadata(
            '0.3.0',
            `${process.platform === 'darwin' ? 'macos' : 'windows'}-${process.arch}`,
          ),
        ),
      ),
  });
  assert.equal((await defaults.check()).can_update, false);
});

void test('updater reports cleanup instructions while confirming the installed release', async (t) => {
  const f = await installedFixture(t);
  const updater = new CLIUpdater({
    version: '0.3.0',
    platform: 'darwin',
    architecture: 'arm64',
    packaged: true,
    executable: f.executable,
    verify: noVerify,
    request: async (url) =>
      new Response(
        url.endsWith('/latest')
          ? JSON.stringify(releaseMetadata())
          : url.endsWith('.sha256')
            ? f.checksum
            : f.next.bytes,
      ),
    cleanup: async (path, options) => {
      if (String(path).includes('.gog-achievements-update-')) throw new Error('cleanup failed');
      await rm(path, options);
    },
  });
  await updater.check();
  const result = await updater.install();
  assert.equal(result.updated, true);
  assert.equal(result.current_version, '0.4.0');
  assert.match(result.instructions!, /update is installed, but cleanup is incomplete/);
  assert.match(result.instructions!, /gog-achievements-update-/);
  await assert.rejects(access(join(f.directory, '.gog-achievements-update.lock')));
});

void test('file-backed archives retain validation and release their file handle', async (t) => {
  const directory = await temp(t);
  const f = packageFixture();
  const archive = join(directory, 'archive.zip');
  await writeFile(archive, f.bytes);
  const output = join(directory, 'extracted');
  await mkdir(output);
  await extractUpdate(archive, output, f.release);
  await validatePackage(output, f.release);
  await rm(archive);
  await writeFile(archive, zipFixture([{ name: `${f.release.archive.slice(0, -4)}/../outside` }]));
  await assert.rejects(
    extractUpdate(archive, output, f.release),
    (error) => gogError(error).code === 'INVALID_UPDATE_ARCHIVE',
  );
  await rm(archive);
});
