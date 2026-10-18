import type { GogAPIPort, GamesResult, Context, AchievementsResult } from './achievement-ports.mjs';
import type {
  CredentialVault,
  Session,
  LoginOptions,
  SignalOptions,
  AuthStatus,
} from './auth-ports.mjs';
import type {
  PublicGame,
  Queue,
  Achievement,
  RestorationResult,
  Game,
  QueueItem,
  RestorationReport,
  AchievementAction,
  LockQueueItem,
  LockResult,
} from '../domain/model.mjs';
import { requireValue } from '../domain/errors.mjs';
import { id, timestamp, defaultTimestamp } from '../domain/values.mjs';
import {
  validateQueue,
  appendItems,
  queueSelection,
  removeItems,
  dateItems,
  validateAction,
} from '../domain/queue.mjs';
import { restorationPlan } from '../domain/restoration.mjs';
import { filterAchievements, type AchievementFilters } from '../domain/achievements.mjs';
import { buildLoginURL } from './oauth.mjs';
import * as execution from './queue-execution.mjs';
import type { AchievementServicePort } from './service-contract.mjs';
import * as auth from './session.mjs';
export interface ServiceDependencies {
  api: GogAPIPort;
  vault: CredentialVault;
  wait: (ms: number) => Promise<unknown>;
  now: () => number;
}
export class AchievementService implements AchievementServicePort {
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

  async listAchievements(
    gameID: unknown,
    filters: AchievementFilters = {},
  ): Promise<AchievementsResult> {
    const { session, game, achievements } = await this.context(gameID);
    const selected = filterAchievements(achievements, filters);
    return {
      user_id: session.user_id,
      game: this.publicGame(game),
      count: selected.length,
      achievements: selected,
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
    action?: AchievementAction,
  ): Queue {
    const date =
      action === 'lock'
        ? undefined
        : timestamp(unlockedAt ?? defaultTimestamp(this.now()), this.now());
    const items = appendItems(queue, achievementIDs, date, achievements, action);
    return validateQueue({ ...queue, items, updated_at: defaultTimestamp(this.now()) }, this.now());
  }

  async createQueue(
    gameID: unknown,
    achievementIDs: readonly unknown[] = [],
    unlockedAt?: unknown,
    action?: unknown,
  ): Promise<Queue> {
    const selectedAction = validateAction(action, unlockedAt);
    if (unlockedAt !== undefined) timestamp(unlockedAt, this.now());
    achievementIDs.forEach((value) => id(value, 'Achievement ID'));
    const { session, game, achievements } = await this.context(gameID);
    const queue: Queue = {
      schema_version: 1,
      user_id: session.user_id,
      game: this.publicGame(game),
      created_at: defaultTimestamp(this.now()),
      updated_at: defaultTimestamp(this.now()),
      items: [],
    };
    return this.addItems(queue, achievementIDs, unlockedAt, achievements, selectedAction);
  }

  async addToQueue(
    input: unknown,
    achievementIDs: readonly unknown[],
    unlockedAt?: unknown,
    action?: unknown,
  ): Promise<Queue> {
    const selectedAction = validateAction(action, unlockedAt);
    const queue = validateQueue(input, this.now());
    if (unlockedAt !== undefined) timestamp(unlockedAt, this.now());
    const context = await this.context(queue.game.id);
    this.assertQueueAccount(queue, context);
    return this.addItems(queue, achievementIDs, unlockedAt, context.achievements, selectedAction);
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

  // Compatibility methods delegate to the queue executor; application entry points stay below.
  readAchievement(
    game: Game,
    session: Session,
    achievementID: string,
  ): Promise<Achievement | undefined> {
    return execution.readAchievement(this, game, session, achievementID);
  }

  verifyUnlock(
    game: Game,
    session: Session,
    achievementID: string,
  ): Promise<Achievement | undefined> {
    return execution.verifyAchievement(this, game, session, achievementID, true);
  }

  restoreAchievement(
    game: Game,
    session: Session,
    queued: QueueItem,
    result: RestorationResult,
  ): Promise<RestorationResult> {
    return execution.restoreAchievement(this, game, session, queued, result);
  }

  lockAchievement(
    game: Game,
    session: Session,
    queued: LockQueueItem,
    result: LockResult,
  ): Promise<LockResult> {
    return execution.lockAchievement(this, game, session, queued, result);
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
    if (dryRun || !results.some((item) => item.status === 'pending')) return report;

    return execution.executeQueue(this, queue, context, report);
  }
}
