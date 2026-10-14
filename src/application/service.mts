import type {
  GogAPIPort,
  CredentialVault,
  Session,
  LoginOptions,
  SignalOptions,
  AuthStatus,
  GamesResult,
  Context,
  AchievementsResult,
} from './ports.mjs';
import type {
  PublicGame,
  Queue,
  Achievement,
  RestorationResult,
  Game,
  QueueItem,
  RestorationReport,
} from '../domain/model.mjs';
import { GogError, requireValue } from '../domain/errors.mjs';
import { errorCode } from '../domain/objects.mjs';
import { id, timestamp, defaultTimestamp } from '../domain/values.mjs';
import {
  validateQueue,
  appendItems,
  queueSelection,
  removeItems,
  dateItems,
} from '../domain/queue.mjs';
import { restorationPlan } from '../domain/restoration.mjs';
import { buildLoginURL } from './oauth.mjs';
import { validSession } from './session.mjs';
import * as auth from './session.mjs';
export interface ServiceDependencies {
  api: GogAPIPort;
  vault: CredentialVault;
  wait: (ms: number) => Promise<unknown>;
  now: () => number;
}
export class AchievementService {
  api: GogAPIPort;
  vault: CredentialVault;
  wait: (ms: number) => Promise<unknown>;
  now: () => number;
  cachedSession: Session | null;
  constructor({ api, vault, wait, now }: ServiceDependencies) {
    this.api = api;
    this.vault = vault;
    this.wait = wait;
    this.now = now;
    this.cachedSession = null;
  }

  loginURL(options?: LoginOptions) {
    return buildLoginURL(options);
  }

  finishLogin(input: string, options: LoginOptions & SignalOptions = {}): Promise<AuthStatus> {
    return auth.finishLogin(this, input, options);
  }

  importLogin(input: string): Promise<AuthStatus> {
    return auth.importLogin(this, input);
  }

  authStatus(): Promise<AuthStatus> {
    return auth.authStatus(this);
  }

  logout(): Promise<AuthStatus> {
    return auth.logout(this);
  }

  session() {
    return auth.session(this);
  }

  async listGames({
    search = '',
    idsOnly = false,
  }: { search?: string | undefined; idsOnly?: boolean | undefined } = {}): Promise<GamesResult> {
    const session = await this.session();
    const games = idsOnly
      ? (await this.api.ownedIDs(session.access_token)).map((gameID) => ({ id: gameID }))
      : await this.api.games(session.access_token, search);
    return { user_id: session.user_id, count: games.length, games };
  }

  async context(value: unknown): Promise<Context> {
    const gameID = id(value, 'Game ID');
    const session = await this.session();
    const owned = await this.api.ownedIDs(session.access_token);
    requireValue(
      owned.includes(gameID),
      'GAME_NOT_OWNED',
      'The signed-in account does not own this game.',
      5,
    );
    const game = await this.api.game(gameID);
    const achievements = await this.api.achievements(game, session);
    return { session, game, achievements };
  }

  async listAchievements(gameID: unknown): Promise<AchievementsResult> {
    const { session, game, achievements } = await this.context(gameID);
    return {
      user_id: session.user_id,
      game: this.publicGame(game),
      count: achievements.length,
      achievements,
    };
  }

  publicGame(game: PublicGame): PublicGame {
    return { id: game.id, title: game.title, client_id: game.client_id };
  }

  assertQueueAccount(queue: Queue, context: Context) {
    requireValue(
      queue.user_id === context.session.user_id,
      'ACCOUNT_MISMATCH',
      'The queue belongs to another GOG account.',
      5,
    );
    requireValue(
      queue.game.client_id === context.game.client_id,
      'GAME_CLIENT_CHANGED',
      'The game client changed. Create a new queue.',
      5,
    );
  }

  addItems(
    queue: Queue,
    achievementIDs: readonly unknown[],
    unlockedAt: unknown,
    achievements: readonly Achievement[],
  ): Queue {
    const date = timestamp(unlockedAt ?? defaultTimestamp(this.now()), this.now());
    const items = appendItems(queue, achievementIDs, date, achievements);
    return validateQueue({ ...queue, items, updated_at: defaultTimestamp(this.now()) }, this.now());
  }

