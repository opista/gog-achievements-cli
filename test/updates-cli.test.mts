import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { runCLI } from '../src/cli.mjs';
import { formatOutput } from '../src/output.mjs';
import { GogError } from '../src/errors.mjs';
import { confirmUpdate } from '../src/adapters/updates/confirmation.mjs';
import type { UpdateCheck } from '../src/application/update-ports.mjs';
import { failureData, serviceStub, successData } from './assertions.mjs';
import { updateStub } from './update-fixture.mjs';

const available: UpdateCheck = {
  current_version: '0.3.0',
  latest_version: '0.4.0',
  update_available: true,
  can_update: true,
  release_url: 'https://github.com/opista/gog-achievements-cli/releases/tag/v0.4.0',
};

void test('manual checks report availability without confirmation, installation or credentials', async () => {
  const updates = updateStub({ check: async () => available });
  const result = await runCLI(['self', 'update', '--check', '--json'], {
    service: serviceStub(),
    updates,
    confirm: async () => assert.fail('A check must not prompt'),
  });
  assert.deepEqual(successData(result, 'self update'), available);
  assert.deepEqual(JSON.parse(formatOutput(result)), { ok: true, data: available });
  assert.match(
    formatOutput({ ...result, format: 'text' }),
    /Installed version: 0.3.0[\s\S]*Latest version: 0.4.0[\s\S]*self update/,
  );
  const help = await runCLI(['self'], { service: serviceStub(), updates });
  assert.match(formatOutput(help), /self update/);
  const command = await runCLI(['self', 'update', '--help'], { service: serviceStub(), updates });
  assert.match(formatOutput(command), /--check/);
  assert.match(formatOutput(command), /Install the CLI update without an interactive/);
});

void test('manual updates require confirmation and support explicit noninteractive approval', async () => {
  let installs = 0;
  let prompts = 0;
  const updates = updateStub({
    check: async () => available,
    install: async () => {
      installs++;
      return { ...available, updated: true, backup_directory: '/previous' };
    },
  });
  const deps = {
    service: serviceStub(),
    updates,
    confirm: async (question: string) => {
      prompts++;
      assert.match(question, /0.3.0 to 0.4.0/);
      return true;
    },
  };
  const installed = await runCLI(['self', 'update'], deps);
  assert.equal(installed.exitCode, 0);
  assert.match(formatOutput(installed), /Updated gog-achievements from 0.3.0 to 0.4.0/);
  assert.match(formatOutput(installed), /Previous tool files: \/previous/);
  assert.equal(prompts, 1);
  const json = await runCLI(['self', 'update', '--yes', '--json'], deps);
  assert.equal(json.exitCode, 0);
  assert.equal(installs, 2);
  assert.equal(prompts, 1);
  const declined = await runCLI(['self', 'update'], { ...deps, confirm: async () => false });
  const unattended = await runCLI(['self', 'update', '--json'], deps);
  for (const result of [declined, unattended])
    assert.equal(failureData(result).code, 'UPDATE_CONFIRMATION_REQUIRED');
  assert.equal(installs, 2);
  assert.equal(prompts, 1);
});

void test('no update and unsupported installs do not prompt or install', async () => {
  const deps = { service: serviceStub(), confirm: async () => assert.fail('Must not prompt') };
  const current = await runCLI(['self', 'update'], { ...deps, updates: updateStub() });
  assert.match(formatOutput(current), /up to date/);
  assert.equal(
    'updated' in successData(current, 'self update') &&
      successData(current, 'self update').update_available,
    false,
  );
  for (const instructions of ['Use your package manager.', undefined]) {
    const data = { ...available, can_update: false, ...(instructions ? { instructions } : {}) };
    const updates = updateStub({ check: async () => data });
    const check = await runCLI(['self', 'update', '--check'], { ...deps, updates });
    if (instructions) assert.match(formatOutput(check), /Use your package manager/);
    const result = await runCLI(['self', 'update', '--yes'], { ...deps, updates });
    assert.equal(result.exitCode, 7);
    assert.equal(failureData(result).code, 'SELF_UPDATE_UNSUPPORTED');
  }
  const invalid = await runCLI(['self', 'update', '--check', '--yes'], {
    ...deps,
    updates: updateStub({ check: async () => assert.fail('Invalid flags must not check') }),
  });
  assert.equal(invalid.exitCode, 2);
});

