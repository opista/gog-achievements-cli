import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCLI } from '../src/cli.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, DATE } from '../test/fixture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'gog-cli-demo-'));
const file = join(directory, 'queue.json');
const mock = fixture();
/** @type {({command: string} & import("../src/types.mjs").CLIOutcome["result"])[]} */
const steps = [];
try {
  for (const args of [
    ['games', 'list'],
    ['achievements', 'list', '--game', GAME_ID],
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
    [
      'queue',
      'set-date',
      '--file',
      file,
      '--achievement',
      ACHIEVEMENT_ID,
      '--unlocked-at',
      '2026-01-02T13:00:00+01:00',
    ],
    ['queue', 'apply', '--file', file, '--dry-run'],
    ['queue', 'apply', '--file', file, '--yes'],
    ['queue', 'apply', '--file', file, '--yes'],
  ]) {
    const outcome = await runCLI(args, { service: mock.service });
    steps.push({ command: args.slice(0, 2).join(' '), ...outcome.result });
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  }
  process.stdout.write(
    `${JSON.stringify({ mock: true, mock_write_count: mock.writes.length, steps }, null, 2)}\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
