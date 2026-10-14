import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { runCLI } from '../src/cli.mjs';
import { MacKeychain } from '../src/keychain.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, DATE } from './fixture.mjs';

test('auth login waits for automatic sign-in and returns the completed login', async () => {
  const f = fixture();
  const progress = [];
  const result = await runCLI(['auth', 'login', '--timeout', '120'], {
    service: f.service, platform: 'darwin', stderr: { write: message => progress.push(message) },
    execute: async (command, args) => {
      assert.equal(command, '/usr/bin/open');
      assert.equal(new URL(args[0]).hostname, 'auth.gog.com');
      return { code: 0 };
    },
    browserLogin: async options => {
      assert.equal(options.timeoutMs, 120000);
      options.progress('Complete sign-in.');
      assert.equal(await options.openBrowser(f.service.loginURL()), true);
      return { authenticated: true, user_id: '123', storage: 'macos_keychain', method: 'browser_callback' };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.data.authenticated, true);
  assert.equal(result.result.data.next_command, undefined);
  assert.deepEqual(progress, ['Complete sign-in.\n']);
});

test('manual login remains available and invalid wait limits do not open a browser', async () => {
  const f = fixture();
  const deps = { service: f.service, execute: async () => { throw new Error('Must not open'); } };
  const manual = await runCLI(['auth', 'login', '--no-open'], deps);
  assert.equal(manual.exitCode, 0);
  assert.equal(manual.result.data.action_required, 'complete_manual_browser_login');
  assert.equal(manual.result.data.next_command, 'node bin/gog-achievements.mjs auth finish --clipboard');
  for (const value of ['oops', '0', '601', '1.5']) {
    assert.equal((await runCLI(['auth', 'login', '--timeout', value], deps)).exitCode, 2);
  }
});

test('the executable emits exactly one JSON object and a useful failure exit code', () => {
  for (const [args, expected] of [[['--help'], 0], [['unknown-command'], 2], [['queue', 'apply', '--yes'], 2]]) {
    const child = spawnSync(process.execPath, ['bin/gog-achievements.mjs', ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, expected);
    assert.equal(child.stderr, '');
    assert.equal(child.stdout.trim().split('\n').length, 1);
    assert.equal(typeof JSON.parse(child.stdout).ok, 'boolean');
  }
});

test('unknown and misplaced flags are rejected without using credentials', async () => {
  const service = { authStatus() { throw new Error('must not be called'); } };
  const wrong = await runCLI(['auth', 'status', '--yes'], { service });
  assert.equal(wrong.exitCode, 2);
  const secret = await runCLI(['auth', 'finish', '--token', 'secret-token'], { service });
  assert.equal(secret.exitCode, 2);
  assert.ok(!JSON.stringify(secret).includes('secret-token'));
});

test('CLI queue workflow previews by default and writes only with --yes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture();
  const deps = { service: f.service };
  assert.equal((await runCLI(['queue', 'create', '--game', GAME_ID, '--file', file, '--achievement', ACHIEVEMENT_ID, '--unlocked-at', DATE], deps)).exitCode, 0);
  assert.equal((await runCLI(['queue', 'apply', '--file', file], deps)).result.data.dry_run, true);
  assert.equal(f.writes.length, 0);
  const applied = await runCLI(['queue', 'apply', '--file', file, '--yes'], deps);
  assert.equal(applied.exitCode, 0);
  assert.equal(applied.result.data.results[0].status, 'restored');
  assert.equal(f.writes.length, 1);
  assert.ok(!String(await readFile(file)).includes('fake-account'));
});

test('partial apply returns exit 6 with the per-achievement report', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture({ rejectWrites: true });
  await runCLI(['queue', 'create', '--game', GAME_ID, '--file', file, '--achievement', ACHIEVEMENT_ID, '--unlocked-at', DATE], { service: f.service });
  const result = await runCLI(['queue', 'apply', '--file', file, '--yes'], { service: f.service });
  assert.equal(result.exitCode, 6);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.details.report.results[0].status, 'failed');
});

test('login stdin and clipboard inputs stay out of command results', async () => {
  const f = fixture();
  const result = await runCLI(['auth', 'finish', '--stdin'], { service: f.service, stdin: Readable.from(['test-secret-code']) });
  assert.equal(result.exitCode, 0);
  assert.ok(!JSON.stringify(result).includes('test-secret-code'));
  const clipboard = await runCLI(['auth', 'finish', '--clipboard'], {
    service: f.service, platform: 'darwin', execute: async () => ({ code: 0, stdout: 'https://embed.gog.com/on_login_success?code=test-secret-code' }),
  });
  assert.equal(clipboard.exitCode, 0);
  assert.ok(!JSON.stringify(clipboard).includes('test-secret-code'));
});

test('Keychain stores long credentials using native calls and checks the saved value', async () => {
  const calls = [];
  const session = { access_token: 'secret-access'.repeat(1000), refresh_token: 'secret-refresh', user_id: '123' };
  let secret = null;
  const vault = new MacKeychain({ platform: 'darwin', createEntry: async () => ({
    async setPassword(value, signal) { calls.push({ method: 'setPassword', signal }); secret = value; },
    async getPassword(signal) { calls.push({ method: 'getPassword', signal }); return secret; },
  }) });
  await vault.set(session);
  assert.deepEqual(calls.map(call => call.method), ['setPassword', 'getPassword']);
  assert.ok(calls.every(call => call.signal instanceof AbortSignal));
  assert.deepEqual(await vault.get(), session);
});

test('Keychain detects truncated stored data and does not report a successful login', async () => {
  const vault = new MacKeychain({ platform: 'darwin', createEntry: async () => ({
    async setPassword() {}, async getPassword() { return 'truncated'; },
  }) });
  await assert.rejects(vault.set({ access_token: 'test' }), error => error.code === 'KEYCHAIN_STORE_FAILED');
});

test('unexpected errors cannot expose credential-bearing messages', async () => {
  const result = await runCLI(['auth', 'status'], { service: { authStatus() { throw new Error('secret-access in URL'); } } });
  assert.equal(result.exitCode, 4);
  assert.ok(!JSON.stringify(result).includes('secret-access'));
});
