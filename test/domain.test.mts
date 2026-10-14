import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendItems,
  dateItems,
  queueSelection,
  removeItems,
  validateQueue,
} from '../src/domain/queue.mjs';
import { restorationPlan } from '../src/domain/restoration.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, SECOND_ID, DATE } from './fixture.mjs';

void test('queue transformations and restoration planning accept frozen inputs without changing them', async () => {
  const f = fixture();
  const now = Date.parse('2026-10-14T00:00:00Z');
  f.service.now = () => now;
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  const { achievements } = await f.service.context(GAME_ID);
  const original = structuredClone(queue);
  Object.freeze(queue.game);
  queue.items.forEach(Object.freeze);
  Object.freeze(queue.items);
  Object.freeze(queue);
  achievements.forEach(Object.freeze);
  Object.freeze(achievements);

  const added = { ...queue, items: appendItems(queue, [SECOND_ID], DATE, achievements) };
  added.items.forEach(Object.freeze);
  Object.freeze(added.items);
  Object.freeze(added);
  const selected = queueSelection(added, [SECOND_ID]);
  const changed = dateItems(added, selected, '2026-02-01T00:00:00Z');
  assert.equal(changed[0]!.unlocked_at, DATE);
  assert.equal(changed[1]!.unlocked_at, '2026-02-01T00:00:00Z');
  assert.deepEqual(removeItems(added, selected), queue.items);
  assert.deepEqual(validateQueue(queue, now), original);
  const plan = restorationPlan(added, { achievements });
  assert.deepEqual(
    plan.map((item) => item.status),
    ['pending', 'pending'],
  );
  assert.equal(plan[1]!.requested_unlocked_at, DATE);
  assert.deepEqual(queue, original);
  assert.equal(added.items[1]!.unlocked_at, DATE);
  assert.equal(f.writes.length, 0);
});
