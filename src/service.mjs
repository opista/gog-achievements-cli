import { setTimeout as delay } from 'node:timers/promises';
import { GogAPI, buildLoginURL, LOGIN_REDIRECT } from './api.mjs';
import { MacKeychain } from './keychain.mjs';
import { GogError, requireValue } from './errors.mjs';
import { id, timestamp, defaultTimestamp, validateQueue } from './data.mjs';

function validSession(session) {
  requireValue(session && typeof session.access_token === 'string' && session.access_token &&
    typeof session.refresh_token === 'string' && session.refresh_token && Number.isFinite(session.expires_at),
    'AUTH_REQUIRED', 'Sign in with auth login.', 3);
  id(session.user_id, 'User ID');
  return session;
}

export class GogAchievements {
  constructor({ api = new GogAPI(), vault = new MacKeychain(), wait = delay, now = Date.now } = {}) {
    this.api = api;
    this.vault = vault;
    this.wait = wait;
    this.now = now;
    this.cachedSession = null;
  }

  loginURL(options) { return buildLoginURL(options); }

  async finishLogin(input, { redirectURI = LOGIN_REDIRECT, signal } = {}) {
    const checkCancelled = () => {
      if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
    };
    checkCancelled();
    let code = input.trim();
    if (/^https?:/i.test(code)) {
      let url;
      try { url = new URL(code); } catch { throw new GogError('INVALID_LOGIN_CODE', 'Use the final GOG login URL.', 2); }
      requireValue(url.protocol === 'https:' && ['embed.gog.com', 'www.gog.com'].includes(url.hostname) &&
        url.pathname.replace(/\/$/, '') === '/on_login_success' && !url.username && !url.password && !url.port,
        'INVALID_LOGIN_CODE', 'This URL is not the GOG login callback. Run auth login for automatic sign-in.', 2);
      code = url.searchParams.get('code') ?? '';
    }
    requireValue(/^[A-Za-z0-9._~+=/-]{1,4096}$/.test(code), 'INVALID_LOGIN_CODE', 'The login code is missing or not valid.', 2);
    let session;
    try { session = validSession(await this.api.exchangeCode(code, redirectURI, { signal })); }
    catch (error) { checkCancelled(); throw error; }
    checkCancelled();
    await this.vault.set(session);
    this.cachedSession = session;
    return { authenticated: true, user_id: session.user_id, storage: 'macos_keychain' };
  }

  async importLogin(input) {
    const refreshToken = input.trim();
    requireValue(refreshToken.length > 0 && refreshToken.length <= 16_000 && !/\s/.test(refreshToken),
      'INVALID_CREDENTIALS', 'Supply one refresh token through stdin.', 2);
    const session = validSession(await this.api.refresh(refreshToken));
    await this.vault.set(session);
    this.cachedSession = session;
    return { authenticated: true, user_id: session.user_id, storage: 'macos_keychain' };
  }

  async authStatus() {
    const session = await this.vault.get();
    if (!session) return { authenticated: false, storage: 'macos_keychain' };
    validSession(session);
    return { authenticated: true, user_id: session.user_id, expired: session.expires_at <= this.now(), storage: 'macos_keychain' };
  }

  async logout() {
    await this.vault.remove();
    this.cachedSession = null;
    return { authenticated: false, local_login_removed: true };
  }

  async session() {
    let session = validSession(this.cachedSession ?? await this.vault.get());
    if (session.expires_at <= this.now() + 30_000) {
      const refreshed = validSession(await this.api.refresh(session.refresh_token));
      requireValue(refreshed.user_id === session.user_id, 'ACCOUNT_MISMATCH', 'The refreshed login belongs to another account.', 5);
      await this.vault.set(refreshed);
      session = refreshed;
    }
    this.cachedSession = session;
    return session;
  }

