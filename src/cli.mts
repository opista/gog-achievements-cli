import type {
  CommandData,
  CommandName,
  CLIOutcome,
  Success,
  OutcomeMeta,
  InputStream,
  OutputStream,
  ProcessRunner,
  NativeLoginOptions,
  AuthStatus,
  PublicError,
} from './types.mjs';
import { parseArgs } from 'node:util';
import { GogAchievements } from './service.mjs';
import { GogError, errorResult, requireValue } from './errors.mjs';
import { readQueue, saveQueue, withQueueLock, id } from './data.mjs';
import { runProcess } from './keychain.mjs';
import { loginWithNativeWindow } from './native-login.mjs';
import { commandDefinitions, FLAGS, commandHelp } from './help.mjs';
import { nativeHelperPath, isPackaged } from './assets.mjs';
export { HELP } from './help.mjs';
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

// Flag types and help text share one definition.
const ARGUMENT_OPTIONS = Object.fromEntries(
  Object.entries(FLAGS).map(([name, spec]) => [
    name,
    {
      type: 'value' in spec && spec.value ? 'string' : 'boolean',
      multiple: 'multiple' in spec && !!spec.multiple,
      ...('short' in spec && spec.short ? { short: spec.short } : {}),
    },
  ]),
) as ArgumentOptions;

type ArgumentOptions = {
  [K in keyof typeof FLAGS]: {
    type: (typeof FLAGS)[K] extends { value: string } ? 'string' : 'boolean';
    multiple: (typeof FLAGS)[K] extends { multiple: true } ? true : false;
    short?: string;
  };
};

async function readStdin(input: InputStream): Promise<string> {
  requireValue(
    !input.isTTY,
    'STDIN_REQUIRED',
    'Pipe the login value through stdin. The CLI will not prompt.',
  );
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      input.pause();
    };
    const onData = (chunk: Buffer | string) => {
      value += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (value.length > 16_000) {
        cleanup();
        reject(new GogError('INPUT_TOO_LARGE', 'Login input exceeds 16 KB.', 2));
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(value);
    };
    const onError = () => {
      cleanup();
      reject(new GogError('STDIN_FAILED', 'Cannot read login input.', 2));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new GogError('STDIN_TIMEOUT', 'No complete login input was received within 30 seconds.', 2),
      );
    }, 30_000);
    input.on('data', onData).once('end', onEnd).once('error', onError);
    input.resume();
  });
}

