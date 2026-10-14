import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { runCLI } from '../src/cli.mjs';
import { formatOutput } from '../src/output.mjs';
import { MacKeychain } from '../src/keychain.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, DATE } from './fixture.mjs';

test('auth login waits for automatic sign-in and returns the completed login', async () => {
  const f = fixture();
  const progress = [];
  const result = await runCLI(['auth', 'login', '--timeout', '120'], {
    service: f.service,
    platform: 'darwin',
    stderr: { write: (message) => progress.push(message) },
    nativeLogin: async (options) => {
      assert.equal(options.timeoutMs, 120000);
      options.progress('Complete sign-in.');
      return {
        authenticated: true,
        user_id: '123',
        storage: 'macos_keychain',
        method: 'native_webview',
      };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.data.authenticated, true);
  assert.equal(result.result.data.next_command, undefined);
  assert.deepEqual(progress, ['Complete sign-in.\n']);
});

test('manual login remains available and invalid wait limits do not open a browser', async () => {
  const f = fixture();
  const deps = {
    service: f.service,
    execute: async () => {
      throw new Error('Must not open');
    },
  };
  const manual = await runCLI(['auth', 'login', '--no-open'], deps);
  assert.equal(manual.exitCode, 0);
  assert.equal(manual.result.data.action_required, 'complete_manual_browser_login');
  assert.equal(
    manual.result.data.next_command,
    'node bin/gog-achievements.mjs auth finish --clipboard',
  );
  for (const value of ['oops', '0', '601', '1.5']) {
    assert.equal((await runCLI(['auth', 'login', '--timeout', value], deps)).exitCode, 2);
  }
});

test('--json emits exactly one JSON object and keeps failure exit codes', () => {
  for (const [args, expected] of [
    [['--help'], 0],
    [['unknown-command'], 2],
    [['queue', 'apply', '--yes'], 2],
  ]) {
    const child = spawnSync(process.execPath, ['bin/gog-achievements.mjs', ...args, '--json'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(child.status, expected);
    assert.equal(child.stderr, '');
    assert.equal(child.stdout.trim().split('\n').length, 1);
    assert.equal(typeof JSON.parse(child.stdout).ok, 'boolean');
  }
});

test('default help is readable and default errors use stderr', () => {
  const help = spawnSync(process.execPath, ['bin/gog-achievements.mjs', '--help'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(help.status, 0);
  assert.equal(help.stderr, '');
  assert.match(help.stdout, /Usage:\n/);
  assert.match(help.stdout, /Browse:\n/);
  assert.match(help.stdout, /--json --pretty/);
  assert.ok(!help.stdout.includes('"commands"'));
  const failure = spawnSync(process.execPath, ['bin/gog-achievements.mjs', 'unknown-command'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(failure.status, 2);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /Error \[UNKNOWN_COMMAND\]/);
});

test('command and group help need no credentials and show required flags', async () => {
  const service = new Proxy(
    {},
    {
      get() {
        throw new Error('Help must not access a service');
      },
    },
  );
  for (const args of [
    ['achievements', 'list', '--help'],
    ['help', 'achievements', 'list'],
    ['achievements', 'list', '-h'],
  ]) {
    const outcome = await runCLI(args, { service });
    assert.equal(outcome.exitCode, 0);
    assert.match(formatOutput(outcome), /--game GAME_ID.*GOG game ID.*Required\./);
    assert.ok(!formatOutput(outcome).includes('auth login'));
    assert.deepEqual(
      outcome.result.data.commands.map((spec) => spec.command),
      ['achievements list'],
    );
  }
  const group = await runCLI(['queue', '--help', '--json'], { service });
  assert.equal(group.exitCode, 0);
  assert.ok(group.result.data.commands.every((spec) => spec.command.startsWith('queue ')));
  const unknown = await runCLI(['secret-unknown', '--help', '--json'], { service });
  assert.equal(unknown.exitCode, 2);
  assert.ok(!formatOutput(unknown).includes('secret-unknown'));
});

test('--pretty keeps text and --json --pretty indents the same machine result', async () => {
  const deps = {
    service: { authStatus: async () => ({ authenticated: false, storage: 'macos_keychain' }) },
  };
  const plain = await runCLI(['auth', 'status'], deps);
  const pretty = await runCLI(['auth', 'status', '--pretty'], deps);
  const compact = await runCLI(['auth', 'status', '--json'], deps);
  const indented = await runCLI(['auth', 'status', '--json', '--pretty'], deps);
  assert.equal(formatOutput(plain), formatOutput(pretty));
  assert.equal(formatOutput(compact).trim().split('\n').length, 1);
  assert.match(formatOutput(indented), /\n  "ok": true,/);
  assert.deepEqual(JSON.parse(formatOutput(compact)), JSON.parse(formatOutput(indented)));
  const child = spawnSync(
    process.execPath,
    ['bin/gog-achievements.mjs', '--help', '--json', '--pretty'],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.ok(JSON.parse(child.stdout).data.commands.length > 1);
});

test('readable tables retain full IDs and strip remote terminal control sequences', async () => {
  const f = fixture();
  const games = await runCLI(['games', 'list'], { service: f.service });
  assert.match(formatOutput(games), /1 owned game/);
  assert.ok(formatOutput(games).includes(GAME_ID));
  f.achievements[0].name = '\u001b[31mEarned\u001b[0m\r\nmissing';
  const outcome = await runCLI(['achievements', 'list', '--game', GAME_ID], { service: f.service });
  for (const columns of [50, 100]) {
    const output = formatOutput(outcome, { columns });
    assert.ok(output.includes(ACHIEVEMENT_ID));
    assert.match(output, /0 unlocked, 2 locked/);
    assert.ok(!output.includes('\u001b'));
    assert.ok(!output.includes('\r'));
    assert.ok(!output.includes('fake-account'));
  }
  const json = formatOutput({ ...outcome, format: 'json' });
  assert.equal(JSON.parse(json).data.achievements[0].id, ACHIEVEMENT_ID);
  assert.equal(JSON.parse(json).data.achievements[0].name, f.achievements[0].name);
  const empty = formatOutput({
    ...games,
    result: { ok: true, data: { ...games.result.data, count: 0, games: [] } },
  });
  assert.equal(empty, 'No games found.\n');
});

test('readable unlock dates use UTC while JSON retains the server value', async () => {
  const f = fixture();
  f.achievements[0].date_unlocked = '2026-01-01T13:34:56+01:00';
  const outcome = await runCLI(['achievements', 'list', '--game', GAME_ID], { service: f.service });
  assert.match(formatOutput(outcome), /1 unlocked, 1 locked/);
  assert.match(formatOutput(outcome), /2026-01-01 12:34:56/);
  assert.ok(!formatOutput(outcome).includes('13:34:56'));
  assert.equal(
    JSON.parse(formatOutput({ ...outcome, format: 'json' })).data.achievements[0].unlocked_at,
    '2026-01-01T13:34:56+01:00',
  );
});

test('unknown and misplaced flags are rejected without using credentials', async () => {
  const service = {
    authStatus() {
      throw new Error('must not be called');
    },
  };
  const wrong = await runCLI(['auth', 'status', '--yes'], { service });
  assert.equal(wrong.exitCode, 2);
  const secret = await runCLI(['auth', 'finish', '--token', 'secret-token'], { service });
  assert.equal(secret.exitCode, 2);
  assert.ok(!JSON.stringify(secret).includes('secret-token'));
});

test('CLI queue workflow previews by default and writes only with --yes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture();
  const deps = { service: f.service };
  assert.equal(
    (
      await runCLI(
        [
          'queue',
          'create',
          '--game',
          GAME_ID,
          '--file',
          file,
          '--achievement',
          ACHIEVEMENT_ID,
          '--unlocked-at',
          DATE,
        ],
        deps,
      )
    ).exitCode,
    0,
  );
  assert.equal((await runCLI(['queue', 'apply', '--file', file], deps)).result.data.dry_run, true);
  assert.equal(f.writes.length, 0);
  const applied = await runCLI(['queue', 'apply', '--file', file, '--yes'], deps);
  assert.equal(applied.exitCode, 0);
  assert.equal(applied.result.data.results[0].status, 'restored');
  assert.equal(f.writes.length, 1);
  assert.ok(!String(await readFile(file)).includes('fake-account'));
});

test('partial apply returns exit 6 with the per-achievement report', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture({ rejectWrites: true });
  await runCLI(
    [
      'queue',
      'create',
      '--game',
      GAME_ID,
      '--file',
      file,
      '--achievement',
      ACHIEVEMENT_ID,
      '--unlocked-at',
      DATE,
    ],
    { service: f.service },
  );
  const result = await runCLI(['queue', 'apply', '--file', file, '--yes'], { service: f.service });
  assert.equal(result.exitCode, 6);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.details.report.results[0].status, 'failed');
  const readable = formatOutput(result);
  assert.match(readable, /Error \[APPLY_INCOMPLETE\]/);
  assert.match(readable, /Apply incomplete: Cyberpunk 2077/);
  assert.match(readable, /Failed: Earned but missing/);
  assert.ok(readable.includes(ACHIEVEMENT_ID));
  assert.match(readable, /Error: API_REJECTED/);
});

test('readable queues and previews show selected dates without writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-output-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture();
  const created = await runCLI(
    [
      'queue',
      'create',
      '--game',
      GAME_ID,
      '--file',
      file,
      '--achievement',
      ACHIEVEMENT_ID,
      '--unlocked-at',
      DATE,
    ],
    { service: f.service },
  );
  assert.match(formatOutput(created), /Queue created: Cyberpunk 2077/);
  assert.ok(formatOutput(created).includes(file));
  assert.match(formatOutput(created), /2026-01-01 12:34:56/);
  const preview = await runCLI(['queue', 'apply', '--file', file], { service: f.service });
  assert.match(formatOutput(preview), /Queue preview: Cyberpunk 2077/);
  assert.match(formatOutput(preview), /Would unlock: Earned but missing/);
  assert.match(formatOutput(preview), /Preview only\. No achievements were changed\./);
  assert.equal(f.writes.length, 0);
});

test('login stdin and clipboard inputs stay out of command results', async () => {
  const f = fixture();
  const result = await runCLI(['auth', 'finish', '--stdin'], {
    service: f.service,
    stdin: Readable.from(['test-secret-code']),
  });
  assert.equal(result.exitCode, 0);
  assert.ok(!JSON.stringify(result).includes('test-secret-code'));
  const clipboard = await runCLI(['auth', 'finish', '--clipboard'], {
    service: f.service,
    platform: 'darwin',
    execute: async () => ({
      code: 0,
      stdout: 'https://embed.gog.com/on_login_success?code=test-secret-code',
    }),
  });
  assert.equal(clipboard.exitCode, 0);
  assert.ok(!JSON.stringify(clipboard).includes('test-secret-code'));
});

test('Keychain stores long credentials using native calls and checks the saved value', async () => {
  const calls = [];
  const session = {
    access_token: 'secret-access'.repeat(1000),
    refresh_token: 'secret-refresh',
    user_id: '123',
  };
  let secret = null;
  const vault = new MacKeychain({
    execute: async (_path, _args, input, options) => {
      const request = JSON.parse(input);
      calls.push({ method: request.action, signal: options.signal });
      if (request.action === 'set') secret = request.secret;
      return { code: 0, stdout: JSON.stringify({ type: 'vault', secret }) };
    },
  });
  await vault.set(session);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['set', 'get'],
  );
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
  assert.deepEqual(await vault.get(), session);
});

test('Keychain detects truncated stored data and does not report a successful login', async () => {
  const vault = new MacKeychain({
    execute: async () => ({ code: 0, stdout: '{"type":"vault","secret":"truncated"}' }),
  });
  await assert.rejects(
    vault.set({ access_token: 'test' }),
    (error) => error.code === 'KEYCHAIN_STORE_FAILED',
  );
});

test('unexpected errors cannot expose credential-bearing messages', async () => {
  const result = await runCLI(['auth', 'status'], {
    service: {
      authStatus() {
        throw new Error('secret-access in URL');
      },
    },
  });
  assert.equal(result.exitCode, 4);
  assert.ok(!JSON.stringify(result).includes('secret-access'));
});

test('every queue edit command changes only the local queue', async (t) => {
  const { SECOND_ID } = await import('./fixture.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-edit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture();
  const commands = [
    ['create', '--game', GAME_ID, '--achievement', ACHIEVEMENT_ID],
    ['add', '--achievement', SECOND_ID],
    ['set-date', '--achievement', SECOND_ID, '--unlocked-at', DATE],
    ['remove', '--achievement', ACHIEVEMENT_ID],
    ['show'],
  ];
  for (const args of commands)
    assert.equal(
      (await runCLI(['queue', ...args, '--file', file], { service: f.service })).exitCode,
      0,
    );
  const queue = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    queue.items.map((item) => item.achievement_id),
    [SECOND_ID],
  );
  assert.equal(queue.items[0].unlocked_at, DATE);
  assert.equal(f.writes.length, 0);
});

test('import, logout, ID lists and diagnostics follow their command contracts', async () => {
  const f = fixture();
  const imported = await runCLI(['auth', 'import', '--stdin'], {
    service: f.service,
    stdin: Readable.from(['fixture-refresh']),
  });
  assert.equal(imported.exitCode, 0);
  assert.ok(!JSON.stringify(imported).includes('fixture-refresh'));
  const ids = await runCLI(['games', 'list', '--ids-only'], { service: f.service });
  assert.deepEqual(ids.result.data.games, [{ id: GAME_ID }]);
  assert.equal(
    (await runCLI(['games', 'list', '--search', 'test', '--ids-only'], { service: f.service }))
      .exitCode,
    2,
  );
  const loggedOut = await runCLI(['auth', 'logout'], { service: f.service });
  assert.equal(loggedOut.result.data.local_login_removed, true);
  assert.equal(f.vault.value, null);
  assert.equal(f.service.cachedSession, null);
  const doctor = await runCLI(['doctor'], {
    service: {
      authStatus() {
        throw new Error('private-token');
      },
    },
  });
  assert.equal(doctor.result.data.credentials_available, false);
  assert.ok(!JSON.stringify(doctor).includes('private-token'));
  assert.ok(formatOutput(doctor).includes('Credential store'));
});

test('invalid stdin and clipboard failures stay private and do not exchange credentials', async () => {
  const f = fixture();
  for (const stdin of [
    { isTTY: true },
    Readable.from(['x'.repeat(16001)]),
    new Readable({
      read() {
        this.destroy(new Error('private-token'));
      },
    }),
  ]) {
    const result = await runCLI(['auth', 'finish', '--stdin'], { service: f.service, stdin });
    assert.equal(result.exitCode, 2);
    assert.ok(!JSON.stringify(result).includes('private-token'));
  }
  const result = await runCLI(['auth', 'finish', '--clipboard'], {
    service: f.service,
    platform: 'darwin',
    execute: async () => ({ code: 7, stdout: 'private-token' }),
  });
  assert.equal(result.result.error.code, 'CLIPBOARD_FAILED');
  assert.equal(f.calls.length, 0);
});

test('unfinished stdin times out without leaving a reader active', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stdin = new Readable({ read() {} });
  const pending = runCLI(['auth', 'finish', '--stdin'], { service: fixture().service, stdin });
  t.mock.timers.tick(30000);
  const result = await pending;
  assert.equal(result.result.error.code, 'STDIN_TIMEOUT');
  assert.equal(stdin.listenerCount('data'), 0);
  assert.equal(stdin.isPaused(), true);
});
