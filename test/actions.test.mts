import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCLI } from '../src/cli.mjs';
import { dispatchCLI } from '../src/cli/handlers.mjs';
import { formatOutput } from '../src/output.mjs';
import { validateQueue } from '../src/data.mjs';
import { failureData, gogError, serviceStub, successData, jsonValue } from './assertions.mjs';
import {
  fixture,
  GAME_ID,
  ACHIEVEMENT_ID,
  SECOND_ID,
  DATE,
  CLIENT_ID,
  USER_ID,
} from './fixture.mjs';

const THIRD_ID = '48497841707623055';
const FOURTH_ID = '48497841707623056';
const CHANGED_DATE = '2026-02-01T00:00:00Z';

function mixedFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options);
  for (const [id, key] of [
    [THIRD_ID, 'ACH_THIRD'],
    [FOURTH_ID, 'ACH_FOURTH'],
  ])
    f.achievements.push({
      ...f.achievements[0]!,
      achievement_id: id!,
      achievement_key: key!,
      name: key!,
      date_unlocked: DATE,
    });
  f.setTotal(4);
  return f;
}

async function mixedQueue(f: ReturnType<typeof fixture>) {
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID, SECOND_ID], DATE);
  return f.service.addToQueue(queue, [THIRD_ID, FOURTH_ID], undefined, 'lock');
}

void test('two unlocks and two locks share one ordered queue, preview, apply and safe retry', async () => {
  const f = mixedFixture();
  const queue = await mixedQueue(f);
  const saved = structuredClone(queue);
  assert.equal(queue.schema_version, 1);
  assert.equal(Object.hasOwn(queue.items[0]!, 'action'), false);
  assert.deepEqual(queue.items[2], {
    achievement_id: THIRD_ID,
    key: 'ACH_THIRD',
    name: 'ACH_THIRD',
    action: 'lock',
    previous_unlocked_at: DATE,
  });
  const preview = await f.service.applyQueue(queue);
  assert.deepEqual(
    preview.results.map((item) => item.status),
    ['pending', 'pending', 'pending', 'pending'],
  );
  assert.equal(preview.results[2]!.requested_unlocked_at, null);
  assert.equal(preview.results[2]!.previous_unlocked_at, DATE);
  assert.equal(f.writes.length, 0);
  assert.equal(
    f.calls.some(({ url }) => url.hostname === 'auth.gog.com'),
    false,
  );

  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, true);
  assert.deepEqual(
    report.results.map((item) => item.status),
    ['restored', 'restored', 'locked', 'locked'],
  );
  assert.deepEqual(
    f.writes.map(({ achievement_id, body }) => [achievement_id, body.date_unlocked]),
    [
      [ACHIEVEMENT_ID, '2026-01-01T12:34:56+0000'],
      [SECOND_ID, '2026-01-01T12:34:56+0000'],
      [THIRD_ID, null],
      [FOURTH_ID, null],
    ],
  );
  assert.ok(f.writes.every((item) => item.authorization === 'Bearer fake-scoped-access'));
  assert.deepEqual(queue, saved);
  const refreshes = f.calls.filter(({ url }) => url.hostname === 'auth.gog.com').length;
  const repeated = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(repeated.complete, true);
  assert.deepEqual(
    repeated.results.map((item) => item.status),
    [
      'skipped_already_unlocked',
      'skipped_already_unlocked',
      'skipped_already_locked',
      'skipped_already_locked',
    ],
  );
  assert.equal(repeated.results[2]!.previous_unlocked_at, DATE);
  assert.equal(f.calls.filter(({ url }) => url.hostname === 'auth.gog.com').length, refreshes);
  assert.equal(f.writes.length, 4);
});

