import { fields } from '../src/validation.mjs';
import { successOutcome, failureData } from './assertions.mjs';
import { gogError } from './assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialVault, MacKeychain, WindowsVault, runProcess } from '../src/keychain.mjs';
import { nativeHelperPath } from '../src/assets.mjs';
import { runCLI } from '../src/cli.mjs';
import { fixture } from './fixture.mjs';
import { updateStub } from './update-fixture.mjs';
import { spawnFixtureProcess } from './process-fixture.mjs';

void test('each supported platform selects its own credential store and helper', () => {
  assert.ok(credentialVault({ platform: 'darwin' }) instanceof MacKeychain);
  assert.ok(credentialVault({ platform: 'win32' }) instanceof WindowsVault);
  assert.match(nativeHelperPath('darwin'), /gog-login$/);
  assert.match(nativeHelperPath('win32'), /gog-login\.exe$/);
  assert.throws(
    () => nativeHelperPath('linux'),
    (error) => gogError(error).code === 'UNSUPPORTED_PLATFORM',
  );
});

void test('Windows login completes in one command and doctor supports Windows', async () => {
  const f = fixture();
  f.vault.storage = 'windows_dpapi';
  const result = successOutcome(
    await runCLI(['auth', 'login'], {
      updates: updateStub(),
      service: f.service,
      platform: 'win32',
      nativeLogin: async (options) => {
        assert.equal(options.platform, 'win32');
        return options.service.importLogin('fake-refresh-token');
      },
    }),
    'auth login',
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.data.storage, 'windows_dpapi');
  const doctor = successOutcome(
    await runCLI(['doctor', '--json'], { service: f.service, platform: 'win32' }),
    'doctor',
  );
  assert.equal(doctor.result.data.supported, true);
  assert.equal(doctor.result.data.credentials_available, true);
  assert.equal(doctor.result.data.keychain_available, null);
});

void test('Windows clipboard login uses private helper output and no credential arguments', async () => {
  const f = fixture();
  const outcome = await runCLI(['auth', 'finish', '--clipboard'], {
    service: f.service,
    platform: 'win32',
    execute: async (path, args) => {
      assert.match(path, /gog-login\.exe$/);
      assert.deepEqual(args, ['--clipboard']);
      return { code: 0, stdout: 'https://embed.gog.com/on_login_success?code=private-code' };
    },
  });
  assert.equal(outcome.exitCode, 0);
  assert.ok(!JSON.stringify(outcome).includes('private-code'));
});

void test('Windows credential IPC supports full sessions, validates readback, and removes login', async () => {
  const calls: unknown[] = [];
  let stored: unknown = null;
  const vault = new WindowsVault({
    helperPath: 'gog-login.exe',
    execute: async (path, args, input) => {
      assert.equal(path, 'gog-login.exe');
      assert.deepEqual(args, ['--vault']);
      const request = fields(JSON.parse(input!));
      calls.push(request.action);
      if (request.action === 'set') stored = request.secret;
      if (request.action === 'remove') stored = null;
      return {
        code: 0,
        stdout: JSON.stringify({
          type: 'vault',
          ...(request.action === 'get' ? { secret: stored } : {}),
        }),
      };
    },
  });
  const session = {
    user_id: '123',
    access_token: 'private-access'.repeat(1000),
    refresh_token: 'private-refresh',
  };
  await vault.set(session);
  assert.deepEqual(await vault.get(), session);
  await vault.remove();
  assert.equal(await vault.get(), null);
  assert.deepEqual(calls, ['set', 'get', 'get', 'remove', 'get']);
});

void test('Windows vault masks helper errors and rejects truncated saved sessions', async () => {
  for (const execute of [
    async () => {
      throw new Error('private-token in command');
    },
    async () => ({ code: 7, stdout: 'private-token' }),
  ]) {
    await assert.rejects(
      new WindowsVault({ helperPath: 'gog-login.exe', execute }).get(),
      (error) =>
        gogError(error).exitCode === 7 && !gogError(error).message.includes('private-token'),
    );
  }
  const vault = new WindowsVault({
    helperPath: 'gog-login.exe',
    execute: async () => ({ code: 0, stdout: '{"type":"vault","secret":"truncated"}' }),
  });
  await assert.rejects(
    vault.set({ access_token: 'private-token' }),
    (error) => gogError(error).code === 'CREDENTIAL_STORE_FAILED',
  );
  await assert.rejects(vault.get(), (error) => gogError(error).code === 'INVALID_CREDENTIALS');
});

