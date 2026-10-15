import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { newerVersion, selectRelease } from '../src/domain/updates.mjs';
import { downloadBytes, latestRelease } from '../src/adapters/updates/release.mjs';
import { releaseMetadata } from './update-fixture.mjs';
import { gogError } from './assertions.mjs';

void test('versions compare numerically, preserve downgrades, and recognise a stable successor', () => {
  for (const [current, latest, newer] of [
    ['0.3.0', '0.4.0', true],
    ['0.9.0', '0.10.0', true],
    ['1.9.0', '2.0.0', true],
    ['2.0.0', '1.9.0', false],
    ['0.3.1', '0.3.0', false],
    ['0.3.0', '0.3.0', false],
    ['0.4.0-rc.1', '0.4.0', true],
    ['0.4.0+build.1', '0.4.0', false],
    ['0.4.0-rc.1', '0.4.0-rc.1', false],
  ] satisfies [string, string, boolean][])
    assert.equal(newerVersion(current, latest), newer);
  for (const version of ['0.03.0', 'v1.0.0', 'oops', '9007199254740992.0.0'])
    assert.throws(() => newerVersion(version, '0.4.0'));
});

void test('only complete stable packages for the current OS and architecture are selected', () => {
  for (const [platform, target] of [
    ['darwin', 'macos'],
    ['win32', 'windows'],
  ])
    for (const architecture of ['arm64', 'x64']) {
      const release = selectRelease(
        releaseMetadata('0.4.0', `${target}-${architecture}`),
        platform!,
        architecture,
      );
      assert.equal(release.version, '0.4.0');
      assert.equal(
        release.layout,
        platform === 'darwin' && architecture === 'x64'
          ? 'native_launcher_with_private_runtime'
          : 'single_executable',
      );
      assert.match(
        release.archive_url,
        /github.com\/opista\/gog-achievements-cli\/releases\/download\/v0.4.0\//,
      );
    }
  for (const metadata of [
    null,
    {},
    { ...releaseMetadata(), draft: true },
    { ...releaseMetadata(), prerelease: true },
    { ...releaseMetadata(), tag_name: 'v0.4.0-rc.1' },
    { ...releaseMetadata(), tag_name: 'v00.4.0' },
    { ...releaseMetadata(), assets: null },
    { ...releaseMetadata(), assets: [] },
    { ...releaseMetadata(), assets: [...releaseMetadata().assets, ...releaseMetadata().assets] },
    {
      ...releaseMetadata(),
      assets: releaseMetadata().assets.map((asset) => ({ ...asset, state: 'new' })),
    },
  ])
    assert.throws(() => selectRelease(metadata, 'darwin', 'arm64'));
  for (const [platform, architecture] of [
    ['linux', 'arm64'],
    ['darwin', 'ia32'],
  ])
    assert.throws(
      () => selectRelease(releaseMetadata(), platform!, architecture!),
      (error) => gogError(error).code === 'UNSUPPORTED_PLATFORM',
    );
});

void test('release requests send no account credentials and use bounded public metadata', async () => {
  const release = await latestRelease('darwin', 'arm64', {
    request: async (url, init) => {
      assert.match(
        url,
        /^https:\/\/api.github.com\/repos\/opista\/gog-achievements-cli\/releases\/latest$/,
      );
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers.Cookie, undefined);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'manual');
      assert.ok(init.signal);
      return new Response(JSON.stringify(releaseMetadata()));
    },
  });
  assert.equal(release.version, '0.4.0');
  await assert.rejects(
    latestRelease('darwin', 'arm64', { request: async () => new Response('invalid JSON') }),
    (error) => gogError(error).code === 'INVALID_UPDATE_RELEASE',
  );
});

void test('downloads validate redirects, HTTP results and streamed size limits', async () => {
  let calls = 0;
  const bytes = await downloadBytes('https://github.com/opista/archive.zip', 10, {
    request: async () => {
      calls++;
      return calls === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/package' },
          })
        : new Response('zip');
    },
  });
  assert.equal(bytes.toString(), 'zip');
  assert.equal(calls, 2);
  for (const url of [
    'http://github.com/archive',
    'https://github.com:444/archive',
    'https://user:pass@github.com/archive',
    'https://evil.test/archive',
  ])
    await assert.rejects(
      downloadBytes(url, 10, { request: async () => assert.fail('Unsafe URL') }),
    );
  for (const response of [
    new Response('failure', { status: 403 }),
    new Response('large', { headers: { 'content-length': '100' } }),
    new Response('large'),
    new Response(null),
    new Response(null, { status: 302 }),
    new Response(null, { status: 302, headers: { location: 'https://evil.test/package' } }),
  ])
    await assert.rejects(
      downloadBytes('https://github.com/archive', 3, { request: async () => response }),
    );
  await assert.rejects(
    downloadBytes('https://api.github.com/repos/example', 10, {
      request: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://github.com/untrusted-metadata' },
        }),
    }),
  );
  await assert.rejects(
    downloadBytes('https://github.com/archive', 10, {
      request: async () => new Response(null, { status: 302, headers: { location: '/loop' } }),
    }),
  );
  await assert.rejects(
    downloadBytes('https://github.com/archive', 10, {
      request: async () => {
        throw new Error('private transport diagnostics');
      },
    }),
    (error) => {
      assert.ok(!gogError(error).message.includes('private'));
      return true;
    },
  );
});

void test('timeouts cancel a stalled response body from a local HTTP fixture', async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.flushHeaders();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await assert.rejects(
    downloadBytes('https://github.com/archive', 100, {
      timeoutMs: 30,
      request: (_url, init) => fetch(`http://127.0.0.1:${address.port}`, init),
    }),
    (error) => gogError(error).code === 'UPDATE_REQUEST_FAILED',
  );
});
