import { LOGIN_TIMEOUT_MS, MAX_LOGIN_TIMEOUT_MS } from '../domain/login-policy.mjs';
import { requireValue } from '../domain/errors.mjs';
import type { CommandData } from './contracts.mjs';
import { commandSuccess as success } from './handler-contracts.mjs';
import type {
  CLIEffects,
  CLIService,
  FamilyCommand,
  CommandResponse,
} from './handler-contracts.mjs';

type AuthName = 'auth login' | 'auth finish' | 'auth import' | 'auth status' | 'auth logout';
type AuthEffects = Pick<
  CLIEffects,
  'stderr' | 'platform' | 'isPackaged' | 'readInput' | 'nativeLogin' | 'updates'
> & {
  service: Pick<CLIService, 'loginURL' | 'finishLogin' | 'importLogin' | 'authStatus' | 'logout'>;
};

export async function handleAuth(
  command: FamilyCommand<AuthName>,
  { service, stderr, platform, isPackaged, readInput, nativeLogin, updates }: AuthEffects,
  format: 'text' | 'json',
): Promise<CommandResponse<AuthName>> {
  const { command: name, flags } = command;
  if (name === 'auth login') {
    let data: CommandData['auth login'];
    const timeout = flags.timeout === undefined ? LOGIN_TIMEOUT_MS / 1000 : Number(flags.timeout);
    requireValue(
      Number.isInteger(timeout) && timeout >= 10 && timeout <= MAX_LOGIN_TIMEOUT_MS / 1000,
      'INVALID_LOGIN_TIMEOUT',
      '--timeout must be a number of seconds from 10 to 600.',
    );
    if (flags['no-open']) {
      requireValue(
        flags.timeout === undefined,
        'INVALID_ARGUMENTS',
        '--timeout applies to automatic sign-in.',
      );
      data = {
        authenticated: false,
        action_required: 'complete_manual_browser_login',
        browser_opened: false,
        login_url: service.loginURL(),
        next_command: `${isPackaged() ? (platform === 'win32' ? '.\\gog-achievements.exe' : './gog-achievements') : 'node bin/gog-achievements.mjs'} auth finish --clipboard`,
        instructions:
          'Open the URL, complete GOG sign-in, copy the final redirected URL, then run the next command locally.',
      };
    } else {
      requireValue(
        ['darwin', 'win32'].includes(platform),
        'UNSUPPORTED_PLATFORM',
        'This tool supports macOS and Windows.',
        7,
      );
      data = await nativeLogin({
        service,
        platform,
        timeoutMs: timeout * 1000,
        progress: (message) => stderr.write(message + '\n'),
      });
    }
    if (format === 'text' && data.authenticated) {
      // A release check cannot change the successful login result or install anything.
      try {
        const update = await updates.check({ timeoutMs: 2000 });
        if (update.update_available && update.can_update)
          stderr.write(
            `A newer version is available (${update.latest_version}).\nRun: gog-achievements self update\n`,
          );
      } catch {
        /* Update notices are best effort. */
      }
    }
    return success('auth login', data);
  } else if (name === 'auth finish' || name === 'auth import') {
    requireValue(
      name === 'auth import'
        ? flags.stdin && !flags.clipboard
        : !!flags.stdin !== !!flags.clipboard,
      'INPUT_SOURCE_REQUIRED',
      name === 'auth import'
        ? 'Use --stdin to import a refresh token.'
        : 'Use exactly one of --stdin or --clipboard.',
    );
    const input = await readInput(flags.clipboard ? 'clipboard' : 'stdin');
    return name === 'auth finish'
      ? success('auth finish', await service.finishLogin(input))
      : success('auth import', await service.importLogin(input));
  } else if (name === 'auth status') return success(name, await service.authStatus());
  else return success(name, await service.logout());
}