void test('login notices use stderr only after successful text sign-in', async () => {
  const messages: string[] = [];
  let checks = 0;
  const deps = {
    service: serviceStub(),
    platform: 'darwin',
    stderr: { write: (value: string) => messages.push(value) },
    nativeLogin: async () => ({ authenticated: true, user_id: '123' }),
    updates: updateStub({
      check: async (options) => {
        checks++;
        assert.equal(options?.timeoutMs, 2000);
        return available;
      },
    }),
  };
  const result = await runCLI(['auth', 'login'], deps);
  assert.deepEqual(successData(result, 'auth login'), { authenticated: true, user_id: '123' });
  assert.equal(checks, 1);
  assert.deepEqual(messages, [
    'A newer version is available (0.4.0).\nRun: gog-achievements self update\n',
  ]);
  assert.ok(!formatOutput(result).includes('version'));
  messages.length = 0;
  const json = await runCLI(['auth', 'login', '--json'], deps);
  assert.equal(checks, 1);
  assert.deepEqual(messages, []);
  assert.deepEqual(JSON.parse(formatOutput(json)), {
    ok: true,
    data: { authenticated: true, user_id: '123' },
  });
  await runCLI(['auth', 'login', '--no-open'], {
    ...deps,
    service: serviceStub({ loginURL: () => 'fixture' }),
  });
  await runCLI(['auth', 'login'], { ...deps, nativeLogin: async () => ({ authenticated: false }) });
  const cancelled = await runCLI(['auth', 'login'], {
    ...deps,
    nativeLogin: async () => {
      throw new GogError('AUTH_CANCELLED', 'Cancelled', 3);
    },
  });
  assert.equal(cancelled.exitCode, 3);
  assert.equal(checks, 1);
});

void test('unavailable, current, or app-managed update checks never affect successful login', async () => {
  for (const updates of [
    updateStub(),
    updateStub({ check: async () => ({ ...available, can_update: false }) }),
    updateStub({
      check: async () => {
        throw new Error('offline or timed out');
      },
    }),
  ]) {
    const messages: string[] = [];
    const result = await runCLI(['auth', 'login'], {
      updates,
      service: serviceStub(),
      platform: 'darwin',
      stderr: { write: (value) => messages.push(value) },
      nativeLogin: async () => ({ authenticated: true }),
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(messages, []);
  }
});

void test('other commands and help never check releases', async () => {
  const updates = updateStub({ check: async () => assert.fail('Unexpected release request') });
  const service = serviceStub({ authStatus: async () => ({ authenticated: true }) });
  for (const args of [
    ['--help'],
    ['auth', 'status'],
    ['doctor'],
    ['self', 'update', '--help'],
    ['auth', 'login', '--help'],
    ['unknown'],
  ])
    await runCLI(args, { updates, service });
});

void test('terminal confirmation requires an affirmative answer and never reads a pipe', async () => {
  const messages: string[] = [];
  assert.equal(
    await confirmUpdate('question', Readable.from(['yes\n']), {
      write: (value) => messages.push(value),
    }),
    false,
  );
  assert.equal(messages.length, 0);
  for (const answer of ['yes', 'Y', 'n', '']) {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const response = confirmUpdate('Confirm? ', input, { write: (value) => messages.push(value) });
    input.end(`${answer}\n`);
    assert.equal(await response, ['yes', 'Y'].includes(answer));
  }
  assert.equal(messages.length, 4);
});
