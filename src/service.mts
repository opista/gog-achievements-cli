import type {
  Session,
  Game,
  PublicGame,
  Achievement,
  Queue,
  QueueItem,
  Context,
  GogAPIPort,
  CredentialVault,
  LoginOptions,
  SignalOptions,
  AuthStatus,
  GamesResult,
  AchievementsResult,
  RestorationResult,
  RestorationReport,
} from './types.mjs';
import { fields, errorCode } from './validation.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { GogAPI, buildLoginURL, LOGIN_REDIRECT } from './api.mjs';
import { credentialVault } from './keychain.mjs';
import { GogError, requireValue } from './errors.mjs';
import { id, timestamp, defaultTimestamp, validateQueue } from './data.mjs';

export function validSession(value: unknown): Session {
  const session = fields(value);
  requireValue(
    value &&
      typeof session.access_token === 'string' &&
      session.access_token &&
      typeof session.refresh_token === 'string' &&
      session.refresh_token &&
      typeof session.expires_at === 'number' &&
      Number.isFinite(session.expires_at),
    'AUTH_REQUIRED',
    'Sign in with auth login.',
    3,
  );
  id(session.user_id, 'User ID');
  // All required fields are checked above; retain the original session object.
  return session as Record<string, unknown> & Session;
}

export class GogAchievements {
  api: GogAPIPort;
  vault: CredentialVault;
  wait: (ms: number) => Promise<unknown>;
  now: () => number;
  cachedSession: Session | null;
  constructor({
    api = new GogAPI(),
    vault = credentialVault(),
    wait = delay,
    now = Date.now,
  }: {
    api?: GogAPIPort;
    vault?: CredentialVault;
    wait?: (ms: number) => Promise<unknown>;
    now?: () => number;
  } = {}) {
    this.api = api;
    this.vault = vault;
    this.wait = wait;
    this.now = now;
    this.cachedSession = null;
  }

  loginURL(options?: LoginOptions) {
    return buildLoginURL(options);
  }

  async finishLogin(
    input: string,
    { redirectURI = LOGIN_REDIRECT, signal }: LoginOptions & SignalOptions = {},
  ): Promise<AuthStatus> {
    const checkCancelled = () => {
      if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
    };
    checkCancelled();
    let code = input.trim();
    if (/^https?:/i.test(code)) {
      let url;
      try {
        url = new URL(code);
      } catch {
        throw new GogError('INVALID_LOGIN_CODE', 'Use the final GOG login URL.', 2);
      }
      requireValue(
        url.protocol === 'https:' &&
          ['embed.gog.com', 'www.gog.com'].includes(url.hostname) &&
          url.pathname.replace(/\/$/, '') === '/on_login_success' &&
          !url.username &&
          !url.password &&
          !url.port,
        'INVALID_LOGIN_CODE',
        'This URL is not the GOG login callback. Run auth login for automatic sign-in.',
        2,
      );
      code = url.searchParams.get('code') ?? '';
    }
    requireValue(
      /^[A-Za-z0-9._~+=/-]{1,4096}$/.test(code),
      'INVALID_LOGIN_CODE',
      'The login code is missing or not valid.',
      2,
    );
    let session;
    try {
      session = validSession(await this.api.exchangeCode(code, redirectURI, { signal }));
    } catch (error) {
      checkCancelled();
      throw error;
    }
    checkCancelled();
    try {
      await this.vault.set(session, { interactive: true, signal });
    } catch (error) {
      checkCancelled();
      throw error;
    }
    checkCancelled();
    this.cachedSession = session;
    return {
      authenticated: true,
      user_id: session.user_id,
      storage: this.vault.storage ?? 'macos_keychain',
    };
  }

  async importLogin(input: string): Promise<AuthStatus> {
    const refreshToken = input.trim();
    requireValue(
      refreshToken.length > 0 && refreshToken.length <= 16_000 && !/\s/.test(refreshToken),
      'INVALID_CREDENTIALS',
      'Supply one refresh token through stdin.',
      2,
    );
    const session = validSession(await this.api.refresh(refreshToken));
    await this.vault.set(session, { interactive: true });
    this.cachedSession = session;
    return {
      authenticated: true,
      user_id: session.user_id,
      storage: this.vault.storage ?? 'macos_keychain',
    };
  }

