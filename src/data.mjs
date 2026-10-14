import { writeFile, rename, unlink, open, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { GogError, requireValue } from './errors.mjs';

export function id(value, label = 'ID') {
  requireValue(
    typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)),
    'INVALID_ID',
    `${label} must be a decimal string.`,
  );
  const result = String(value);
  requireValue(
    /^[1-9]\d{0,29}$/.test(result),
    'INVALID_ID',
    `${label} must be a positive decimal string.`,
  );
  return result;
}

export function timestamp(value, now = Date.now()) {
  requireValue(typeof value === 'string', 'INVALID_DATE', 'Use an RFC 3339 date with a time zone.');
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  requireValue(
    match,
    'INVALID_DATE',
    'Use an RFC 3339 date with a time zone, such as 2026-10-01T18:30:00+01:00.',
  );
  const [, y, m, d, h, minute, s, zone] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +h, +minute, +s));
  const valid =
    +y >= 1970 &&
    +y <= 9999 &&
    date.getUTCFullYear() === +y &&
    date.getUTCMonth() === +m - 1 &&
    date.getUTCDate() === +d &&
    +h < 24 &&
    +minute < 60 &&
    +s < 60 &&
    (zone === 'Z' || (+zone.slice(1, 3) < 24 && +zone.slice(4) < 60));
  const parsed = Date.parse(value);
  requireValue(
    valid && Number.isFinite(parsed) && parsed >= 0,
    'INVALID_DATE',
    'The unlock date is not valid.',
  );
  requireValue(parsed <= now, 'FUTURE_DATE', 'The unlock date cannot be in the future.');
  return new Date(Math.floor(parsed / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export function defaultTimestamp(now = Date.now()) {
  return timestamp(new Date(now - 10_000).toISOString(), now);
}

// Preserve large GOG client, build, user and achievement IDs before JSON.parse
// can round them. Tokens inside quoted strings are never changed.
export function parseJSON(text) {
  let safe = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index++] === '"') break;
      }
      safe += text.slice(start, index);
    } else if (char === '-' || /\d/.test(char)) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))?.[0];
      if (!token) {
        safe += char;
        index++;
        continue;
      }
      const unsafe =
        /^-?\d+$/.test(token) &&
        (BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER) ||
          BigInt(token) < BigInt(Number.MIN_SAFE_INTEGER));
      safe += unsafe ? JSON.stringify(token) : token;
      index += token.length;
    } else {
      safe += char;
      index++;
    }
  }
  return JSON.parse(safe);
}

export function validateQueue(queue, now = Date.now()) {
  requireValue(
    queue && queue.schema_version === 1 && Array.isArray(queue.items),
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
  const gameID = id(queue.game?.id, 'Game ID');
  const clientID = id(queue.game?.client_id, 'Client ID');
  requireValue(
    typeof queue.game.title === 'string' &&
      Object.keys(queue.game).every((key) => ['id', 'client_id', 'title'].includes(key)),
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
  const items = [];
  for (const item of queue.items) {
    const achievementID = id(item?.achievement_id, 'Achievement ID');
    requireValue(
      !seen.has(achievementID),
      'DUPLICATE_ACHIEVEMENT',
      'An achievement can occur only once in a queue.',
    );
    seen.add(achievementID);
    requireValue(
      typeof item.name === 'string' &&
        typeof item.key === 'string' &&
        item.key.length > 0 &&
        Object.keys(item).every((key) =>
          ['achievement_id', 'key', 'name', 'unlocked_at'].includes(key),
        ),
      'INVALID_QUEUE',
      'The queue item is not valid.',
    );
    const unlockedAt = timestamp(item.unlocked_at, now); // null is never a valid unlock request.
    items.push({ ...item, achievement_id: achievementID, unlocked_at: unlockedAt });
  }
  return {
    ...queue,
    user_id: userID,
    game: { ...queue.game, id: gameID, client_id: clientID },
    created_at: createdAt,
    updated_at: updatedAt,
    items,
  };
}

export async function readQueue(path) {
  try {
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      requireValue(
        stat.isFile() && stat.size <= 2_000_000,
        'INVALID_QUEUE',
        'The queue must be a JSON file smaller than 2 MB.',
      );
      return validateQueue(parseJSON(await file.readFile('utf8')));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof GogError) throw error;
    throw new GogError('QUEUE_READ_FAILED', 'Cannot read a valid queue from this file.', 2);
  }
}

export async function saveQueue(path, queue, { create = false } = {}) {
  queue = validateQueue(queue);
  const data = `${JSON.stringify(queue, null, 2)}\n`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
    if (create)
      await link(temporary, path); // Atomic creation; never replace an existing queue.
    else await rename(temporary, path);
  } catch (error) {
    throw new GogError(
      error.code === 'EEXIST' ? 'QUEUE_EXISTS' : 'QUEUE_WRITE_FAILED',
      error.code === 'EEXIST'
        ? 'The queue file already exists. Use another file.'
        : 'Cannot save the queue file.',
      2,
    );
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function withQueueLock(path, operation) {
  let lock;
  try {
    lock = await open(`${path}.lock`, 'wx', 0o600);
  } catch (error) {
    throw new GogError(
      error.code === 'EEXIST' ? 'QUEUE_BUSY' : 'QUEUE_LOCK_FAILED',
      error.code === 'EEXIST'
        ? 'The queue is in use. Check its .lock file before retrying.'
        : 'Cannot lock the queue.',
      5,
    );
  }
  try {
    await lock.writeFile(
      `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
    );
    return await operation();
  } finally {
    try {
      await lock.close();
    } finally {
      await unlink(`${path}.lock`).catch(() => {});
    }
  }
}
