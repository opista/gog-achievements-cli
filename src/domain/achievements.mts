import type { Achievement } from './model.mjs';
import { requireValue } from './errors.mjs';

export type AchievementStatus = 'all' | 'locked' | 'unlocked';

export interface AchievementFilters {
  search?: string | undefined;
  status?: AchievementStatus | undefined;
}

export function validateAchievementStatus(value: unknown = 'all'): AchievementStatus {
  requireValue(
    value === 'all' || value === 'locked' || value === 'unlocked',
    'INVALID_ARGUMENTS',
    '--status must be all, locked or unlocked.',
  );
  return value;
}

/** Shared list/export selection. Preserve source order and achievement data. */
export function filterAchievements(
  achievements: readonly Achievement[],
  { search = '', status = 'all' }: AchievementFilters = {},
): Achievement[] {
  const query = search.trim().toLowerCase();
  return achievements.filter(
    (item) =>
      (status === 'all' || (status === 'unlocked' ? item.unlocked : !item.unlocked)) &&
      (!query ||
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)),
  );
}
