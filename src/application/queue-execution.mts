import type { GogAPIPort, Context } from './achievement-ports.mjs';
import type { Session } from './auth-ports.mjs';
import type {
  Achievement,
  Game,
  Queue,
  QueueItem,
  LockQueueItem,
  LockResult,
  RestorationResult,
  RestorationReport,
} from '../domain/model.mjs';
import { GogError, requireValue } from '../domain/errors.mjs';
import { errorCode } from '../domain/objects.mjs';
import { validSession } from './session.mjs';

export interface QueueExecutionDependencies {
  api: Pick<GogAPIPort, 'achievements' | 'unlock' | 'lock' | 'refresh'>;
  wait: (ms: number) => Promise<unknown>;
}

export async function readAchievement(
  dependencies: QueueExecutionDependencies,
  game: Game,
  session: Session,
  achievementID: string,
): Promise<Achievement | undefined> {
  return (await dependencies.api.achievements(game, session)).find(
    (item) => item.id === achievementID,
  );
}

/** Poll with reads only. A write result is confirmed for the selected identity and state. */
export async function verifyAchievement(
  dependencies: QueueExecutionDependencies,
  game: Game,
  session: Session,
  achievementID: string,
  unlocked: boolean,
  expectedKey?: string,
): Promise<Achievement | undefined> {
  let achievement;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await dependencies.wait(500 * attempt);
    achievement = await readAchievement(dependencies, game, session, achievementID);
    if (
      achievement &&
      (expectedKey === undefined || achievement.key === expectedKey) &&
      achievement.unlocked === unlocked
    )
      break;
  }
  return achievement;
}

export async function restoreAchievement(
  dependencies: QueueExecutionDependencies,
  game: Game,
  session: Session,
  queued: QueueItem,
  result: RestorationResult,
): Promise<RestorationResult> {
  if (queued.action === 'lock') {
    requireValue(result.action === 'lock', 'INVALID_QUEUE', 'The queue action changed.');
    return lockAchievement(dependencies, game, session, queued, result);
  }
  requireValue(result.action !== 'lock', 'INVALID_QUEUE', 'The queue action changed.');
  let attempted = false;
  try {
    // Re-read before each write. GOG has no atomic compare/set operation.
    const latest = await readAchievement(dependencies, game, session, queued.achievement_id);
    requireValue(
      latest && latest.key === queued.key,
      'ACHIEVEMENT_CHANGED',
      'The achievement changed before the write.',
      5,
    );
    if (latest.unlocked)
      return {
        ...result,
        status: 'skipped_already_unlocked',
        actual_unlocked_at: latest.unlocked_at,
      };
    attempted = true;
    let writeError: unknown;
    try {
      await dependencies.api.unlock(game, session, queued.achievement_id, queued.unlocked_at);
    } catch (error) {
      writeError = error;
    }
    // Reconcile even after a lost POST response; never repeat that POST.
    const verified = await verifyAchievement(
      dependencies,
      game,
      session,
      queued.achievement_id,
      true,
      queued.key,
    );
    const observed = { ...result, actual_unlocked_at: verified?.unlocked_at ?? null };
    if (verified?.key === queued.key && verified.unlocked) {
      return Date.parse(verified.unlocked_at) === Date.parse(queued.unlocked_at)
        ? { ...observed, status: 'restored' }
        : {
            ...observed,
            status: 'restored_with_different_date',
            error_code: 'UNLOCK_DATE_MISMATCH',
          };
    }
    return {
      ...observed,
      status:
        verified?.key === queued.key &&
        ['API_REJECTED', 'AUTH_REJECTED'].some((code) => code === errorCode(writeError))
          ? 'failed'
          : 'unconfirmed',
      error_code: writeError instanceof GogError ? writeError.code : 'UNLOCK_NOT_CONFIRMED',
    };
  } catch (error) {
    return {
      ...result,
      status: attempted ? 'unconfirmed' : 'not_attempted',
      error_code: error instanceof GogError ? error.code : 'INTERNAL_ERROR',
    };
  }
}

export async function lockAchievement(
  dependencies: QueueExecutionDependencies,
  game: Game,
  session: Session,
  queued: LockQueueItem,
  result: LockResult,
): Promise<LockResult> {
  let attempted = false;
  let actualUnlockedAt = result.actual_unlocked_at;
  try {
    const latest = await readAchievement(dependencies, game, session, queued.achievement_id);
    if (latest) actualUnlockedAt = latest.unlocked_at;
    requireValue(
      latest && latest.key === queued.key,
      'ACHIEVEMENT_CHANGED',
      'The achievement changed before the write.',
      5,
    );
    if (!latest.unlocked)
      return { ...result, status: 'skipped_already_locked', actual_unlocked_at: null };
    requireValue(
      Date.parse(latest.unlocked_at) === Date.parse(queued.previous_unlocked_at),
      'ACHIEVEMENT_CHANGED',
      'The unlock date changed. Remove this lock request and review it again.',
      5,
    );
    attempted = true;
    let writeError: unknown;
    try {
      await dependencies.api.lock(game, session, queued.achievement_id);
    } catch (error) {
      writeError = error;
    }
    // Reconcile a lost response with reads only. Never repeat the lock POST.
    const verified = await verifyAchievement(
      dependencies,
      game,
      session,
      queued.achievement_id,
      false,
      queued.key,
    );
    const observed = { ...result, actual_unlocked_at: verified?.unlocked_at ?? null };
    if (verified && verified.key === queued.key && !verified.unlocked)
      return { ...observed, status: 'locked' };
    return {
      ...observed,
      status:
        verified?.key === queued.key &&
        ['API_REJECTED', 'AUTH_REJECTED'].some((code) => code === errorCode(writeError))
          ? 'failed'
          : 'unconfirmed',
      error_code: writeError instanceof GogError ? writeError.code : 'LOCK_NOT_CONFIRMED',
    };
  } catch (error) {
    return {
      ...result,
      actual_unlocked_at: actualUnlockedAt,
      status: attempted ? 'unconfirmed' : 'not_attempted',
      error_code: error instanceof GogError ? error.code : 'INTERNAL_ERROR',
    };
  }
}

export async function executeQueue(
  dependencies: QueueExecutionDependencies,
  queue: Queue,
  context: Context,
  report: RestorationReport,
): Promise<RestorationReport> {
  const results = report.results;
  const scoped = validSession(
    await dependencies.api.refresh(context.session.refresh_token, context.game),
  );
  requireValue(
    scoped.user_id === queue.user_id,
    'ACCOUNT_MISMATCH',
    'The game login belongs to another account.',
    5,
  );
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    if (result.status !== 'pending') continue;
    results[index] = await restoreAchievement(
      dependencies,
      context.game,
      scoped,
      queue.items[index]!,
      result,
    );
    const status = results[index]!.status;
    if (
      !['restored', 'skipped_already_unlocked', 'locked', 'skipped_already_locked'].includes(status)
    ) {
      report.complete = false;
      for (const remaining of results.slice(index + 1))
        if (remaining.status === 'pending') remaining.status = 'not_attempted';
      break;
    }
  }
  return report;
}
