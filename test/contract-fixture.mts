import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { runCLI } from '../src/cli.mjs';
import type { formatOutput } from '../src/output.mjs';
import type { fixture } from './fixture.mjs';
import type { CLIOutcome } from '../src/types.mjs';
import { updateStub } from './update-fixture.mjs';

interface Runtime {
  runCLI: typeof runCLI;
  formatOutput: typeof formatOutput;
  fixture: typeof fixture;
  version: string;
}

export function normalizeContractText(value: string, directory: string) {
  // JSON output can itself be a quoted string inside a captured record.
  for (const depth of [2, 1, 0]) {
    const escaped = directory.replaceAll('\\', '\\'.repeat(2 ** depth));
    value = value.replaceAll(escaped, '<TEMP>');
  }
  return value.replace(/<TEMP>\\+/g, '<TEMP>/');
}

// The same harness records the original JavaScript and checks the migrated CLI.
export async function captureContracts(runtime: Runtime): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'gog-contract-'));
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-10-14T12:00:00Z');
  const records: unknown[] = [];
  const game = '1423049311';
  const first = '48497841707623054';
  const second = '48225958150521213';
  const date = '2026-01-01T12:34:56Z';
  try {
    async function record(label: string, args: string[], f = runtime.fixture(), file?: string) {
      const outcome: CLIOutcome = await runtime.runCLI(args, {
        updates: updateStub(),
        service: f.service,
        stdin: Readable.from([args[1] === 'import' ? 'fixture-refresh' : 'fixture-code']),
        platform: 'darwin',
        nativeLogin: async ({ service }) => service.finishLogin('fixture-code'),
      });
      let queue: string | null = null;
      if (file) {
        try {
          queue = await readFile(file, 'utf8');
        } catch {
          /* No file was created. */
        }
      }
      records.push({
        label,
        outcome,
        properties: Object.keys(outcome),
        queue,
        text40: runtime.formatOutput({ ...outcome, format: 'text' }, { columns: 40 }),
        text100: runtime.formatOutput({ ...outcome, format: 'text' }, { columns: 100 }),
        json: runtime.formatOutput({ ...outcome, format: 'json', pretty: false }),
        pretty: runtime.formatOutput({ ...outcome, format: 'json', pretty: true }),
        requests: f.calls.map(({ url, init }) => ({
          host: url.hostname,
          path: url.pathname,
          query: [...url.searchParams].filter(
            ([key]) => !['client_secret', 'code', 'refresh_token', 'state'].includes(key),
          ),
          method: init.method,
          scope:
            init.headers.Authorization === undefined
              ? 'none'
              : init.headers.Authorization === 'Bearer fake-account-access'
                ? 'account'
                : 'game',
          body: init.body ?? null,
        })),
        writes: f.writes.map(({ achievement_id, body }) => ({ achievement_id, body })),
      });
    }

    for (const args of [
      ['--help'],
      ['queue', '--help'],
      ['auth', 'login'],
      ['auth', 'login', '--no-open'],
      ['auth', 'status'],
      ['auth', 'finish', '--stdin'],
      ['auth', 'import', '--stdin'],
      ['auth', 'logout'],
      ['games', 'list'],
      ['games', 'list', '--ids-only'],
      ['achievements', 'list', '--game', game],
      ['doctor'],
      ['unknown-command', '--json'],
      ['auth', 'status', '--yes'],
      ['queue', 'apply', '--yes'],
    ])
      await record(args.join(' '), args);

    const file = join(directory, 'queue.json');
    const f = runtime.fixture();
    for (const args of [
      ['queue', 'create', '--game', game, '--file', file],
      [
        'queue',
        'add',
        '--file',
        file,
        '--achievement',
        first,
        '--achievement',
        second,
        '--unlocked-at',
        date,
      ],
      [
        'queue',
        'set-date',
        '--file',
        file,
        '--achievement',
        first,
        '--unlocked-at',
        '2026-02-01T13:00:00+01:00',
      ],
      ['queue', 'show', '--file', file],
      ['queue', 'remove', '--file', file, '--achievement', second],
      ['queue', 'apply', '--file', file],
      ['queue', 'apply', '--file', file, '--yes'],
      ['queue', 'apply', '--file', file, '--yes'],
    ])
      await record(args.slice(0, 2).join(' '), args, f, file);

    for (const [name, options] of [
      ['rejected', { rejectWrites: true }],
      ['lost-response', { loseWriteResponse: true }],
      ['different-date', { clampDate: '2026-01-02T00:00:00Z' }],
      ['unconfirmed', {}],
      ['changed', {}],
    ] satisfies [string, Parameters<typeof fixture>[0]][]) {
      const mock = runtime.fixture(options);
      const path = join(directory, `${name}.json`);
      await record(
        `${name}: create`,
        [
          'queue',
          'create',
          '--game',
          game,
          '--file',
          path,
          '--achievement',
          first,
          '--achievement',
          second,
          '--unlocked-at',
          date,
        ],
        mock,
        path,
      );
      if (name === 'unconfirmed')
        mock.setHook((_url, init) =>
          init.method === 'POST' ? new Response(null, { status: 204 }) : undefined,
        );
      if (name === 'changed')
        mock.setHook((url) => {
          if (url.hostname === 'auth.gog.com') mock.achievements[0]!.achievement_key = 'changed';
        });
      await record(`${name}: apply`, ['queue', 'apply', '--file', path, '--yes'], mock, path);
    }

    for (const [payload, suffix] of [
      [null, '/user/data/games'],
      [{ items: [null] }, '/achievements'],
      [{ builds: [null] }, '/product.json'],
      [{ owned: null }, '/user/data/games'],
    ] satisfies [unknown, string][]) {
      const mock = runtime.fixture();
      mock.setHook((url) =>
        url.pathname.endsWith(suffix) ? new Response(JSON.stringify(payload)) : undefined,
      );
      await record(
        `malformed: ${JSON.stringify(payload)}`,
        ['achievements', 'list', '--game', game],
        mock,
      );
    }
    // Normalize only environment values; retain exact output and file bytes.
    const serialized = normalizeContractText(JSON.stringify(records), directory)
      .replaceAll(process.versions.node, '<NODE>')
      .replaceAll(process.arch, '<ARCH>')
      .replaceAll(runtime.version, '<VERSION>');
    if (/fake-(account|scoped|refreshed|game)|fixture-(code|refresh)/.test(serialized))
      throw new Error('Private fixture data escaped the contract capture.');
    return JSON.parse(serialized) as unknown;
  } finally {
    Date.now = originalNow;
    await rm(directory, { recursive: true, force: true });
  }
}
