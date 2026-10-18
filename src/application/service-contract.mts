import type { AchievementFilters } from '../domain/achievements.mjs';
import type { Queue, RestorationReport } from '../domain/model.mjs';
import type { AuthStatus, LoginService } from './auth-ports.mjs';
import type { AchievementsResult, GamesResult } from './achievement-ports.mjs';

/** Application operations available to command handlers and other callers. */
export interface AchievementServicePort extends LoginService {
  importLogin(input: string): Promise<AuthStatus>;
  authStatus(): Promise<AuthStatus>;
  logout(): Promise<AuthStatus>;
  listGames(options?: {
    search?: string | undefined;
    idsOnly?: boolean | undefined;
  }): Promise<GamesResult>;
  listAchievements(gameID: unknown, filters?: AchievementFilters): Promise<AchievementsResult>;
  createQueue(
    gameID: unknown,
    achievementIDs?: readonly unknown[],
    unlockedAt?: unknown,
    action?: unknown,
  ): Promise<Queue>;
  addToQueue(
    input: unknown,
    achievementIDs: readonly unknown[],
    unlockedAt?: unknown,
    action?: unknown,
  ): Promise<Queue>;
  editQueue(
    input: unknown,
    achievementIDs: readonly unknown[],
    options?: { unlockedAt?: unknown; remove?: boolean },
  ): Queue;
  applyQueue(input: unknown, options?: { dryRun?: boolean }): Promise<RestorationReport>;
}