  async listGames({ search = '', idsOnly = false } = {}) {
    const session = await this.session();
    const games = idsOnly ? (await this.api.ownedIDs(session.access_token)).map(gameID => ({ id: gameID })) :
      await this.api.games(session.access_token, search);
    return { user_id: session.user_id, count: games.length, games };
  }

  async context(gameID) {
    gameID = id(gameID, 'Game ID');
    const session = await this.session();
    const owned = await this.api.ownedIDs(session.access_token);
    requireValue(owned.includes(gameID), 'GAME_NOT_OWNED', 'The signed-in account does not own this game.', 5);
    const game = await this.api.game(gameID);
    const achievements = await this.api.achievements(game, session);
    return { session, game, achievements };
  }

  async listAchievements(gameID) {
    const { session, game, achievements } = await this.context(gameID);
    return { user_id: session.user_id, game: this.publicGame(game), count: achievements.length, achievements };
  }

  publicGame(game) { return { id: game.id, title: game.title, client_id: game.client_id }; }

  assertQueueAccount(queue, context) {
    requireValue(queue.user_id === context.session.user_id, 'ACCOUNT_MISMATCH', 'The queue belongs to another GOG account.', 5);
    requireValue(queue.game.client_id === context.game.client_id, 'GAME_CLIENT_CHANGED', 'The game client changed. Create a new queue.', 5);
  }

  addItems(queue, achievementIDs, unlockedAt, achievements) {
    const date = timestamp(unlockedAt ?? defaultTimestamp(this.now()), this.now());
    const existing = new Set(queue.items.map(item => item.achievement_id));
    const lookup = new Map(achievements.map(item => [item.id, item]));
    const added = [];
    for (const value of achievementIDs) {
      const achievementID = id(value, 'Achievement ID');
      const item = lookup.get(achievementID);
      requireValue(item, 'ACHIEVEMENT_NOT_FOUND', 'The game does not have this achievement.', 5, { achievement_id: achievementID });
      requireValue(!item.unlocked, 'ALREADY_UNLOCKED', 'This achievement is already unlocked. Its date will stay unchanged.', 5, { achievement_id: achievementID });
      requireValue(!existing.has(achievementID), 'DUPLICATE_ACHIEVEMENT', 'This achievement is already in the queue.', 2, { achievement_id: achievementID });
      existing.add(achievementID);
      added.push({ achievement_id: achievementID, key: item.key, name: item.name, unlocked_at: date });
    }
    return validateQueue({ ...queue, items: [...queue.items, ...added], updated_at: defaultTimestamp(this.now()) }, this.now());
  }

  async createQueue(gameID, achievementIDs = [], unlockedAt) {
    if (unlockedAt !== undefined) timestamp(unlockedAt, this.now());
    achievementIDs.forEach(value => id(value, 'Achievement ID'));
    const { session, game, achievements } = await this.context(gameID);
    const queue = { schema_version: 1, user_id: session.user_id, game: this.publicGame(game),
      created_at: defaultTimestamp(this.now()), updated_at: defaultTimestamp(this.now()), items: [] };
    return this.addItems(queue, achievementIDs, unlockedAt, achievements);
  }

  async addToQueue(queue, achievementIDs, unlockedAt) {
    validateQueue(queue, this.now());
    if (unlockedAt !== undefined) timestamp(unlockedAt, this.now());
    const context = await this.context(queue.game.id);
    this.assertQueueAccount(queue, context);
    return this.addItems(queue, achievementIDs, unlockedAt, context.achievements);
  }

  editQueue(queue, achievementIDs, { unlockedAt, remove = false } = {}) {
    validateQueue(queue, this.now());
    const selected = new Set(achievementIDs.map(value => id(value, 'Achievement ID')));
    const known = new Set(queue.items.map(item => item.achievement_id));
    requireValue([...selected].every(value => known.has(value)), 'ACHIEVEMENT_NOT_QUEUED', 'One or more achievements are not in this queue.');
    const date = remove ? null : timestamp(unlockedAt, this.now());
    const items = remove ? queue.items.filter(item => !selected.has(item.achievement_id)) :
      queue.items.map(item => selected.has(item.achievement_id) ? { ...item, unlocked_at: date } : item);
    return validateQueue({ ...queue, items, updated_at: defaultTimestamp(this.now()) }, this.now());
  }

