import { LOGIN_TIMEOUT_MS, MAX_LOGIN_TIMEOUT_MS } from '../domain/login-policy.mjs';
import type { OutputStream, NativeLoginOptions, AuthStatus } from '../application/ports.mjs';
import type { Queue, Success, PublicError } from '../domain/model.mjs';
import type { CLIOutcome, CommandName, CommandData, OutcomeMeta } from './contracts.mjs';
import type { AchievementService as GogAchievements } from '../application/service.mjs';
import type { UpdatePort } from '../application/update-ports.mjs';
import { GogError, errorResult, requireValue } from '../domain/errors.mjs';
import { commandHelp } from './definitions.mjs';
import { parseArguments, resolveCommand, validatedCommand } from './parse.mjs';
export type CLIService = Pick<
  GogAchievements,
  | 'loginURL'
  | 'finishLogin'
  | 'importLogin'
  | 'authStatus'
  | 'logout'
  | 'listGames'
  | 'listAchievements'
  | 'createQueue'
  | 'addToQueue'
  | 'editQueue'
  | 'applyQueue'
>;
export interface CLIEffects {
  service: CLIService;
  stderr: OutputStream;
  platform: string;
  isPackaged: () => boolean;
  systemInfo: () => { node: string; architecture: string };
  readInput: (mode: 'clipboard' | 'stdin') => Promise<string>;
  nativeLogin: (options: NativeLoginOptions & { service: CLIService }) => Promise<AuthStatus>;
  files: {
    read: (path: string) => Promise<Queue>;
    save: (path: string, queue: unknown, options?: { create?: boolean }) => Promise<void>;
    withLock: <T>(path: string, operation: () => Promise<T>) => Promise<T>;
  };
  updates: UpdatePort;
  confirm: (question: string) => Promise<boolean>;
}
export async function dispatchCLI(
  args: string[],
  {
    service,
    stderr,
    platform,
    isPackaged,
    systemInfo,
    readInput,
    nativeLogin,
    files,
    updates,
    confirm,
  }: CLIEffects,
): Promise<CLIOutcome> {
  let pretty = args.includes('--pretty');
  let format: 'json' | 'text' = args.includes('--json') ? 'json' : 'text';
  let command: CommandName | undefined;
  let file: string | undefined;
  const success = <K extends keyof CommandData>(
    name: K,
    data: NoInfer<CommandData[K]>,
  ): OutcomeMeta & { command: K; result: Success<CommandData[K]> } => ({
    exitCode: 0,
    pretty,
    format,
    command: name,
    file,
    result: { ok: true, data },
  });
  try {
    const parsed = parseArguments(args);
    const { values: rawFlags, positionals } = parsed;
    pretty = !!rawFlags.pretty;
    format = rawFlags.json ? 'json' : 'text';
    const topic = (positionals[0] === 'help' ? positionals.slice(1) : positionals).join(' ');
    if (
      rawFlags.help ||
      !positionals.length ||
      positionals[0] === 'help' ||
      ['auth', 'games', 'achievements', 'queue', 'self'].includes(topic)
    ) {
      const data = commandHelp(topic);
      requireValue(data, 'UNKNOWN_COMMAND', 'Unknown command. Run --help for the command list.');
      return { exitCode: 0, pretty, format, command: 'help', result: { ok: true, data } };
    }
    const resolved = resolveCommand(topic);
    command = resolved.command;
    file = rawFlags.file;
    const { command: name, flags } = validatedCommand(command, rawFlags, resolved.spec);
    if (name === 'self update') {
      requireValue(
        !(flags.check && flags.yes),
        'INVALID_ARGUMENTS',
        'Use --check or --yes, not both.',
      );
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
    } else if (name === 'auth login') {
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
    else if (name === 'auth logout') return success(name, await service.logout());
    else if (name === 'games list') {
      requireValue(
        !(flags.search && flags['ids-only']),
        'INVALID_ARGUMENTS',
        '--search needs game titles. Use it without --ids-only.',
      );
      return success(
        name,
        await service.listGames({ search: flags.search, idsOnly: flags['ids-only'] }),
      );
    } else if (name === 'achievements list')
      return success(name, await service.listAchievements(flags.game));
    else if (name === 'doctor') {
      let login: AuthStatus | PublicError;
      try {
        login = await service.authStatus();
      } catch (error) {
        login = errorResult(error).error;
      }
      const system = systemInfo();
      return success(name, {
        supported:
          ['darwin', 'win32'].includes(platform) && Number(system.node.split('.')[0]) >= 22,
        platform,
        architecture: system.architecture,
        node: system.node,
        credentials_available: !('code' in login),
        keychain_available: platform === 'darwin' ? !('code' in login) : null,
        login,
      });
    } else if (name === 'queue show') return success(name, await files.read(flags.file));
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
  } catch (error) {
    return {
      exitCode: error instanceof GogError ? error.exitCode : 4,
      pretty,
      format,
      command,
      file,
      result: errorResult(error),
    };
  }
}
