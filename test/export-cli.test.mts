import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCLI } from '../src/cli.mjs';
import { formatOutput } from '../src/output.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, SECOND_ID } from './fixture.mjs';
import { failureData, serviceStub, successOutcome } from './assertions.mjs';

const header = 'game_id,game_title,achievement_id,name,description,hidden,status,unlocked_at\r\n';

void test('CLI export reads a local HTTP fixture and writes CSV only to the selected file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-csv-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = fixture();
  f.achievements[0]!.name = 'Café, "first"';
  f.achievements[0]!.description = 'Line one\r\nLine two';
  f.achievements[0]!.visible = false;
  f.achievements[1]!.date_unlocked = '2026-01-01T13:34:56+01:00';
  const respond = f.api.fetch;
  const methods: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      methods.push(request.method ?? '');
      const result = await respond(
        `https://${String(request.headers['x-fixture-host'])}${request.url}`,
        {
          method: request.method ?? 'GET',
          headers: { Authorization: request.headers.authorization ?? '' },
        },
      );
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(await result.text());
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  f.api.fetch = (url, options) => {
    const upstream = new URL(url);
    return fetch(`http://127.0.0.1:${address.port}${upstream.pathname}${upstream.search}`, {
      ...options,
      headers: { ...options.headers, 'x-fixture-host': upstream.host },
    });
  };
  const path = join(directory, 'all.csv');
  const outcome = successOutcome(
    await runCLI(['achievements', 'export', '--game', GAME_ID, '--file', path, '--json'], {
      service: f.service,
    }),
    'achievements export',
  );
  assert.deepEqual(outcome.result, { ok: true, data: { path, count: 2 } });
  assert.equal(formatOutput(outcome).trim().split('\n').length, 1);
  assert.equal(formatOutput(outcome), JSON.stringify(outcome.result) + '\n');
  assert.equal(
    await readFile(path, 'utf8'),
    header +
      `${GAME_ID},Cyberpunk 2077,${ACHIEVEMENT_ID},"Café, ""first""","Line one\r\nLine two",true,locked,\r\n` +
      `${GAME_ID},Cyberpunk 2077,${SECOND_ID},Second achievement,Second description,false,unlocked,2026-01-01T12:34:56Z\r\n`,
  );
  assert.ok(methods.length > 0 && methods.every((method) => method === 'GET'));
  assert.equal(f.writes.length, 0);
  assert.deepEqual(await readdir(directory), ['all.csv']);
});

void test('export search and status match list selection, including hidden fields and zero matches', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-csv-filter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = fixture();
  f.achievements[0]!.visible = false;
  f.achievements[1]!.date_unlocked = '2026-01-01T12:34:56Z';
  const cases: [string[], string[]][] = [
    [[], [ACHIEVEMENT_ID, SECOND_ID]],
    [
      ['--status', 'all'],
      [ACHIEVEMENT_ID, SECOND_ID],
    ],
    [['--status', 'locked'], [ACHIEVEMENT_ID]],
    [['--status', 'unlocked'], [SECOND_ID]],
    [['--search', 'FIRST DESCRIPTION'], [ACHIEVEMENT_ID]],
    [['--search', 'Second achievement', '--status', 'unlocked'], [SECOND_ID]],
    [['--search', 'Second', '--status', 'locked'], []],
    [
      ['--search', '   '],
      [ACHIEVEMENT_ID, SECOND_ID],
    ],
  ];
  for (const [index, [flags, ids]] of cases.entries()) {
    const path = join(directory, `${index}.csv`);
    const list = successOutcome(
      await runCLI(['achievements', 'list', '--game', GAME_ID, ...flags], { service: f.service }),
      'achievements list',
    );
    assert.deepEqual(
      list.result.data.achievements.map(({ id }) => id),
      ids,
    );
    const exported = successOutcome(
      await runCLI(['achievements', 'export', '--game', GAME_ID, '--file', path, ...flags], {
        service: f.service,
      }),
      'achievements export',
    );
    assert.equal(exported.result.data.count, ids.length);
    assert.match(formatOutput(exported), new RegExp(`Exported ${ids.length} achievement`));
    assert.ok(formatOutput(exported).includes(path));
    assert.ok(!formatOutput(exported).includes('game_id,'));
    const csv = await readFile(path, 'utf8');
    assert.equal(csv.split('\r\n').length, ids.length + 2);
    if (ids.length === 0) assert.equal(csv, header);
    for (const id of [ACHIEVEMENT_ID, SECOND_ID]) assert.equal(csv.includes(id), ids.includes(id));
  }
  assert.equal(f.writes.length, 0);
});

void test('export help and invalid flags do not access the service or create a file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-csv-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'never.csv');
  const service = serviceStub();
  const help = successOutcome(
    await runCLI(['achievements', 'export', '--help', '--json'], { service }),
    'help',
  );
  assert.deepEqual(help.result.data.commands[0]!.required, ['game', 'file']);
  assert.ok(help.result.data.options.some(({ flag }) => flag === 'status'));
  for (const flags of [
    ['--game', GAME_ID],
    ['--file', path],
    ['--game', 'invalid', '--file', path],
    ['--game', GAME_ID, '--file', path, '--status', 'invalid'],
    ['--game', GAME_ID, '--file', path, '--yes'],
  ]) {
    const result = await runCLI(['achievements', 'export', ...flags, '--json'], { service });
    assert.equal(result.exitCode, 2);
    assert.equal(result.result.ok, false);
  }
  assert.deepEqual(await readdir(directory), []);
});

void test('failed retrieval leaves no file and an existing file cannot be replaced', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-csv-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'export.csv');
  const args = ['achievements', 'export', '--game', GAME_ID, '--file', path, '--json'];
  const f = fixture();
  f.vault.value = null;
  assert.equal(failureData(await runCLI(args, { service: f.service })).code, 'AUTH_REQUIRED');
  const broken = fixture();
  broken.setHook(() => new Response('Private fixture data', { status: 500 }));
  const failed = await runCLI(args, { service: broken.service });
  assert.equal(failed.exitCode, 4);
  assert.equal(failureData(failed).code, 'API_REJECTED');
  assert.deepEqual(await readdir(directory), []);
  await writeFile(path, 'Keep this CSV.');
  const exists = await runCLI(args, { service: fixture().service });
  assert.equal(exists.exitCode, 2);
  assert.equal(failureData(exists).code, 'EXPORT_EXISTS');
  assert.equal(await readFile(path, 'utf8'), 'Keep this CSV.');
  assert.deepEqual(await readdir(directory), ['export.csv']);
});
