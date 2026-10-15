import type { Queue, QueueItem, PublicGame, Achievement, AchievementAction } from './model.mjs';
import { requireValue } from './errors.mjs';
import { fields, isArray } from './objects.mjs';
import { id, timestamp } from './values.mjs';

export function validateAction(
  value: unknown,
  unlockedAt?: unknown,
): AchievementAction | undefined {
  requireValue(
    value === undefined || value === 'unlock' || value === 'lock',
    'INVALID_ACTION',
    'Use --action unlock or --action lock.',
  );
  requireValue(
    value !== 'lock' || unlockedAt === undefined,
    'INVALID_ARGUMENTS',
    'Lock requests do not accept an unlock date.',
  );
  return value;
}

export function validateQueue(input: unknown, now: number): Queue {
  const queue = fields(input);
  requireValue(
    input && queue.schema_version === 1 && isArray(queue.items),
    'INVALID_QUEUE',
    'Use a queue with schema_version 1 and an items array.',
  );
  requireValue(
    Object.keys(queue).every((key) =>
      ['schema_version', 'user_id', 'game', 'created_at', 'updated_at', 'items'].includes(key),
    ),
    'INVALID_QUEUE',
    'The queue has an unknown field.',
  );
  const userID = id(queue.user_id, 'User ID');
  const game = fields(queue.game);
  const gameID = id(game.id, 'Game ID');
  const clientID = id(game.client_id, 'Client ID');
  requireValue(
    typeof game.title === 'string' &&
      Object.keys(game).every((key) => ['id', 'client_id', 'title'].includes(key)),
    'INVALID_QUEUE',
    'The queue game is not valid.',
  );
  const createdAt = timestamp(queue.created_at, now);
  const updatedAt = timestamp(queue.updated_at, now);
  requireValue(
    queue.items.length <= 1000,
    'INVALID_QUEUE',
    'A queue can contain at most 1000 achievements.',
  );
  const seen = new Set();
  const items: QueueItem[] = [];
  for (const raw of queue.items) {
    const item = fields(raw);
    const achievementID = id(item?.achievement_id, 'Achievement ID');
    requireValue(
      !seen.has(achievementID),
      'DUPLICATE_ACHIEVEMENT',
      'An achievement can occur only once in a queue.',
    );
    seen.add(achievementID);
    requireValue(
      typeof item.name === 'string' && typeof item.key === 'string' && item.key.length > 0,
      'INVALID_QUEUE',
      'The queue item is not valid.',
    );
    requireValue(
      item.action === undefined || item.action === 'unlock' || item.action === 'lock',
      'INVALID_QUEUE',
      'The queue item action must be unlock or lock.',
    );
    const lock = item.action === 'lock';
    const allowed = [
      'achievement_id',
      'key',
      'name',
      'action',
      lock ? 'previous_unlocked_at' : 'unlocked_at',
    ];
    requireValue(
      Object.keys(item).every((key) => allowed.includes(key)),
      'INVALID_QUEUE',
      'The queue item has a field that is not valid for its action.',
    );
    const base = { achievement_id: achievementID, key: item.key, name: item.name };
    if (lock) {
      // Keep the exact server date, including its precision and offset, for the pre-write check.
      requireValue(
        typeof item.previous_unlocked_at === 'string' &&
          Number.isFinite(Date.parse(item.previous_unlocked_at)),
        'INVALID_DATE',
        'A lock request must contain its previous unlock date.',
      );
      items.push({ ...base, action: 'lock', previous_unlocked_at: item.previous_unlocked_at });
    } else {
      const unlockedAt = timestamp(item.unlocked_at, now); // null is never a valid unlock request.
      items.push({
        ...base,
        ...(item.action === 'unlock' ? { action: 'unlock' as const } : {}),
        unlocked_at: unlockedAt,
      });
    }
  }
  return {
    ...queue,
    user_id: userID,
    schema_version: 1,
    game: { ...game, id: gameID, title: game.title, client_id: clientID },
    created_at: createdAt,
    updated_at: updatedAt,
    items,
  };
}
export type QueueView = Readonly<Omit<Queue, 'items' | 'game'>> & {
  readonly game: Readonly<PublicGame>;
  readonly items: readonly Readonly<QueueItem>[];
};
export function appendItems(
  queue: QueueView,
  achievementIDs: readonly unknown[],
  date: string | undefined,
  achievements: readonly Achievement[],
  action?: AchievementAction,
): QueueItem[] {
  const existing = new Set(queue.items.map((item) => item.achievement_id));
  const lookup = new Map(achievements.map((item) => [item.id, item]));
  const added: QueueItem[] = [];
  for (const value of achievementIDs) {
    const achievementID = id(value, 'Achievement ID');
    const item = lookup.get(achievementID);
    requireValue(item, 'ACHIEVEMENT_NOT_FOUND', 'The game does not have this achievement.', 5, {
      achievement_id: achievementID,
    });
    const base = { achievement_id: achievementID, key: item.key, name: item.name };
    let request: QueueItem;
    if (action === 'lock') {
      requireValue(item.unlocked, 'ALREADY_LOCKED', 'This achievement is already locked.', 5, {
        achievement_id: achievementID,
      });
      request = { ...base, action: 'lock', previous_unlocked_at: item.unlocked_at };
    } else {
      requireValue(
        !item.unlocked,
        'ALREADY_UNLOCKED',
        'This achievement is already unlocked. Its date will stay unchanged.',
        5,
        { achievement_id: achievementID },
      );
      requireValue(date !== undefined, 'INVALID_DATE', 'An unlock request needs a date.');
      request = { ...base, ...(action ? { action } : {}), unlocked_at: date };
    }
    requireValue(
      !existing.has(achievementID),
      'DUPLICATE_ACHIEVEMENT',
      'This achievement is already in the queue.',
      2,
      { achievement_id: achievementID },
    );
    existing.add(achievementID);
    added.push(request);
  }

  return [...queue.items, ...added];
}
export function queueSelection(
  queue: QueueView,
  achievementIDs: readonly unknown[],
): ReadonlySet<string> {
  const selected = new Set(achievementIDs.map((value) => id(value, 'Achievement ID')));
  const known = new Set(queue.items.map((item) => item.achievement_id));
  requireValue(
    [...selected].every((value) => known.has(value)),
    'ACHIEVEMENT_NOT_QUEUED',
    'One or more achievements are not in this queue.',
  );

  return selected;
}
export function removeItems(queue: QueueView, selected: ReadonlySet<string>): QueueItem[] {
  return queue.items.filter((item) => !selected.has(item.achievement_id));
}
export function dateItems(
  queue: QueueView,
  selected: ReadonlySet<string>,
  date: string,
): QueueItem[] {
  requireValue(
    queue.items.every((item) => !selected.has(item.achievement_id) || item.action !== 'lock'),
    'INVALID_ARGUMENTS',
    'Lock requests do not accept an unlock date. Select only unlock requests.',
  );
  return queue.items.map((item) =>
    selected.has(item.achievement_id) && item.action !== 'lock'
      ? { ...item, unlocked_at: date }
      : item,
  );
}