void test('lock-only creation preserves exact server dates and explicit unlock remains available', async () => {
  const f = fixture();
  const originalDate = '2026-01-01T13:34:56.123+0100';
  f.achievements[0]!.date_unlocked = originalDate;
  f.achievements[1]!.date_unlocked = DATE;
  const queue = await f.service.createQueue(
    GAME_ID,
    [ACHIEVEMENT_ID, SECOND_ID],
    undefined,
    'lock',
  );
  assert.equal(queue.items[0]!.previous_unlocked_at, originalDate);
  assert.equal(Object.hasOwn(queue.items[0]!, 'unlocked_at'), false);
  assert.deepEqual(validateQueue(queue), queue);
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.deepEqual(
    report.results.map((item) => item.status),
    ['locked', 'locked'],
  );
  assert.equal(report.results[0]!.previous_unlocked_at, originalDate);
  const unlocks = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID, SECOND_ID], DATE, 'unlock');
  assert.equal(unlocks.items[0]!.action, 'unlock');
  assert.equal((await f.service.applyQueue(unlocks, { dryRun: false })).complete, true);
});

void test('invalid actions and dates fail before service or file operations', async () => {
  const unexpected = () => assert.fail('Invalid requests must have no external effects.');
  for (const command of ['create', 'add']) {
    for (const flags of [
      ['--action', 'reset'],
      ['--action', 'LOCK'],
      ['--action', 'lock', '--unlocked-at', DATE],
    ]) {
      const result = await dispatchCLI(
        [
          'queue',
          command,
          '--file',
          'unused.json',
          '--achievement',
          ACHIEVEMENT_ID,
          ...(command === 'create' ? ['--game', GAME_ID] : []),
          ...flags,
          '--json',
        ],
        {
          service: serviceStub(),
          stderr: { write: unexpected },
          platform: 'darwin',
          isPackaged: unexpected,
          systemInfo: unexpected,
          readInput: unexpected,
          nativeLogin: unexpected,
          files: { read: unexpected, save: unexpected, withLock: unexpected },
          updates: { check: unexpected, install: unexpected },
          confirm: unexpected,
          writeExport: unexpected,
        },
      );
      assert.equal(result.exitCode, 2);
      assert.equal(
        failureData(result).code,
        flags.length === 2 ? 'INVALID_ACTION' : 'INVALID_ARGUMENTS',
      );
    }
  }
  const f = fixture();
  await assert.rejects(
    f.service.createQueue(GAME_ID, [], DATE, 'lock'),
    (e) => gogError(e).code === 'INVALID_ARGUMENTS',
  );
  await assert.rejects(
    f.service.createQueue(GAME_ID, [], undefined, 'reset'),
    (e) => gogError(e).code === 'INVALID_ACTION',
  );
  assert.equal(f.calls.length, 0);
});

void test('queue validation cannot interpret null dates or unknown actions as a lock request', async () => {
  const f = fixture();
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  const item = { achievement_id: ACHIEVEMENT_ID, key: 'ACH_FIRST', name: 'First' };
  for (const invalid of [
    { ...item, unlocked_at: null },
    { ...item, action: 'unlock', unlocked_at: null },
    { ...item, action: 'reset', unlocked_at: DATE },
    { ...item, action: null, unlocked_at: DATE },
    { ...item, action: 'lock' },
    { ...item, action: 'lock', previous_unlocked_at: null },
    { ...item, action: 'lock', previous_unlocked_at: 'invalid' },
    { ...item, action: 'lock', previous_unlocked_at: DATE, unlocked_at: null },
    { ...item, action: 'lock', previous_unlocked_at: DATE, unlocked_at: DATE },
    { ...item, action: 'unlock', previous_unlocked_at: DATE, unlocked_at: DATE },
    { ...item, previous_unlocked_at: DATE },
  ])
    await assert.rejects(f.service.applyQueue({ ...queue, items: [invalid] }, { dryRun: false }));
  assert.equal(f.writes.length, 0);
});