  async authStatus(): Promise<AuthStatus> {
    const stored = await this.vault.get();
    if (!stored) return { authenticated: false, storage: this.vault.storage ?? 'macos_keychain' };
    const session = validSession(stored);
    return {
      authenticated: true,
      user_id: session.user_id,
      expired: session.expires_at <= this.now(),
      storage: this.vault.storage ?? 'macos_keychain',
    };
  }

  async logout(): Promise<AuthStatus> {
    await this.vault.remove();
    this.cachedSession = null;
    return { authenticated: false, local_login_removed: true };
  }

  async session() {
    let session = validSession(this.cachedSession ?? (await this.vault.get()));
    if (session.expires_at <= this.now() + 30_000) {
      const refreshed = validSession(await this.api.refresh(session.refresh_token));
      requireValue(
        refreshed.user_id === session.user_id,
        'ACCOUNT_MISMATCH',
        'The refreshed login belongs to another account.',
        5,
      );
      await this.vault.set(refreshed);
      session = refreshed;
    }
    this.cachedSession = session;
    return session;
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
    const existing = new Set(queue.items.map((item) => item.achievement_id));
    const lookup = new Map(achievements.map((item) => [item.id, item]));
    const added = [];
    for (const value of achievementIDs) {
      const achievementID = id(value, 'Achievement ID');
      const item = lookup.get(achievementID);
      requireValue(item, 'ACHIEVEMENT_NOT_FOUND', 'The game does not have this achievement.', 5, {
        achievement_id: achievementID,
      });
      requireValue(
        !item.unlocked,
        'ALREADY_UNLOCKED',
        'This achievement is already unlocked. Its date will stay unchanged.',
        5,
        { achievement_id: achievementID },
      );
      requireValue(
        !existing.has(achievementID),
        'DUPLICATE_ACHIEVEMENT',
        'This achievement is already in the queue.',
        2,
        { achievement_id: achievementID },
      );
      existing.add(achievementID);
      added.push({
        achievement_id: achievementID,
        key: item.key,
        name: item.name,
        unlocked_at: date,
      });
    }
    return validateQueue(
      { ...queue, items: [...queue.items, ...added], updated_at: defaultTimestamp(this.now()) },
      this.now(),
    );
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
    const selected = new Set(achievementIDs.map((value) => id(value, 'Achievement ID')));
    const known = new Set(queue.items.map((item) => item.achievement_id));
    requireValue(
      [...selected].every((value) => known.has(value)),
      'ACHIEVEMENT_NOT_QUEUED',
      'One or more achievements are not in this queue.',
    );
    const date = remove ? null : timestamp(unlockedAt, this.now());
    const items = remove
      ? queue.items.filter((item) => !selected.has(item.achievement_id))
      : queue.items.map((item) =>
          selected.has(item.achievement_id) ? { ...item, unlocked_at: date } : item,
        );
    return validateQueue({ ...queue, items, updated_at: defaultTimestamp(this.now()) }, this.now());
  }

  planRestoration(queue: Queue, context: Pick<Context, 'achievements'>): RestorationResult[] {
    const lookup = new Map(context.achievements.map((item) => [item.id, item]));
    // Check the entire queue before the first write.
    return queue.items.map((item) => {
      const current = lookup.get(item.achievement_id);
      requireValue(
        current && current.key === item.key,
        'ACHIEVEMENT_CHANGED',
        'An achievement is missing or its key changed. Create a new queue.',
        5,
        { achievement_id: item.achievement_id },
      );
      return {
        achievement_id: item.achievement_id,
        name: current.name,
        requested_unlocked_at: item.unlocked_at,
        previous_unlocked_at: current.unlocked_at,
        actual_unlocked_at: current.unlocked_at,
        status: current.unlocked ? 'skipped_already_unlocked' : 'pending',
      };
    });
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
