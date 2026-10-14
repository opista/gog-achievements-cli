import { parseArgs } from 'node:util';
import { GogAchievements } from './service.mjs';
import { GogError, errorResult, requireValue } from './errors.mjs';
import { readQueue, saveQueue, withQueueLock, id } from './data.mjs';
import { runProcess } from './keychain.mjs';
import { loginWithNativeWindow } from './native-login.mjs';

const COMMANDS = {
  'auth login': { flags: ['no-open', 'timeout'], description: 'Open a Mac GOG sign-in window, capture its registered callback, and save login. --timeout is seconds (default 180).' },
  'auth finish': { flags: ['stdin', 'clipboard'], description: 'Read the final login URL or code and save login in Mac Keychain.' },
  'auth import': { flags: ['stdin'], description: 'Import a refresh token through stdin. Never put a token in an argument.' },
  'auth status': { flags: [], description: 'Read local login status without revealing tokens.' },
  'auth logout': { flags: [], description: 'Remove this tool\'s local login from Mac Keychain.' },
  'games list': { flags: ['search', 'ids-only'], description: 'List owned GOG games, with optional title search.' },
  'achievements list': { flags: ['game'], required: ['game'], description: 'List all achievements and current unlock dates for an owned game.' },
  'queue create': { flags: ['file', 'game', 'achievement', 'unlocked-at'], required: ['file', 'game'], description: 'Create a queue file. Achievement flags can be repeated.' },
  'queue add': { flags: ['file', 'achievement', 'unlocked-at'], required: ['file', 'achievement'], description: 'Add locked achievements to a queue.' },
  'queue remove': { flags: ['file', 'achievement'], required: ['file', 'achievement'], description: 'Remove selected achievements from a queue.' },
  'queue set-date': { flags: ['file', 'achievement', 'unlocked-at'], required: ['file', 'achievement', 'unlocked-at'], description: 'Change the date of selected queued achievements.' },
  'queue show': { flags: ['file'], required: ['file'], description: 'Read a queue without network access.' },
  'queue apply': { flags: ['file', 'yes', 'dry-run'], required: ['file'], description: 'Preview by default. Use --yes to write and verify the queue.' },
  doctor: { flags: [], description: 'Check Node, Mac and local login availability.' },
};

export const HELP = {
  name: 'gog-achievements', version: '0.1.0', output: 'JSON on stdout; no interactive prompts; IDs are decimal strings.',
  commands: Object.entries(COMMANDS).map(([name, spec]) => ({ command: name, ...spec })),
  common_flags: ['--json (default)', '--pretty', '--help'],
  exit_codes: { 0: 'success', 2: 'invalid input or queue file', 3: 'login required or rejected',
    4: 'network or API response failure', 5: 'ownership, account, queue lock or game conflict', 6: 'apply incomplete', 7: 'Mac Keychain or process failure' },
  examples: [
    'gog-achievements auth login',
    'gog-achievements games list --search Cyberpunk',
    'gog-achievements achievements list --game GAME_ID',
    'gog-achievements queue create --game GAME_ID --file queue.json --achievement ACHIEVEMENT_ID',
    'gog-achievements queue set-date --file queue.json --achievement ACHIEVEMENT_ID --unlocked-at 2026-10-01T18:30:00+01:00',
    'gog-achievements queue apply --file queue.json --dry-run',
    'gog-achievements queue apply --file queue.json --yes',
  ],
};

async function readStdin(input) {
  requireValue(!input.isTTY, 'STDIN_REQUIRED', 'Pipe the login value through stdin. The CLI will not prompt.');
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { clearTimeout(timer); input.removeListener('data', onData); input.removeListener('end', onEnd); input.removeListener('error', onError); input.pause(); };
    const onData = chunk => {
      value += chunk.toString('utf8');
      if (value.length > 16_000) { cleanup(); reject(new GogError('INPUT_TOO_LARGE', 'Login input exceeds 16 KB.', 2)); }
    };
    const onEnd = () => { cleanup(); resolve(value); };
    const onError = () => { cleanup(); reject(new GogError('STDIN_FAILED', 'Cannot read login input.', 2)); };
    const timer = setTimeout(() => { cleanup(); reject(new GogError('STDIN_TIMEOUT', 'No complete login input was received within 30 seconds.', 2)); }, 30_000);
    input.on('data', onData).once('end', onEnd).once('error', onError);
    input.resume();
  });
}

