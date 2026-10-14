import { VERSION } from './version.mjs';

export const FLAGS = {
  game: { value: 'GAME_ID', description: 'GOG game ID from games list.' },
  file: { value: 'PATH', description: 'Local queue file.' },
  search: { value: 'TEXT', description: 'Find games by title.' },
  achievement: {
    value: 'ACHIEVEMENT_ID',
    multiple: true,
    description: 'Select an achievement. Repeat for more than one.',
  },
  'unlocked-at': {
    value: 'TIMESTAMP',
    description: 'Unlock date in RFC 3339 with a time zone. Cannot be in the future.',
  },
  stdin: { description: 'Read the login value from a pipe. Required for auth import.' },
  clipboard: { description: 'Read the final GOG login URL from the clipboard.' },
  'no-open': { description: 'Show the login URL for manual sign-in.' },
  timeout: { value: 'SECONDS', description: 'Sign-in wait: 10 to 600 seconds. Default: 180.' },
  'ids-only': { description: 'Read game IDs without titles.' },
  yes: { description: 'Apply queued achievements to GOG and check each result.' },
  'dry-run': {
    description: 'Preview the queue. Makes no achievement writes. This is the default.',
  },
  json: { description: 'Return one compact JSON object for AI tools and scripts.' },
  pretty: { description: 'Keep readable text, or indent JSON when used with --json.' },
  help: { short: 'h', description: 'Show help for this command. Also accepts -h.' },
};

export const COMMANDS = {
  'auth login': {
    flags: ['no-open', 'timeout'],
    description: 'Sign in through a native GOG window and save login securely.',
  },
  'auth status': { flags: [], description: 'Check the saved login without revealing tokens.' },
  'auth logout': { flags: [], description: "Remove this tool's saved login." },
  'auth finish': {
    flags: ['stdin', 'clipboard'],
    description: 'Finish manual sign-in from stdin or the clipboard.',
  },
  'auth import': {
    flags: ['stdin'],
    description: 'Import an existing refresh token through stdin.',
  },
  'games list': { flags: ['search', 'ids-only'], description: 'List owned GOG games.' },
  'achievements list': {
    flags: ['game'],
    required: ['game'],
    description: 'List achievements and their unlock dates for an owned game.',
  },
  'queue create': {
    flags: ['file', 'game', 'achievement', 'unlocked-at'],
    required: ['file', 'game'],
    description: 'Create a local queue. Achievement flags can be repeated.',
  },
  'queue add': {
    flags: ['file', 'achievement', 'unlocked-at'],
    required: ['file', 'achievement'],
    description: 'Add locked achievements to a local queue.',
  },
  'queue remove': {
    flags: ['file', 'achievement'],
    required: ['file', 'achievement'],
    description: 'Remove selected achievements from a local queue.',
  },
  'queue set-date': {
    flags: ['file', 'achievement', 'unlocked-at'],
    required: ['file', 'achievement', 'unlocked-at'],
    description: 'Change the date for selected queued achievements.',
  },
  'queue show': {
    flags: ['file'],
    required: ['file'],
    description: 'Read a local queue without network access.',
  },
  'queue apply': {
    flags: ['file', 'yes', 'dry-run'],
    required: ['file'],
    description: 'Preview a queue. Use --yes to apply it to GOG.',
  },
  doctor: { flags: [], description: 'Check Node, platform support and saved login availability.' },
};

const EXAMPLES = {
  'auth login': ['auth login', 'auth login --timeout 300'],
  'auth status': ['auth status'],
  'auth logout': ['auth logout'],
  'auth finish': ['auth finish --clipboard'],
  'auth import': [],
  'games list': ['games list', 'games list --search Cyberpunk', 'games list --json'],
  'achievements list': [
    'achievements list --game 1423049311',
    'achievements list --game 1423049311 --json --pretty',
  ],
  'queue create': [
    'queue create --game GAME_ID --file queue.json',
    'queue create --game GAME_ID --file queue.json --achievement ACHIEVEMENT_ID',
  ],
  'queue add': ['queue add --file queue.json --achievement ACHIEVEMENT_ID'],
  'queue remove': ['queue remove --file queue.json --achievement ACHIEVEMENT_ID'],
  'queue set-date': [
    'queue set-date --file queue.json --achievement ACHIEVEMENT_ID --unlocked-at 2026-10-01T18:30:00+01:00',
  ],
  'queue show': ['queue show --file queue.json'],
  'queue apply': ['queue apply --file queue.json --dry-run', 'queue apply --file queue.json --yes'],
  doctor: ['doctor'],
};

export function flagUsage(name) {
  return `--${name}${FLAGS[name].value ? ` ${FLAGS[name].value}` : ''}`;
}

export const HELP = {
  name: 'gog-achievements',
  version: VERSION,
  output:
    'Readable text by default; --json returns one JSON object; --json --pretty adds indentation. IDs are decimal strings.',
  commands: Object.entries(COMMANDS).map(([command, spec]) => ({ command, ...spec })),
  common_flags: ['--json', '--pretty', '--help (-h)'],
  exit_codes: {
    0: 'success',
    2: 'invalid input or queue file',
    3: 'login required or rejected',
    4: 'network or API response failure',
    5: 'ownership, account, queue lock or game conflict',
    6: 'apply incomplete',
    7: 'native credential store or process failure',
  },
  examples: [
    'gog-achievements auth login',
    'gog-achievements games list --search Cyberpunk',
    'gog-achievements achievements list --game 1423049311',
  ],
};

export function commandHelp(topic = '') {
  const commands = HELP.commands.filter(
    (spec) => !topic || spec.command === topic || spec.command.startsWith(`${topic} `),
  );
  if (!commands.length) return null;
  const spec = COMMANDS[topic];
  const options = [
    ...new Set([...commands.flatMap((command) => command.flags), 'json', 'pretty', 'help']),
  ].map((name) => ({ flag: name, ...FLAGS[name], required: !!spec?.required?.includes(name) }));
  return {
    ...HELP,
    ...(topic ? { topic } : {}),
    commands,
    options,
    usage: spec
      ? `gog-achievements ${topic}${(spec.required ?? []).map((name) => ` ${flagUsage(name)}`).join('')} [options]`
      : `gog-achievements${topic ? ` ${topic}` : ''} <command> [options]`,
    examples: spec
      ? EXAMPLES[topic].map((example) => `gog-achievements ${example}`)
      : topic
        ? commands
            .flatMap((command) => (EXAMPLES[command.command] ?? []).slice(0, 1))
            .slice(0, 3)
            .map((example) => `gog-achievements ${example}`)
        : HELP.examples,
  };
}
