import { requireValue } from '../domain/errors.mjs';
import { commandSuccess as success } from './handler-contracts.mjs';
import type { CLIEffects, FamilyCommand, CommandResponse } from './handler-contracts.mjs';

export async function handleUpdate(
  { command: name, flags }: FamilyCommand<'self update'>,
  { updates, confirm }: Pick<CLIEffects, 'updates' | 'confirm'>,
  format: 'text' | 'json',
): Promise<CommandResponse<'self update'>> {
  requireValue(!(flags.check && flags.yes), 'INVALID_ARGUMENTS', 'Use --check or --yes, not both.');
  const data = await updates.check();
  if (flags.check) return success(name, data);
  if (!data.update_available) return success(name, { ...data, updated: false });
  requireValue(
    data.can_update,
    'SELF_UPDATE_UNSUPPORTED',
    data.instructions ?? 'This installation cannot update itself.',
    7,
  );
  requireValue(
    flags.yes ||
      (format === 'text' &&
        (await confirm(
          `Update gog-achievements from ${data.current_version} to ${data.latest_version}? [y/N] `,
        ))),
    'UPDATE_CONFIRMATION_REQUIRED',
    'The update was not installed. Run self update --yes to confirm installation.',
  );
  return success(name, await updates.install());
}