void test('unsupported platforms fail before opening sign-in', async () => {
  const outcome = await runCLI(['auth', 'login'], {
    service: fixture().service,
    platform: 'linux',
    nativeLogin: async () => {
      throw new Error('Must not open');
    },
  });
  assert.equal(outcome.exitCode, 7);
  assert.equal(failureData(outcome).code, 'UNSUPPORTED_PLATFORM');
});

void test('Mac background credential calls do not prompt and sign-in permission is bounded', async () => {
  const requests: Record<string, unknown>[] = [];
  let secret: unknown = null;
  const vault = new MacKeychain({
    platform: 'darwin',
    execute: async (path, args, input, options) => {
      assert.deepEqual(args, ['--vault']);
      const request = fields(JSON.parse(input!));
      requests.push({ interactive: request.interactive, timeout: options?.timeoutMs });
      if (request.action === 'set') secret = request.secret;
      return {
        code: 0,
        stdout: JSON.stringify({ type: 'vault', ...(request.action === 'get' ? { secret } : {}) }),
      };
    },
  });
  await vault.get();
  await vault.set({ user_id: '123' }, { interactive: true });
  await vault.get();
  assert.deepEqual(requests, [
    { interactive: false, timeout: 5000 },
    { interactive: true, timeout: 30000 },
    { interactive: true, timeout: 30000 },
    { interactive: false, timeout: 5000 },
  ]);
});

void test('a blocked native process is killed at the process deadline', async () => {
  const started = Date.now();
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], '', {
      timeoutMs: 50,
      spawnImpl: spawnFixtureProcess,
    }),
    (error) => gogError(error).code === 'PROCESS_TIMEOUT',
  );
  assert.ok(Date.now() - started < 2000);
});

void test('credential stores reject corrupt and missing helper fields without leaking secrets', async () => {
  for (const Vault of [MacKeychain, WindowsVault]) {
    for (const event of [
      { type: 'error', secret: 'private-secret' },
      { type: 'vault' },
      { type: 'vault', secret: 123 },
      { type: 'vault', secret: 'broken private-secret JSON' },
    ]) {
      await assert.rejects(
        new Vault({ execute: async () => ({ code: 0, stdout: JSON.stringify(event) }) }).get(),
        (error) =>
          ['KEYCHAIN_UNAVAILABLE', 'CREDENTIAL_STORE_UNAVAILABLE', 'INVALID_CREDENTIALS'].includes(
            gogError(error).code,
          ) && !gogError(error).message.includes('private-secret'),
      );
    }
  }
});

void test('interactive Keychain access does not enable prompts for concurrent background reads', async () => {
  let release: (() => void) | undefined;
  const pendingSet = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: Record<string, unknown>[] = [];
  const vault = new MacKeychain({
    execute: async (_path, _args, input) => {
      const request = fields(JSON.parse(input!));
      requests.push(request);
      if (request.action === 'set') await pendingSet;
      return {
        code: 0,
        stdout: JSON.stringify({
          type: 'vault',
          secret: request.interactive ? '{"user_id":"123"}' : null,
        }),
      };
    },
  });
  const signingIn = vault.set({ user_id: '123' }, { interactive: true });
  assert.equal(await vault.get(), null);
  release!();
  await signingIn;
  assert.deepEqual(
    requests.map((request) => request.interactive),
    [true, false, true],
  );
});

void test('unsupported credential operations fail with the same platform error', async () => {
  const vault = credentialVault({ platform: 'linux' });
  for (const operation of [() => vault.get(), () => vault.set({}), () => vault.remove()]) {
    await assert.rejects(operation(), (error) => gogError(error).code === 'UNSUPPORTED_PLATFORM');
  }
});
