import { writeFile, rename, unlink, open, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { GogError, requireValue } from '../domain/errors.mjs';
import { errorCode } from '../domain/objects.mjs';
import { validateQueue } from '../domain/queue.mjs';
import { parseJSON } from './json.mjs';
export async function readQueue(path: string) {
  try {
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      requireValue(
        stat.isFile() && stat.size <= 2_000_000,
        'INVALID_QUEUE',
        'The queue must be a JSON file smaller than 2 MB.',
      );
      return validateQueue(parseJSON(await file.readFile('utf8')), Date.now());
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof GogError) throw error;
    throw new GogError('QUEUE_READ_FAILED', 'Cannot read a valid queue from this file.', 2);
  }
}

export async function saveQueue(path: string, input: unknown, { create = false } = {}) {
  const queue = validateQueue(input, Date.now());
  const data = `${JSON.stringify(queue, null, 2)}\n`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
    if (create)
      await link(temporary, path); // Atomic creation; never replace an existing queue.
    else await rename(temporary, path);
  } catch (error) {
    throw new GogError(
      errorCode(error) === 'EEXIST' ? 'QUEUE_EXISTS' : 'QUEUE_WRITE_FAILED',
      errorCode(error) === 'EEXIST'
        ? 'The queue file already exists. Use another file.'
        : 'Cannot save the queue file.',
      2,
    );
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function withQueueLock<T>(path: string, operation: () => Promise<T>) {
  let lock;
  try {
    lock = await open(`${path}.lock`, 'wx', 0o600);
  } catch (error) {
    throw new GogError(
      errorCode(error) === 'EEXIST' ? 'QUEUE_BUSY' : 'QUEUE_LOCK_FAILED',
      errorCode(error) === 'EEXIST'
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
