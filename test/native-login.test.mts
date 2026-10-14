import { fields } from '../src/validation.mjs';
import { gogError } from './assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { loginWithNativeWindow, runNativeHelper } from '../src/native-login.mjs';
import { LOGIN_REDIRECT } from '../src/api.mjs';
import { fixture } from './fixture.mjs';

void test("automatic sign-in keeps GOG's registered redirect and saves the captured code", async () => {
  const f = fixture();
  const result = await loginWithNativeWindow({
    service: f.service,
    timeoutMs: 120000,
    runHelper: async (config) => {
      const loginURL = new URL(config.login_url!);
      assert.equal(loginURL.hostname, 'auth.gog.com');
      assert.equal(loginURL.searchParams.get('redirect_uri'), LOGIN_REDIRECT);
      assert.equal(loginURL.searchParams.get('state'), config.state);
      assert.equal(config.timeout_ms, 120000);
      return { type: 'code', code: 'test-secret-code', state: config.state };
    },
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.method, 'native_webview');
  assert.equal(f.vault.saved.length, 1);
  assert.equal(f.calls[0]!.url.searchParams.get('redirect_uri'), LOGIN_REDIRECT);
  assert.ok(!JSON.stringify(result).includes('test-secret-code'));
  assert.ok(!JSON.stringify(result).includes('fake-refreshed-token'));
});

void test('GOG callbacks without echoed state are supported in the controlled window', async () => {
  const f = fixture();
  const result = await loginWithNativeWindow({
    service: f.service,
    runHelper: async () => ({ type: 'code', code: 'test-code', state: null }),
  });
  assert.equal(result.authenticated, true);
});

void test('mismatched states and invalid codes are blocked before the token request', async () => {
  for (const event of [
    { type: 'code', code: 'test-code', state: 'wrong-state' },
    { type: 'code', code: 'bad\ncode' },
    { type: 'unrecognized', code: 'test-code' },
  ]) {
    const f = fixture();
    await assert.rejects(
      loginWithNativeWindow({ service: f.service, runHelper: async () => event }),
      (error) => ['INVALID_LOGIN_STATE', 'INVALID_LOGIN_RESPONSE'].includes(gogError(error).code),
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.vault.saved.length, 0);
  }
});

void test('native cancellation, timeout and page errors keep raw helper data private', async () => {
  for (const code of ['AUTH_CANCELLED', 'AUTH_TIMEOUT', 'LOGIN_PAGE_FAILED', 'UNRECOGNIZED']) {
    const f = fixture();
    await assert.rejects(
      loginWithNativeWindow({
        service: f.service,
        runHelper: async () => ({ type: 'error', code, detail: 'private-helper-data' }),
      }),
      (error) => !gogError(error).message.includes('private-helper-data'),
    );
    assert.equal(f.vault.saved.length, 0);
  }
});

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killedWith: undefined as NodeJS.Signals | undefined,
    kill: (_signal: NodeJS.Signals) => {},
  });
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal: NodeJS.Signals) => {
    child.killedWith = signal;
    child.emit('close', null);
  };
  return child;
}

void test('native IPC captures private stdout, ignores diagnostics and uses no credential arguments', async () => {
  const result = await runNativeHelper(
    { login_url: 'public-login-url', state: 'test-state', timeout_ms: 1000 },
    {
      spawnImpl: (file, args) => {
        assert.match(file, /native[\\/]bin[\\/]gog-login(?:\.exe)?$/);
        assert.deepEqual(args, []);
        const child = fakeChild();
        queueMicrotask(() => {
          child.stderr.end('secret-URL must not be forwarded');
          child.stdout.end(JSON.stringify({ type: 'code', code: 'test-secret-code' }));
          child.emit('close', 0);
        });
        return child;
      },
    },
  );
  assert.equal(fields(result).code, 'test-secret-code');
});

void test('cancelling a pending native window kills the helper process', async () => {
  const abort = new AbortController();
  let child: ReturnType<typeof fakeChild> | undefined;
  const pending = runNativeHelper(
    { timeout_ms: 1000 },
    {
      signal: abort.signal,
      spawnImpl: () => {
        child = fakeChild();
        queueMicrotask(() => abort.abort());
        return child;
      },
    },
  );
  await assert.rejects(pending, (error) => gogError(error).code === 'AUTH_CANCELLED');
  assert.equal(child!.killedWith, 'SIGKILL');
});

void test('a missing helper gives a build instruction without a process error dump', async () => {
  await assert.rejects(
    runNativeHelper(
      { timeout_ms: 1000 },
      {
        spawnImpl: () => {
          const child = fakeChild();
          queueMicrotask(() => {
            child.emit('error', { code: 'ENOENT' });
            child.emit('close', -2);
          });
          return child;
        },
      },
    ),
    (error) =>
      gogError(error).code === 'NATIVE_HELPER_MISSING' &&
      gogError(error).message.includes('npm run build'),
  );
});

void test('malformed, oversized and failed native responses cannot become login codes', async () => {
  for (const [output, code, expected] of [
    ['', 0, 'AUTH_CANCELLED'],
    ['', 7, 'NATIVE_HELPER_FAILED'],
    ['private-code', 0, 'INVALID_LOGIN_RESPONSE'],
    [JSON.stringify({ type: 'code', code: 'private-code' }), 7, 'NATIVE_HELPER_FAILED'],
    ['é'.repeat(9000), 0, 'INVALID_LOGIN_RESPONSE'],
  ] satisfies [string, number, string][]) {
    await assert.rejects(
      runNativeHelper(
        { timeout_ms: 1000 },
        {
          spawnImpl: () => {
            const child = fakeChild();
            queueMicrotask(() => {
              child.stdout.end(output);
              child.emit('close', code);
            });
            return child;
          },
        },
      ),
      (error) =>
        gogError(error).code === expected && !gogError(error).message.includes('private-code'),
    );
  }
});

void test('native process timeout maps to an auth timeout and pre-cancellation never opens a window', async () => {
  const { GogError } = await import('../src/errors.mjs');
  await assert.rejects(
    runNativeHelper(
      { timeout_ms: 1000 },
      {
        execute: async () => {
          throw new GogError('PROCESS_TIMEOUT', 'private diagnostics');
        },
      },
    ),
    (error) =>
      gogError(error).code === 'AUTH_TIMEOUT' && !gogError(error).message.includes('private'),
  );
  await assert.rejects(
    runNativeHelper(
      { timeout_ms: 1000 },
      { signal: AbortSignal.abort(), spawnImpl: () => assert.fail('Must not open a window') },
    ),
    (error) => gogError(error).code === 'AUTH_CANCELLED',
  );
});
