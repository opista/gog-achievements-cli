import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const execute = promisify(execFile);
const executable = resolve(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), 'gog-cli-smoke-'));
try {
  const options = {
    cwd: directory,
    timeout: 10000,
    maxBuffer: 1_000_000,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  };
  const help = await execute(executable, ['--help', '--json'], { ...options, timeout: 30000 });
  assert.equal(help.stderr, '');
  assert.equal(JSON.parse(help.stdout).data.name, 'gog-achievements');
  const readable = await execute(executable, ['achievements', 'list', '--help'], options);
  assert.match(readable.stdout, /--game GAME_ID/);
  const queue = {
    schema_version: 1,
    user_id: '123',
    game: { id: '1423049311', title: 'Offline smoke test', client_id: '53652320436400298' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    items: [],
  };
  await writeFile(join(directory, 'queue.json'), JSON.stringify(queue));
  const result = await execute(
    executable,
    ['queue', 'show', '--file', 'queue.json', '--json'],
    options,
  );
  assert.deepEqual(JSON.parse(result.stdout).data, queue);
  const status = await execute(executable, ['doctor', '--json'], options);
  assert.equal(status.stderr, '');
  const diagnosis = JSON.parse(status.stdout).data;
  assert.equal(diagnosis.supported, true);
  assert.equal(typeof diagnosis.credentials_available, 'boolean');
  try {
    await execute(executable, ['unknown-command', '--json'], options);
    assert.fail('Unknown command must fail');
  } catch (error) {
    assert.equal(error.code, 2);
    assert.equal(JSON.parse(error.stdout).error.code, 'UNKNOWN_COMMAND');
  }
  process.stdout.write(
    'Standalone smoke checks passed (help, offline queue, bounded credential probe, JSON errors).\n',
  );
  if (!diagnosis.credentials_available)
    process.stdout.write(
      'The credential probe needs local access approval or an unlocked credential store.\n',
    );
} finally {
  await rm(directory, { recursive: true, force: true });
}