void test('wrong accounts, clients and ownership block lock queues before writes', async () => {
  const f = mixedFixture();
  const queue = await mixedQueue(f);
  for (const invalid of [
    { ...queue, user_id: '1' },
    { ...queue, game: { ...queue.game, client_id: '1' } },
  ])
    await assert.rejects(f.service.applyQueue(invalid, { dryRun: false }));
  const unowned = fixture({ owned: [] });
  await assert.rejects(
    unowned.service.createQueue(GAME_ID, [THIRD_ID], undefined, 'lock'),
    (e) => gogError(e).code === 'GAME_NOT_OWNED',
  );
  const scoped = fixture({ authUser: '1' });
  scoped.achievements[0]!.date_unlocked = DATE;
  const lock = await scoped.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  await assert.rejects(
    scoped.service.applyQueue(lock, { dryRun: false }),
    (e) => gogError(e).code === 'ACCOUNT_MISMATCH',
  );
  assert.equal(f.writes.length + scoped.writes.length + unowned.writes.length, 0);
});

void test('a changed unlock date anywhere in a mixed queue blocks the whole batch', async () => {
  const f = mixedFixture();
  const queue = await mixedQueue(f);
  f.achievements[3]!.date_unlocked = CHANGED_DATE;
  for (const dryRun of [true, false])
    await assert.rejects(
      f.service.applyQueue(queue, { dryRun }),
      (e) => gogError(e).code === 'ACHIEVEMENT_CHANGED',
    );
  assert.equal(f.writes.length, 0);
});

void test('a lock date changed after preflight stops before its POST and preserves earlier successes', async () => {
  const f = mixedFixture();
  const queue = await mixedQueue(f);
  f.setHook((url, init) => {
    if (url.pathname.endsWith(`/achievements/${SECOND_ID}`) && init.method === 'POST')
      f.achievements[2]!.date_unlocked = CHANGED_DATE;
  });
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, false);
  assert.deepEqual(
    report.results.map((item) => item.status),
    ['restored', 'restored', 'not_attempted', 'not_attempted'],
  );
  assert.equal(report.results[2]!.error_code, 'ACHIEVEMENT_CHANGED');
  assert.equal(report.results[2]!.actual_unlocked_at, CHANGED_DATE);
  assert.equal(report.results[2]!.previous_unlocked_at, DATE);
  assert.equal(f.writes.length, 2);
});

void test('the last read skips an achievement already locked by another client', async () => {
  const f = fixture();
  f.achievements[0]!.date_unlocked = DATE;
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  f.setHook((url) => {
    if (url.hostname === 'auth.gog.com') f.achievements[0]!.date_unlocked = null;
  });
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.results[0]!.status, 'skipped_already_locked');
  assert.equal(report.results[0]!.previous_unlocked_at, DATE);
  assert.equal(f.writes.length, 0);
});

void test('an identity change before a lock write stops the batch without clearing it', async () => {
  const f = fixture();
  f.achievements[0]!.date_unlocked = DATE;
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  f.setHook((url) => {
    if (url.hostname === 'auth.gog.com') f.achievements[0]!.achievement_key = 'NEW_KEY';
  });
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, false);
  assert.equal(report.results[0]!.status, 'not_attempted');
  assert.equal(report.results[0]!.error_code, 'ACHIEVEMENT_CHANGED');
  assert.equal(f.writes.length, 0);
});

void test('lock writes reconcile lost responses with reads without repeating the POST', async () => {
  const f = fixture({ loseWriteResponse: true });
  f.achievements[0]!.date_unlocked = DATE;
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, true);
  assert.equal(report.results[0]!.status, 'locked');
  assert.equal(report.results[0]!.actual_unlocked_at, null);
  assert.equal(f.writes.length, 1);
});