export async function runCLI(
  args: string[],
  {
    service = new GogAchievements(),
    stdin = process.stdin,
    stderr = process.stderr,
    execute = runProcess,
    platform = process.platform,
    nativeLogin = loginWithNativeWindow,
  }: {
    service?: CLIService;
    stdin?: InputStream;
    stderr?: OutputStream;
    execute?: ProcessRunner;
    platform?: string;
    nativeLogin?: (options: NativeLoginOptions & { service: CLIService }) => Promise<AuthStatus>;
  } = {},
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
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: ARGUMENT_OPTIONS,
      });
    } catch {
      throw new GogError(
        'INVALID_ARGUMENTS',
        'Invalid command arguments. Run --help for the command list.',
        2,
      );
    }
    const { values: flags, positionals } = parsed;
    pretty = !!flags.pretty;
    format = flags.json ? 'json' : 'text';
    const topic = (positionals[0] === 'help' ? positionals.slice(1) : positionals).join(' ');
    if (
      flags.help ||
      !positionals.length ||
      positionals[0] === 'help' ||
      ['auth', 'games', 'achievements', 'queue'].includes(topic)
    ) {
      const data = commandHelp(topic);
      requireValue(data, 'UNKNOWN_COMMAND', 'Unknown command. Run --help for the command list.');
      return { exitCode: 0, pretty, format, command: 'help', result: { ok: true, data } };
    }
    const spec = commandDefinitions[topic];
    requireValue(spec, 'UNKNOWN_COMMAND', 'Unknown command. Run --help for the command list.');
    command = topic as CommandName;
    file = flags.file;
    requireValue(
      Object.keys(flags).every(
        (key) => ['pretty', 'json'].includes(key) || spec.flags.includes(key),
      ),
      'INVALID_ARGUMENTS',
      'One or more flags are not valid for this command.',
    );
    requireValue(
      (spec.required ?? []).every((key) => {
        const value = flags[key as keyof typeof flags];
        return typeof value === 'string' ? value.trim() : Array.isArray(value) && value.length;
      }),
      'MISSING_ARGUMENT',
      'A required flag is missing. Run --help for the command list.',
    );
    if (flags.game) id(flags.game, 'Game ID');
    for (const value of flags.achievement ?? []) id(value, 'Achievement ID');
    if (command === 'auth login') {
      let data: CommandData['auth login'];
      const timeout = flags.timeout === undefined ? 180 : Number(flags.timeout);
      requireValue(
        Number.isInteger(timeout) && timeout >= 10 && timeout <= 600,
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
        const abort = new AbortController();
        const onInterrupt = () => abort.abort();
        process.once('SIGINT', onInterrupt);
        process.once('SIGTERM', onInterrupt);
        try {
          data = await nativeLogin({
            service,
            platform,
            timeoutMs: timeout * 1000,
            signal: abort.signal,
            progress: (message) => stderr.write(`${message}\n`),
          });
        } finally {
          process.removeListener('SIGINT', onInterrupt);
          process.removeListener('SIGTERM', onInterrupt);
        }
      }
      return success('auth login', data);
    } else if (command === 'auth finish' || command === 'auth import') {
      requireValue(
        command === 'auth import'
          ? flags.stdin && !flags.clipboard
          : !!flags.stdin !== !!flags.clipboard,
        'INPUT_SOURCE_REQUIRED',
        command === 'auth import'
          ? 'Use --stdin to import a refresh token.'
          : 'Use exactly one of --stdin or --clipboard.',
      );
      let input;
      if (flags.clipboard) {
        requireValue(
          ['darwin', 'win32'].includes(platform),
          'UNSUPPORTED_PLATFORM',
          'Clipboard login supports macOS and Windows.',
          7,
        );
        const clipboard = await execute(
          platform === 'darwin' ? '/usr/bin/pbpaste' : nativeHelperPath(platform),
          platform === 'darwin' ? [] : ['--clipboard'],
        );
        requireValue(clipboard.code === 0, 'CLIPBOARD_FAILED', 'Cannot read the clipboard.', 7);
        input = clipboard.stdout;
      } else input = await readStdin(stdin);
      return command === 'auth finish'
        ? success('auth finish', await service.finishLogin(input))
        : success('auth import', await service.importLogin(input));
    } else if (command === 'auth status') return success(command, await service.authStatus());
    else if (command === 'auth logout') return success(command, await service.logout());
    else if (command === 'games list') {
      requireValue(
        !(flags.search && flags['ids-only']),
        'INVALID_ARGUMENTS',
        '--search needs game titles. Use it without --ids-only.',
      );
      return success(
        command,
        await service.listGames({ search: flags.search, idsOnly: flags['ids-only'] }),
      );
    } else if (command === 'achievements list')
      return success(command, await service.listAchievements(flags.game));
    else if (command === 'doctor') {
      let login: AuthStatus | PublicError;
      try {
        login = await service.authStatus();
      } catch (error) {
        login = errorResult(error).error;
      }
      return success(command, {
        supported:
          ['darwin', 'win32'].includes(platform) &&
          Number(process.versions.node.split('.')[0]) >= 22,
        platform,
        architecture: process.arch,
        node: process.versions.node,
        credentials_available: !('code' in login),
        keychain_available: platform === 'darwin' ? !('code' in login) : null,
        login,
      });
    } else if (command === 'queue show') return success(command, await readQueue(flags.file!));
    else if (command === 'queue create') {
      const data = await withQueueLock(flags.file!, async () => {
        const created = await service.createQueue(
          flags.game,
          flags.achievement ?? [],
          flags['unlocked-at'],
        );
        await saveQueue(flags.file!, created, { create: true });
        return created;
      });
      return success(command, data);
    } else if (command === 'queue apply') {
      requireValue(
        !(flags.yes && flags['dry-run']),
        'INVALID_ARGUMENTS',
        'Use --yes or --dry-run, not both.',
      );
      const data = await withQueueLock(flags.file!, async () =>
        service.applyQueue(await readQueue(flags.file!), { dryRun: !flags.yes }),
      );
      if (!data.complete)
        throw new GogError(
          'APPLY_INCOMPLETE',
          'Apply stopped. Inspect each result before retrying.',
          6,
          { report: data },
        );
      return success(command, data);
    } else {
      const data = await withQueueLock(flags.file!, async () => {
        const queue = await readQueue(flags.file!);
        const updated =
          command === 'queue add'
            ? await service.addToQueue(queue, flags.achievement!, flags['unlocked-at'])
            : service.editQueue(queue, flags.achievement!, {
                remove: command === 'queue remove',
                unlockedAt: flags['unlocked-at'],
              });
        await saveQueue(flags.file!, updated);
        return updated;
      });
      switch (command) {
        case 'queue add':
          return success(command, data);
        case 'queue remove':
          return success(command, data);
        case 'queue set-date':
          return success(command, data);
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
