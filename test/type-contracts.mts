import type { CommandData, QueueItem, LockQueueItem, LockResult, Session } from '../src/types.mjs';
import type { GogAPI } from '../src/api.mjs';
import type { ParsedCommand } from '../src/cli/parse.mjs';
import type { QueueView } from '../src/domain/queue.mjs';

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

export function lockTypes() {
  // @ts-expect-error Lock requests must capture the previous unlock date.
  const missing: LockQueueItem = { achievement_id: '1', key: 'A', name: 'A', action: 'lock' };
  // @ts-expect-error Lock results cannot report a restored unlock.
  const status: LockResult['status'] = 'restored';
  return { missing, status };
}

export function architectureTypes(queue: QueueView): ParsedCommand {
  // @ts-expect-error Domain views prevent mutation of the input queue.
  queue.items[0]!.unlocked_at = '2026-01-01T00:00:00Z';
  // @ts-expect-error A parsed queue command must have its required file flag.
  const command: ParsedCommand = { command: 'queue show', flags: {} };
  return command;
}

export function sessionTypes(session: Session) {
  // @ts-expect-error Internal sessions contain normalized decimal string IDs.
  session.user_id = 123;
}