void test('rejected lock writes stop later unlocks and return safe failure reports', async () => {
  const f = fixture({ rejectWrites: true });
  f.achievements[0]!.date_unlocked = DATE;
  let queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  queue = await f.service.addToQueue(queue, [SECOND_ID], DATE);
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, false);
  assert.deepEqual(
    report.results.map((item) => item.status),
    ['failed', 'not_attempted'],
  );
  assert.equal(report.results[0]!.error_code, 'API_REJECTED');
  assert.equal(f.writes.length, 1);
  assert.ok(!JSON.stringify(report).includes('fake-token'));
});

void test('successful HTTP responses without a confirmed lock stop the batch', async () => {
  const f = fixture();
  f.achievements[0]!.date_unlocked = DATE;
  let queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  queue = await f.service.addToQueue(queue, [SECOND_ID], DATE);
  const waits: number[] = [];
  f.service.wait = async (ms) => {
    waits.push(ms);
  };
  let posts = 0;
  f.setHook((_url, init) => {
    if (init.method === 'POST') {
      posts++;
      return new Response(null, { status: 204 });
    }
    return undefined;
  });
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.deepEqual(
    report.results.map((item) => item.status),
    ['unconfirmed', 'not_attempted'],
  );
  assert.equal(report.results[0]!.error_code, 'LOCK_NOT_CONFIRMED');
  assert.equal(report.results[0]!.actual_unlocked_at, DATE);
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(posts, 1);
});

void test('lock verification waits for an explicit locked state with the same ID and key', async () => {
  const f = fixture();
  f.achievements[0]!.date_unlocked = DATE;
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
  let stale = 0;
  f.setHook((url, init) => {
    if (
      url.pathname.endsWith('/achievements') &&
      init.method === 'GET' &&
      f.writes.length &&
      stale++ < 2
    )
      return new Response(
        JSON.stringify({
          items: [{ ...f.achievements[0]!, date_unlocked: DATE }, f.achievements[1]!],
          total_count: 2,
        }),
      );
    return undefined;
  });
  assert.equal((await f.service.applyQueue(queue, { dryRun: false })).results[0]!.status, 'locked');
  assert.equal(f.writes.length, 1);
});

void test('missing or changed achievements after a lock POST are unconfirmed', async () => {
  for (const changed of ['missing', 'key']) {
    const f = fixture();
    f.achievements[0]!.date_unlocked = DATE;
    const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
    f.setHook((url, init) => {
      if (url.pathname.endsWith('/achievements') && init.method === 'GET' && f.writes.length)
        return new Response(
          JSON.stringify({
            items:
              changed === 'missing'
                ? [f.achievements[1]!]
                : [{ ...f.achievements[0]!, achievement_key: 'changed' }, f.achievements[1]!],
            total_count: changed === 'missing' ? 1 : 2,
          }),
        );
      return undefined;
    });
    const report = await f.service.applyQueue(queue, { dryRun: false });
    assert.equal(report.complete, false);
    assert.equal(report.results[0]!.status, 'unconfirmed');
    assert.equal(f.writes.length, 1);
  }
});

void test('read failures before or after a lock POST are reported without another write', async () => {
  for (const afterWrite of [false, true]) {
    const f = fixture();
    f.achievements[0]!.date_unlocked = DATE;
    const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock');
    let scoped = false;
    f.setHook((url) => {
      if (url.hostname === 'auth.gog.com') scoped = true;
      if (url.pathname.endsWith('/achievements') && (afterWrite ? f.writes.length > 0 : scoped))
        throw new Error('private-token');
    });
    const report = await f.service.applyQueue(queue, { dryRun: false });
    assert.equal(report.results[0]!.status, afterWrite ? 'unconfirmed' : 'not_attempted');
    assert.equal(report.results[0]!.error_code, 'NETWORK_ERROR');
    assert.equal(f.writes.length, afterWrite ? 1 : 0);
    assert.ok(!JSON.stringify(report).includes('private-token'));
  }
});

