export interface PublicGame {
  id: string;
  title: string;
  client_id: string;
}

export interface Game extends PublicGame {
  client_secret: string;
}

export interface LibraryGame {
  id: string;
  title?: string;
  slug?: string | null;
  image?: string | null;
  works_on?: unknown;
}

interface AchievementData {
  id: string;
  key: string;
  name: string;
  description: string;
  hidden: boolean;
  image_locked: unknown;
  image_unlocked: unknown;
  rarity: unknown;
}

export type Achievement = AchievementData &
  ({ unlocked: false; unlocked_at: null } | { unlocked: true; unlocked_at: string });

export type AchievementAction = 'unlock' | 'lock';

interface QueueItemData {
  achievement_id: string;
  key: string;
  name: string;
}

export interface UnlockQueueItem extends QueueItemData {
  action?: 'unlock';
  unlocked_at: string;
  previous_unlocked_at?: never;
}

export interface LockQueueItem extends QueueItemData {
  action: 'lock';
  previous_unlocked_at: string;
  unlocked_at?: never;
}

export type QueueItem = UnlockQueueItem | LockQueueItem;

export interface Queue {
  schema_version: 1;
  user_id: string;
  game: PublicGame;
  created_at: string;
  updated_at: string;
  items: QueueItem[];
}

export type RestorationStatus =
  | 'pending'
  | 'restored'
  | 'skipped_already_unlocked'
  | 'restored_with_different_date'
  | 'locked'
  | 'skipped_already_locked'
  | 'failed'
  | 'unconfirmed'
  | 'not_attempted';

interface ResultData {
  achievement_id: string;
  name: string;
  previous_unlocked_at: string | null;
  actual_unlocked_at: string | null;
  error_code?: string;
}

export interface UnlockResult extends ResultData {
  action?: 'unlock';
  requested_unlocked_at: string;
  status: Exclude<RestorationStatus, 'locked' | 'skipped_already_locked'>;
}

export interface LockResult extends ResultData {
  action: 'lock';
  requested_unlocked_at: null;
  previous_unlocked_at: string;
  status: Exclude<
    RestorationStatus,
    'restored' | 'skipped_already_unlocked' | 'restored_with_different_date'
  >;
}

export type RestorationResult = UnlockResult | LockResult;

export interface RestorationReport {
  dry_run: boolean;
  user_id: string;
  game: PublicGame;
  complete: boolean;
  results: RestorationResult[];
}

export interface PublicError {
  code: string;
  message: string;
  details?: Record<string, unknown> & { report?: RestorationReport };
}

export interface Failure {
  ok: false;
  error: PublicError;
}

export interface Success<T> {
  ok: true;
  data: T;
}
