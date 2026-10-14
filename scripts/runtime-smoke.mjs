import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'gog-runtime-'));
try {
  const queue = {
    schema_version: 1,
    user_id: '123',
    game: { id: '1423049311', title: 'Runtime smoke test', client_id: '53652320436400298' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    items: [],
  };
  const file = join(directory, 'queue.json');
  await writeFile(file, JSON.stringify(queue));
  for (const [args, code] of [
    [['--help', '--json'], 0],
    [['queue', 'show', '--file', file, '--json'], 0],
    [['unknown-command', '--json'], 2],
  ]) {
    assert.ok(Array.isArray(args) && typeof code === 'number');
    const result = spawnSync(process.execPath, [resolve('bin/gog-achievements.mjs'), ...args], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, code);
    const parsed = /** @type {unknown} */ (JSON.parse(result.stdout));
    assert.ok(parsed && typeof parsed === 'object' && 'ok' in parsed);
    assert.equal(parsed.ok, code === 0);
    if (args[0] === 'queue') {
      assert.ok('data' in parsed);
      assert.deepEqual(parsed.data, queue);
    }
  }
  process.stdout.write(`Emitted runtime smoke checks passed on Node ${process.versions.node}.\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