void test('lock selection rejects locked and duplicate entries, and mixed date edits are atomic', async () => {
  const f = mixedFixture();
  const queue = await mixedQueue(f);
  const saved = structuredClone(queue);
  await assert.rejects(
    f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], undefined, 'lock'),
    (e) => gogError(e).code === 'ALREADY_LOCKED',
  );
  await assert.rejects(
    f.service.addToQueue(queue, [THIRD_ID], undefined, 'lock'),
    (e) => gogError(e).code === 'DUPLICATE_ACHIEVEMENT',
  );
  assert.throws(
    () => f.service.editQueue(queue, [ACHIEVEMENT_ID, THIRD_ID], { unlockedAt: CHANGED_DATE }),
    (e) => gogError(e).code === 'INVALID_ARGUMENTS',
  );
  assert.deepEqual(queue, saved);
  const edited = f.service.editQueue(queue, [ACHIEVEMENT_ID], { unlockedAt: CHANGED_DATE });
  assert.equal(edited.items[0]!.unlocked_at, CHANGED_DATE);
  assert.deepEqual(edited.items[2], queue.items[2]);
  assert.equal(f.service.editQueue(queue, [THIRD_ID], { remove: true }).items.length, 3);
  await assert.rejects(
    f.service.addToQueue(queue, [THIRD_ID], DATE, 'lock'),
    (e) => gogError(e).code === 'INVALID_ARGUMENTS',
  );
  assert.equal(f.writes.length, 0);
});

void test('only the explicit lock adapter sends a null date', async () => {
  const f = fixture();
  await f.api.lock(
    { client_id: CLIENT_ID },
    { user_id: USER_ID, access_token: 'fixture-access' },
    ACHIEVEMENT_ID,
  );
  assert.deepEqual(f.writes[0]!.body, { date_unlocked: null });
  assert.equal(
    f.calls[0]!.url.pathname,
    `/clients/${CLIENT_ID}/users/${USER_ID}/achievements/${ACHIEVEMENT_ID}`,
  );
  await assert.rejects(
    Reflect.apply(f.api.unlock.bind(f.api), f.api, [
      { client_id: CLIENT_ID },
      { user_id: USER_ID, access_token: 'fixture-access' },
      ACHIEVEMENT_ID,
      null,
    ]) as Promise<unknown>,
    (e) => gogError(e).code === 'INVALID_DATE',
  );
  assert.equal(f.writes.length, 1);
});

void test('CLI saves mixed actions, shows previews, rejects date edits and applies only with yes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-actions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = mixedFixture();
  const run = (args: string[]) =>
    runCLI(['queue', ...args, '--file', file, '--json'], { service: f.service });
  assert.equal(
    (
      await run([
        'create',
        '--game',
        GAME_ID,
        '--achievement',
        ACHIEVEMENT_ID,
        '--achievement',
        SECOND_ID,
        '--action',
        'unlock',
        '--unlocked-at',
        DATE,
      ])
    ).exitCode,
    0,
  );
  const added = await run([
    'add',
    '--achievement',
    THIRD_ID,
    '--achievement',
    FOURTH_ID,
    '--action',
    'lock',
  ]);
  assert.equal(added.exitCode, 0);
  const bytes = await readFile(file, 'utf8');
  const original = validateQueue(JSON.parse(bytes));
  assert.equal(original.items[2]!.previous_unlocked_at, DATE);
  const textQueue = formatOutput({ ...added, format: 'text' });
  assert.match(textQueue, /2 to unlock, 2 to lock/);
  assert.match(textQueue, /Action/);
  assert.match(textQueue, /Lock/);
  const badEdit = await run([
    'set-date',
    '--achievement',
    ACHIEVEMENT_ID,
    '--achievement',
    THIRD_ID,
    '--unlocked-at',
    CHANGED_DATE,
  ]);
  assert.equal(badEdit.exitCode, 2);
  assert.equal(await readFile(file, 'utf8'), bytes);
  for (const args of [[], ['--dry-run']]) {
    const preview = await run(['apply', ...args]);
    assert.equal(preview.exitCode, 0);
    const text = formatOutput({ ...preview, format: 'text' });
    assert.match(text, /Would unlock/);
    assert.match(text, /Would lock/);
    assert.match(text, /Previous unlock \(UTC\): 2026-01-01 12:34:56/);
    assert.match(text, /Requested: 2 unlock, 2 lock/);
    assert.equal(jsonValue(formatOutput(preview), 'ok'), true);
  }
  assert.equal(f.writes.length, 0);
  const applied = await run(['apply', '--yes']);
  assert.equal(applied.exitCode, 0);
  assert.deepEqual(
    successData(applied, 'queue apply').results.map((item) => item.status),
    ['restored', 'restored', 'locked', 'locked'],
  );
  assert.match(formatOutput({ ...applied, format: 'text' }), /Actual: Locked/);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal(f.writes.length, 4);
  f.setHook(() => assert.fail('queue show is offline'));
  assert.deepEqual(successData(await run(['show']), 'queue show'), original);
  assert.equal((await run(['remove', '--achievement', THIRD_ID])).exitCode, 0);
});