export async function runCLI(args, { service = new GogAchievements(), stdin = process.stdin, stderr = process.stderr,
  execute = runProcess, platform = process.platform, nativeLogin = loginWithNativeWindow } = {}) {
  let pretty = args.includes('--pretty');
  try {
    let parsed;
    try {
      parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
        help: { type: 'boolean' }, pretty: { type: 'boolean' }, json: { type: 'boolean' },
        game: { type: 'string' }, file: { type: 'string' }, search: { type: 'string' },
        achievement: { type: 'string', multiple: true }, 'unlocked-at': { type: 'string' },
        stdin: { type: 'boolean' }, clipboard: { type: 'boolean' }, 'no-open': { type: 'boolean' },
        'ids-only': { type: 'boolean' }, yes: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
        timeout: { type: 'string' },
      } });
    } catch { throw new GogError('INVALID_ARGUMENTS', 'Invalid command arguments. Run --help for the command list.', 2); }
    const { values: flags, positionals } = parsed;
    pretty = !!flags.pretty;
    if (flags.help || !positionals.length || (positionals.length === 1 && positionals[0] === 'help')) {
      return { exitCode: 0, pretty, result: { ok: true, data: HELP } };
    }
    const command = positionals.join(' ');
    const spec = COMMANDS[command];
    requireValue(spec, 'UNKNOWN_COMMAND', 'Unknown command. Run --help for the command list.');
    requireValue(Object.keys(flags).every(key => ['pretty', 'json'].includes(key) || spec.flags.includes(key)),
      'INVALID_ARGUMENTS', 'One or more flags are not valid for this command.');
    requireValue((spec.required ?? []).every(key => typeof flags[key] === 'string' ? flags[key].trim() : flags[key]?.length),
      'MISSING_ARGUMENT', 'A required flag is missing. Run --help for the command list.');
    if (flags.game) id(flags.game, 'Game ID');
    for (const value of flags.achievement ?? []) id(value, 'Achievement ID');
    let data;
    if (command === 'auth login') {
      const timeout = flags.timeout === undefined ? 180 : Number(flags.timeout);
      requireValue(Number.isInteger(timeout) && timeout >= 10 && timeout <= 600,
        'INVALID_LOGIN_TIMEOUT', '--timeout must be a number of seconds from 10 to 600.');
      if (flags['no-open']) {
        requireValue(flags.timeout === undefined, 'INVALID_ARGUMENTS', '--timeout applies to automatic sign-in.');
        data = { authenticated: false, action_required: 'complete_manual_browser_login', browser_opened: false,
          login_url: service.loginURL(), next_command: 'node bin/gog-achievements.mjs auth finish --clipboard',
          instructions: 'Open the URL, complete GOG sign-in, copy the final redirected URL, then run the next command locally.' };
      } else {
        requireValue(platform === 'darwin', 'MAC_REQUIRED', 'Use --no-open to obtain a login URL on this platform.', 7);
        const abort = new AbortController();
        const onInterrupt = () => abort.abort();
        process.once('SIGINT', onInterrupt);
        process.once('SIGTERM', onInterrupt);
        try {
          data = await nativeLogin({ service, timeoutMs: timeout * 1000, signal: abort.signal,
            progress: message => stderr.write(`${message}\n`) });
        } finally {
          process.removeListener('SIGINT', onInterrupt);
          process.removeListener('SIGTERM', onInterrupt);
        }
      }
    } else if (command === 'auth finish' || command === 'auth import') {
      requireValue(command === 'auth import' ? flags.stdin && !flags.clipboard : !!flags.stdin !== !!flags.clipboard,
        'INPUT_SOURCE_REQUIRED', command === 'auth import' ? 'Use --stdin to import a refresh token.' : 'Use exactly one of --stdin or --clipboard.');
      let input;
      if (flags.clipboard) {
        requireValue(platform === 'darwin', 'MAC_REQUIRED', 'Clipboard login is available on Mac.', 7);
        const clipboard = await execute('/usr/bin/pbpaste', []);
        requireValue(clipboard.code === 0, 'CLIPBOARD_FAILED', 'Cannot read the clipboard.', 7);
        input = clipboard.stdout;
      } else input = await readStdin(stdin);
      data = command === 'auth finish' ? await service.finishLogin(input) : await service.importLogin(input);
    } else if (command === 'auth status') data = await service.authStatus();
    else if (command === 'auth logout') data = await service.logout();
    else if (command === 'games list') {
      requireValue(!(flags.search && flags['ids-only']), 'INVALID_ARGUMENTS', '--search needs game titles. Use it without --ids-only.');
      data = await service.listGames({ search: flags.search, idsOnly: flags['ids-only'] });
    } else if (command === 'achievements list') data = await service.listAchievements(flags.game);
    else if (command === 'doctor') {
      let login;
      try { login = await service.authStatus(); } catch (error) { login = errorResult(error).error; }
      data = { supported: platform === 'darwin' && Number(process.versions.node.split('.')[0]) >= 22,
        platform, architecture: process.arch, node: process.versions.node, keychain_available: !login.code, login };
    } else if (command === 'queue show') data = await readQueue(flags.file);
    else if (command === 'queue create') {
      await withQueueLock(flags.file, async () => {
        data = await service.createQueue(flags.game, flags.achievement ?? [], flags['unlocked-at']);
        await saveQueue(flags.file, data, { create: true });
      });
    } else if (command === 'queue apply') {
      requireValue(!(flags.yes && flags['dry-run']), 'INVALID_ARGUMENTS', 'Use --yes or --dry-run, not both.');
      data = await withQueueLock(flags.file, async () => service.applyQueue(await readQueue(flags.file), { dryRun: !flags.yes }));
      if (!data.complete) throw new GogError('APPLY_INCOMPLETE', 'Apply stopped. Inspect each result before retrying.', 6, { report: data });
    } else {
      await withQueueLock(flags.file, async () => {
        const queue = await readQueue(flags.file);
        data = command === 'queue add' ? await service.addToQueue(queue, flags.achievement, flags['unlocked-at']) :
          service.editQueue(queue, flags.achievement, { remove: command === 'queue remove', unlockedAt: flags['unlocked-at'] });
        await saveQueue(flags.file, data);
      });
    }
    return { exitCode: 0, pretty, result: { ok: true, data } };
  } catch (error) {
    return { exitCode: error instanceof GogError ? error.exitCode : 4, pretty, result: errorResult(error) };
  }
}