  async applyQueue(queue, { dryRun = true } = {}) {
    validateQueue(queue, this.now());
    requireValue(queue.items.length, 'EMPTY_QUEUE', 'Add an achievement before applying this queue.');
    const context = await this.context(queue.game.id);
    this.assertQueueAccount(queue, context);
    const lookup = new Map(context.achievements.map(item => [item.id, item]));
    // Check the entire queue before the first write.
    const results = queue.items.map(item => {
      const current = lookup.get(item.achievement_id);
      requireValue(current && current.key === item.key, 'ACHIEVEMENT_CHANGED', 'An achievement is missing or its key changed. Create a new queue.', 5,
        { achievement_id: item.achievement_id });
      return { achievement_id: item.achievement_id, name: current.name, requested_unlocked_at: item.unlocked_at,
        previous_unlocked_at: current.unlocked_at, actual_unlocked_at: current.unlocked_at,
        status: current.unlocked ? 'skipped_already_unlocked' : 'pending' };
    });
    const report = { dry_run: dryRun, user_id: queue.user_id, game: this.publicGame(context.game), complete: true, results };
    if (dryRun || results.every(item => item.status === 'skipped_already_unlocked')) return report;

    const scoped = validSession(await this.api.refresh(context.session.refresh_token, context.game));
    requireValue(scoped.user_id === queue.user_id, 'ACCOUNT_MISMATCH', 'The game login belongs to another account.', 5);
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result.status !== 'pending') continue;
      let attempted = false;
      try {
        // Re-read immediately before each write to protect achievements earned
        // since the initial preview. The remote API has no atomic compare/set.
        const latest = (await this.api.achievements(context.game, scoped)).find(item => item.id === result.achievement_id);
        requireValue(latest && latest.key === queue.items[index].key, 'ACHIEVEMENT_CHANGED', 'The achievement changed before the write.', 5);
        if (latest.unlocked) {
          result.status = 'skipped_already_unlocked';
          result.actual_unlocked_at = latest.unlocked_at;
          continue;
        }
        attempted = true;
        let writeError;
        try { await this.api.unlock(context.game, scoped, result.achievement_id, result.requested_unlocked_at); }
        catch (error) { writeError = error; }
        let verified;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await this.wait(500 * attempt);
          verified = (await this.api.achievements(context.game, scoped)).find(item => item.id === result.achievement_id);
          if (verified?.unlocked) break;
        }
        result.actual_unlocked_at = verified?.unlocked_at ?? null;
        if (verified?.unlocked && Date.parse(verified.unlocked_at) === Date.parse(result.requested_unlocked_at)) {
          result.status = 'restored';
        } else if (verified?.unlocked) {
          result.status = 'restored_with_different_date';
          result.error_code = 'UNLOCK_DATE_MISMATCH';
        } else {
          result.status = writeError?.code === 'API_REJECTED' || writeError?.code === 'AUTH_REJECTED' ? 'failed' : 'unconfirmed';
          result.error_code = writeError instanceof GogError ? writeError.code : 'UNLOCK_NOT_CONFIRMED';
        }
      } catch (error) {
        result.status = attempted ? 'unconfirmed' : 'not_attempted';
        result.error_code = error instanceof GogError ? error.code : 'INTERNAL_ERROR';
      }
      if (result.status !== 'restored' && result.status !== 'skipped_already_unlocked') {
        report.complete = false;
        for (const remaining of results.slice(index + 1)) if (remaining.status === 'pending') remaining.status = 'not_attempted';
        break;
      }
    }
    return report;
  }
}
