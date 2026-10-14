import type { CommandData, QueueItem } from '../src/types.mjs';
import type { GogAPI } from '../src/api.mjs';

// This file is compiled but never executed. Unused expectations fail compilation.
export function typeContracts(api: GogAPI, item: QueueItem, games: CommandData['games list']) {
  // @ts-expect-error Requested unlock dates must be non-null.
  item.unlocked_at = null;
  // @ts-expect-error A games payload cannot be used as an achievement payload.
  const achievements: CommandData['achievements list'] = games;
  // @ts-expect-error The HTTP adapter must never accept a null unlock date.
  void api.unlock({ client_id: '1' }, { user_id: '1', access_token: 'test' }, '1', null);
  return achievements;
}