void test('CLI lock creation and partial apply return exit 6 with lock dates and later items', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-lock-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const f = fixture({ rejectWrites: true });
  f.achievements.forEach((item) => {
    item.date_unlocked = DATE;
  });
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
      '--achievement',
      SECOND_ID,
      '--action',
      'lock',
      '--json',
    ],
    { service: f.service },
  );
  assert.equal(created.exitCode, 0);
  const result = await runCLI(['queue', 'apply', '--file', file, '--yes', '--json'], {
    service: f.service,
  });
  assert.equal(result.exitCode, 6);
  const error = failureData(result);
  assert.equal(error.code, 'APPLY_INCOMPLETE');
  assert.deepEqual(
    error.details!.report!.results.map((item) => item.status),
    ['failed', 'not_attempted'],
  );
  assert.equal(error.details!.report!.results[0]!.previous_unlocked_at, DATE);
  assert.match(formatOutput({ ...result, format: 'text' }, { columns: 40 }), /Action: Lock/);
});

void test('unlock verification requires the original achievement key and stops an unconfirmed batch', async () => {
  for (const changed of ['missing', 'key']) {
    const f = fixture();
    const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID, SECOND_ID], DATE);
    f.setHook((url, init) => {
      if (url.pathname.endsWith('/achievements') && init.method === 'GET' && f.writes.length)
        return new Response(
          JSON.stringify({
            items:
              changed === 'missing'
                ? [f.achievements[1]!]
                : [{ ...f.achievements[0]!, achievement_key: 'changed' }, f.achievements[1]!],
            total_count: changed === 'missing' ? 1 : 2,
          }),
        );
      return undefined;
    });
    const report = await f.service.applyQueue(queue, { dryRun: false });
    assert.equal(report.complete, false);
    assert.deepEqual(
      report.results.map((item) => item.status),
      ['unconfirmed', 'not_attempted'],
    );
    assert.equal(report.results[0]!.error_code, 'UNLOCK_NOT_CONFIRMED');
    assert.equal(f.writes.length, 1);
  }
});

void test('unlock verification retries a stale identity with reads only', async () => {
  const f = fixture();
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  let staleReads = 0;
  f.setHook((url, init) => {
    if (
      url.pathname.endsWith('/achievements') &&
      init.method === 'GET' &&
      f.writes.length &&
      staleReads++ < 2
    )
      return new Response(
        JSON.stringify({
          items: [{ ...f.achievements[0]!, achievement_key: 'changed' }, f.achievements[1]!],
          total_count: 2,
        }),
      );
    return undefined;
  });
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.results[0]!.status, 'restored');
  assert.equal(staleReads, 3);
  assert.equal(f.writes.length, 1);
});
