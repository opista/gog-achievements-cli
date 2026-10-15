import type { Achievement, RestorationResult } from './model.mjs';
import { requireValue } from './errors.mjs';
import type { QueueView } from './queue.mjs';
export function restorationPlan(
  queue: QueueView,
  context: { achievements: readonly Achievement[] },
): RestorationResult[] {
  const lookup = new Map(context.achievements.map((item) => [item.id, item]));
  // Check the entire queue before the first write.
  return queue.items.map((item): RestorationResult => {
    const current = lookup.get(item.achievement_id);
    requireValue(
      current && current.key === item.key,
      'ACHIEVEMENT_CHANGED',
      'An achievement is missing or its key changed. Create a new queue.',
      5,
      { achievement_id: item.achievement_id },
    );
    if (item.action === 'lock') {
      requireValue(
        !current.unlocked ||
          Date.parse(current.unlocked_at) === Date.parse(item.previous_unlocked_at),
        'ACHIEVEMENT_CHANGED',
        'An unlock date changed. Remove that lock request and review it again.',
        5,
        { achievement_id: item.achievement_id },
      );
      return {
        achievement_id: item.achievement_id,
        name: current.name,
        action: 'lock',
        requested_unlocked_at: null,
        previous_unlocked_at: item.previous_unlocked_at,
        actual_unlocked_at: current.unlocked_at,
        status: current.unlocked ? 'pending' : 'skipped_already_locked',
      };
    }
    return {
      achievement_id: item.achievement_id,
      name: current.name,
      ...(item.action ? { action: item.action } : {}),
      requested_unlocked_at: item.unlocked_at,
      previous_unlocked_at: current.unlocked_at,
      actual_unlocked_at: current.unlocked_at,
      status: current.unlocked ? 'skipped_already_unlocked' : 'pending',
    };
  });
}