  async createQueue(
    gameID: unknown,
    achievementIDs: readonly unknown[] = [],
    unlockedAt?: unknown,
  ): Promise<Queue> {
    if (unlockedAt !== undefined) timestamp(unlockedAt, this.now());
    achievementIDs.forEach((value) => id(value, 'Achievement ID'));
    const { session, game, achievements } = await this.context(gameID);
    const queue: Queue = {
      schema_version: 1,
      user_id: String(session.user_id),
      game: this.publicGame(game),
      created_at: defaultTimestamp(this.now()),
      updated_at: defaultTimestamp(this.now()),
      items: [],
    };
    return this.addItems(queue, achievementIDs, unlockedAt, achievements);
  }

  async addToQueue(
    input: unknown,
    achievementIDs: readonly unknown[],
    unlockedAt?: unknown,
  ): Promise<Queue> {
    const queue = validateQueue(input, this.now());
    if (unlockedAt !== undefined) timestamp(unlockedAt, this.now());
    const context = await this.context(queue.game.id);
    this.assertQueueAccount(queue, context);
    return this.addItems(queue, achievementIDs, unlockedAt, context.achievements);
  }

  editQueue(
    input: unknown,
    achievementIDs: readonly unknown[],
    { unlockedAt, remove = false }: { unlockedAt?: unknown; remove?: boolean } = {},
  ): Queue {
    const queue = validateQueue(input, this.now());
    const selected = queueSelection(queue, achievementIDs);
    const items = remove
      ? removeItems(queue, selected)
      : dateItems(queue, selected, timestamp(unlockedAt, this.now()));
    return validateQueue({ ...queue, items, updated_at: defaultTimestamp(this.now()) }, this.now());
  }

  planRestoration(queue: Queue, context: Pick<Context, 'achievements'>): RestorationResult[] {
    return restorationPlan(queue, context);
  }

  async readAchievement(
    game: Game,
    session: Session,
    achievementID: string,
  ): Promise<Achievement | undefined> {
    return (await this.api.achievements(game, session)).find((item) => item.id === achievementID);
  }

  async verifyUnlock(
    game: Game,
    session: Session,
    achievementID: string,
  ): Promise<Achievement | undefined> {
    let achievement;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await this.wait(500 * attempt);
      achievement = await this.readAchievement(game, session, achievementID);
      if (achievement?.unlocked) break;
    }
    return achievement;
  }

  async restoreAchievement(
    game: Game,
    session: Session,
    queued: QueueItem,
    result: RestorationResult,
  ): Promise<RestorationResult> {
    let attempted = false;
    try {
      // Re-read before each write. GOG has no atomic compare/set operation.
      const latest = await this.readAchievement(game, session, queued.achievement_id);
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
        await this.api.unlock(game, session, queued.achievement_id, queued.unlocked_at);
      } catch (error) {
        writeError = error;
      }
      // Reconcile even after a lost POST response; never repeat that POST.
      const verified = await this.verifyUnlock(game, session, queued.achievement_id);
      const observed = { ...result, actual_unlocked_at: verified?.unlocked_at ?? null };
      if (verified?.unlocked) {
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
        status: ['API_REJECTED', 'AUTH_REJECTED'].some((code) => code === errorCode(writeError))
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

  async applyQueue(input: unknown, { dryRun = true } = {}): Promise<RestorationReport> {
    const queue = validateQueue(input, this.now());
    requireValue(
      queue.items.length,
      'EMPTY_QUEUE',
      'Add an achievement before applying this queue.',
    );
    const context = await this.context(queue.game.id);
    this.assertQueueAccount(queue, context);
    const results = this.planRestoration(queue, context);
    const report: RestorationReport = {
      dry_run: dryRun,
      user_id: queue.user_id,
      game: this.publicGame(context.game),
      complete: true,
      results,
    };
    if (dryRun || results.every((item) => item.status === 'skipped_already_unlocked'))
      return report;

    const scoped = validSession(
      await this.api.refresh(context.session.refresh_token, context.game),
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
      results[index] = await this.restoreAchievement(
        context.game,
        scoped,
        queue.items[index]!,
        result,
      );
      const status = results[index]!.status;
      if (status !== 'restored' && status !== 'skipped_already_unlocked') {
        report.complete = false;
        for (const remaining of results.slice(index + 1))
          if (remaining.status === 'pending') remaining.status = 'not_attempted';
        break;
      }
    }
    return report;
  }
}
