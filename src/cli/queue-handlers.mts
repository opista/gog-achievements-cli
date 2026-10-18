import { GogError, requireValue } from '../domain/errors.mjs';
import { commandSuccess as success } from './handler-contracts.mjs';
import type {
  CLIEffects,
  CLIService,
  FamilyCommand,
  CommandResponse,
} from './handler-contracts.mjs';

type QueueName =
  'queue show' | 'queue create' | 'queue apply' | 'queue add' | 'queue remove' | 'queue set-date';
type QueueEffects = Pick<CLIEffects, 'files'> & {
  service: Pick<CLIService, 'createQueue' | 'applyQueue' | 'addToQueue' | 'editQueue'>;
};

export async function handleQueue(
  { command: name, flags }: FamilyCommand<QueueName>,
  { service, files }: QueueEffects,
): Promise<CommandResponse<QueueName>> {
  if (name === 'queue show') return success(name, await files.read(flags.file));
  else if (name === 'queue create') {
    const data = await files.withLock(flags.file, async () => {
      const created = await service.createQueue(
        flags.game,
        flags.achievement ?? [],
        flags['unlocked-at'],
        flags.action,
      );
      await files.save(flags.file, created, { create: true });
      return created;
    });
    return success(name, data);
  } else if (name === 'queue apply') {
    requireValue(
      !(flags.yes && flags['dry-run']),
      'INVALID_ARGUMENTS',
      'Use --yes or --dry-run, not both.',
    );
    const data = await files.withLock(flags.file, async () =>
      service.applyQueue(await files.read(flags.file), { dryRun: !flags.yes }),
    );
    if (!data.complete)
      throw new GogError(
        'APPLY_INCOMPLETE',
        'Apply stopped. Inspect each result before retrying.',
        6,
        { report: data },
      );
    return success(name, data);
  } else {
    const data = await files.withLock(flags.file, async () => {
      const queue = await files.read(flags.file);
      const updated =
        name === 'queue add'
          ? await service.addToQueue(queue, flags.achievement, flags['unlocked-at'], flags.action)
          : service.editQueue(queue, flags.achievement, {
              remove: name === 'queue remove',
              unlockedAt: flags['unlocked-at'],
            });
      await files.save(flags.file, updated);
      return updated;
    });
    switch (name) {
      case 'queue add':
        return success(name, data);
      case 'queue remove':
        return success(name, data);
      case 'queue set-date':
        return success(name, data);
    }
  }
}
