import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJSON, timestamp, validateQueue, saveQueue, readQueue, withQueueLock } from '../src/data.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, DATE } from './fixture.mjs';

test('large numeric IDs keep all digits, and strings with escapes are unchanged', () => {
  const result = parseJSON('{"id":1007860867957265845,"small":42,"negative":-9007199254740993,"ratio":0.5,"text":"numeric 1007860867957265845 and \\\"quoted\\\""}');
  assert.equal(result.id, '1007860867957265845');
  assert.equal(result.negative, '-9007199254740993');
  assert.equal(result.small, 42);
  assert.equal(result.ratio, 0.5);
  assert.equal(result.text, 'numeric 1007860867957265845 and "quoted"');
});

test('unlock dates validate the calendar and zone and normalize to UTC seconds', () => {
  assert.equal(timestamp('2026-01-01T13:34:56+01:00'), DATE);
  assert.equal(timestamp('2024-02-29T12:00:00.123Z'), '2024-02-29T12:00:00Z');
  for (const value of ['2026-02-29T12:00:00Z', '2026-02-31T12:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T12:00:00', '2026-01-01T12:00:00+25:00', null]) {
    assert.throws(() => timestamp(value), error => error.code === 'INVALID_DATE');
  }
  assert.throws(() => timestamp('2099-01-01T00:00:00Z'), error => error.code === 'FUTURE_DATE');
});

test('queues reject resets, duplicate IDs and unknown operation fields', async () => {
  const { service } = fixture();
  const queue = await service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  assert.throws(() => validateQueue({ ...queue, items: [{ ...queue.items[0], unlocked_at: null }] }));
  assert.throws(() => validateQueue({ ...queue, items: [...queue.items, queue.items[0]] }), error => error.code === 'DUPLICATE_ACHIEVEMENT');
  assert.throws(() => validateQueue({ ...queue, operation: 'reset' }), error => error.code === 'INVALID_QUEUE');
});

test('queue files are private, cannot be overwritten on create, and lock competing writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-queue-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'queue.json');
  const queue = await fixture().service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  await saveQueue(file, queue, { create: true });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(saveQueue(file, queue, { create: true }), error => error.code === 'QUEUE_EXISTS');
  await withQueueLock(file, async () => {
    await assert.rejects(withQueueLock(file, async () => {}), error => error.code === 'QUEUE_BUSY');
  });
  assert.deepEqual(await readQueue(file), queue);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).items.length, 1);
});
