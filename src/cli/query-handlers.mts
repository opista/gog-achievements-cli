import type { AuthStatus } from '../application/auth-ports.mjs';
import type { PublicError } from '../domain/model.mjs';
import { validateAchievementStatus } from '../domain/achievements.mjs';
import { errorResult, requireValue } from '../domain/errors.mjs';
import { achievementCSV } from './csv.mjs';
import { commandSuccess as success } from './handler-contracts.mjs';
import type {
  CLIEffects,
  CLIService,
  FamilyCommand,
  CommandResponse,
} from './handler-contracts.mjs';

type QueryName = 'games list' | 'achievements list' | 'achievements export' | 'doctor';
type QueryEffects = Pick<CLIEffects, 'platform' | 'systemInfo' | 'writeExport'> & {
  service: Pick<CLIService, 'listGames' | 'listAchievements' | 'authStatus'>;
};

export async function handleQuery(
  { command: name, flags }: FamilyCommand<QueryName>,
  { service, platform, systemInfo, writeExport }: QueryEffects,
): Promise<CommandResponse<QueryName>> {
  if (name === 'games list') {
    requireValue(
      !(flags.search && flags['ids-only']),
      'INVALID_ARGUMENTS',
      '--search needs game titles. Use it without --ids-only.',
    );
    return success(
      name,
      await service.listGames({ search: flags.search, idsOnly: flags['ids-only'] }),
    );
  } else if (name === 'achievements list') {
    const status = validateAchievementStatus(flags.status);
    return success(
      name,
      await service.listAchievements(flags.game, { search: flags.search, status }),
    );
  } else if (name === 'achievements export') {
    const status = validateAchievementStatus(flags.status);
    const data = await service.listAchievements(flags.game, { search: flags.search, status });
    const path = await writeExport(flags.file, achievementCSV(data.game, data.achievements));
    return success(name, { path, count: data.achievements.length });
  } else {
    let login: AuthStatus | PublicError;
    try {
      login = await service.authStatus();
    } catch (error) {
      login = errorResult(error).error;
    }
    const system = systemInfo();
    return success(name, {
      supported: ['darwin', 'win32'].includes(platform) && Number(system.node.split('.')[0]) >= 22,
      platform,
      architecture: system.architecture,
      node: system.node,
      credentials_available: !('code' in login),
      keychain_available: platform === 'darwin' ? !('code' in login) : null,
      login,
    });
  }
}
