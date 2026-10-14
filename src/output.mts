import type {
  CLIOutcome,
  SuccessOutcome,
  HelpData,
  AuthStatus,
  ManualLogin,
  GamesResult,
  AchievementsResult,
  Queue,
  RestorationReport,
  PublicError,
} from './types.mjs';
import { stripVTControlCharacters } from 'node:util';
import { flagUsage } from './help.mjs';

// GOG titles and queue fields are data, not terminal control sequences.
function text(value: unknown) {
  return stripVTControlCharacters(String(value ?? ''))
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrap(value: unknown, width: number) {
  const words = text(value).split(' ');
  const lines = [];
  let line = '';
  for (let word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = '';
    }
    while (word.length > width) {
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    line += `${line ? ' ' : ''}${word}`;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

function paragraph(value: unknown, width: number, indent = '') {
  return wrap(value, width - indent.length)
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function definitions(rows: readonly (readonly unknown[])[], width: number) {
  if (!rows.length) return '';
  const labelWidth = Math.max(...rows.map(([label]) => text(label).length));
  if (labelWidth + 24 > width)
    return rows
      .map(
        ([label, description]) =>
          `${paragraph(label, width, '  ')}\n${paragraph(description, width, '    ')}`,
      )
      .join('\n');
  return rows
    .map(([label, description]) => {
      const lines = wrap(description, width - labelWidth - 4);
      return lines
        .map((line, index) => `  ${(index ? '' : text(label)).padEnd(labelWidth)}  ${line}`)
        .join('\n');
    })
    .join('\n');
}

function table(
  columns: { label: string; wrap?: boolean; min?: number }[],
  rows: unknown[][],
  width: number,
) {
  if (!rows.length) return '';
  const values = rows.map((row) => row.map(text));
  const sizes = columns.map((column, index) =>
    Math.max(column.label.length, ...values.map((row) => row[index]!.length)),
  );
  const gap = 2;
  const available = width - gap * (columns.length - 1);
  while (sizes.reduce((sum, size) => sum + size, 0) > available) {
    let index = -1;
    for (let i = 0; i < sizes.length; i++) {
      if (
        columns[i]!.wrap &&
        sizes[i]! > (columns[i]!.min ?? columns[i]!.label.length) &&
        (index < 0 || sizes[i]! > sizes[index]!)
      )
        index = i;
    }
    if (index < 0) {
      // Keep IDs and dates intact when the terminal is too narrow for columns.
      return values
        .map((row) =>
          row.map((value, i) => paragraph(`${columns[i]!.label}: ${value}`, width)).join('\n'),
        )
        .join('\n\n');
    }
    sizes[index]!--;
  }
  const line = (row: readonly string[]) =>
    row
      .map((value, i) => value.padEnd(sizes[i]!))
      .join('  ')
      .trimEnd();
  const result = [
    line(columns.map((column) => column.label)),
    line(sizes.map((size) => '-'.repeat(size))),
  ];
  for (const row of values) {
    const cells = row.map((value, i) => (columns[i]!.wrap ? wrap(value, sizes[i]!) : [value]));
    for (let i = 0; i < Math.max(...cells.map((cell) => cell.length)); i++)
      result.push(line(cells.map((cell) => cell[i] ?? '')));
  }
  return result.join('\n');
}

function date(value: string | null | undefined) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 19).replace('T', ' ')
    : text(value);
}

function help(data: HelpData, width: number) {
  const lines = [
    `${data.name} ${data.version}${data.topic ? ` - ${data.topic}` : ''}`,
    '',
    paragraph(
      data.commands.length === 1
        ? data.commands[0]!.description
        : 'Restore GOG achievements you already earned.',
      width,
    ),
    '',
    'Usage:',
    paragraph(data.usage, width, '  '),
  ];
  if (data.examples.length)
    lines.push('', 'Examples:', ...data.examples.map((example) => `  ${example}`));
  if (data.commands.length > 1) {
    for (const [label, prefix] of [
      ['Sign in', 'auth'],
      ['Browse', 'games'],
      ['Achievements', 'achievements'],
      ['Local queues', 'queue'],
      ['Checks', 'doctor'],
    ]) {
      const rows = data.commands
        .filter((spec) => spec.command.split(' ')[0] === prefix)
        .map((spec) => [spec.command, spec.description]);
      if (rows.length) lines.push('', `${label}:`, definitions(rows, width));
    }
  }
  const options = data.options.filter(
    (option) => !['json', 'pretty', 'help'].includes(option.flag),
  );
  if (data.topic && options.length)
    lines.push(
      '',
      'Options:',
      definitions(
        options.map((option) => [
          flagUsage(option.flag),
          `${option.description}${option.required ? ' Required.' : ''}`,
        ]),
        width,
      ),
    );
  lines.push(
    '',
    'Output and help:',
    definitions(
      [
        ['(default)', 'Readable summaries and tables.'],
        ['--json', 'Compact JSON for AI tools and scripts.'],
        ['--json --pretty', 'Indented JSON for inspection.'],
        ['--pretty', 'Readable text (same as the default).'],
        ['-h, --help', 'Show help; add it after a command for its options.'],
      ],
      width,
    ),
  );
  if (!data.topic || data.topic.startsWith('queue'))
    lines.push(
      '',
      paragraph(
        'Queue edits are local. queue apply previews by default; --yes applies changes to GOG.',
        width,
      ),
    );
  lines.push('', paragraph('More: gog-achievements <command> --help | README.md', width));
  return lines.join('\n');
}

function login(data: AuthStatus | ManualLogin, width: number) {
  if (data.local_login_removed) return 'Saved login removed from this tool.';
  if ('action_required' in data && data.action_required)
    return [
      paragraph(data.instructions, width),
      '',
      'Login URL:',
      text(data.login_url),
      '',
      `Next: ${text(data.next_command)}`,
    ].join('\n');
  if (!data.authenticated) return 'Not signed in. Run gog-achievements auth login.';
  return [
    `Signed in to GOG.`,
    `Account: ${text(data.user_id)}`,
    `Storage: ${data.storage === 'windows_dpapi' ? 'Windows protected login store (DPAPI)' : 'Mac Keychain'}`,
    ...(data.expired
      ? ['The access token has expired. It will refresh when the next GOG command runs.']
      : []),
  ].join('\n');
}

function games(data: GamesResult, width: number) {
  if (!data.games.length) return 'No games found.';
  if (data.games.every((game) => game.title === undefined))
    return `${data.count} owned game IDs\n\n${data.games.map((game) => text(game.id)).join('\n')}`;
  return [
    `${data.count} owned ${data.count === 1 ? 'game' : 'games'}`,
    '',
    table(
      [{ label: 'Game ID' }, { label: 'Title', wrap: true, min: 12 }],
      data.games.map((game) => [game.id, game.title]),
      width,
    ),
  ].join('\n');
}

function achievements(data: AchievementsResult, width: number) {
  const unlocked = data.achievements.filter((item) => item.unlocked).length;
  return [
    text(data.game.title),
    `Game ID: ${text(data.game.id)}`,
    `${data.count} achievements: ${unlocked} unlocked, ${data.count - unlocked} locked`,
    '',
    data.achievements.length
      ? table(
          [
            { label: 'Status' },
            { label: 'Achievement ID' },
            { label: 'Achievement', wrap: true, min: 14 },
            { label: 'Unlocked at (UTC)' },
          ],
          data.achievements.map((item) => [
            item.unlocked ? 'Unlocked' : 'Locked',
            item.id,
            `${item.name}${item.hidden ? ' (hidden)' : ''}`,
            date(item.unlocked_at),
          ]),
          width,
        )
      : 'No achievements found.',
    '',
    'Use --json for descriptions and all fields.',
  ].join('\n');
}

const QUEUE_ACTIONS = {
  'queue create': 'Queue created',
  'queue add': 'Queue updated',
  'queue remove': 'Queue updated',
  'queue set-date': 'Queue dates updated',
  'queue show': 'Queue',
};

function queue(
  data: Queue,
  command: keyof typeof QUEUE_ACTIONS,
  file: string | undefined,
  width: number,
) {
  return [
    `${QUEUE_ACTIONS[command] ?? 'Queue'}: ${text(data.game.title)}`,
    ...(file ? [`File: ${text(file)}`] : []),
    `Game ID: ${text(data.game.id)}`,
    `${data.items.length} queued ${data.items.length === 1 ? 'achievement' : 'achievements'}`,
    '',
    data.items.length
      ? table(
          [
            { label: 'Achievement ID' },
            { label: 'Achievement', wrap: true, min: 14 },
            { label: 'Unlock at (UTC)' },
          ],
          data.items.map((item) => [item.achievement_id, item.name, date(item.unlocked_at)]),
          width,
        )
      : 'The queue is empty.',
    '',
    'Queue edits only change the local file.',
  ].join('\n');
}

const STATUSES = {
  pending: 'Would unlock',
  restored: 'Restored',
  skipped_already_unlocked: 'Already unlocked; skipped',
  restored_with_different_date: 'Restored with a different date',
  failed: 'Failed',
  unconfirmed: 'Unconfirmed',
  not_attempted: 'Not attempted',
};

function report(data: RestorationReport, width: number) {
  const lines = [
    paragraph(
      `${data.dry_run ? 'Queue preview' : data.complete ? 'Apply complete' : 'Apply incomplete'}: ${data.game.title}`,
      width,
    ),
    `Game ID: ${text(data.game.id)}`,
    ...(data.dry_run ? ['Preview only. No achievements were changed.'] : []),
    '',
  ];
  for (const item of data.results) {
    lines.push(
      paragraph(`${STATUSES[item.status] ?? item.status}: ${item.name}`, width),
      `  ID: ${text(item.achievement_id)}`,
      `  Requested (UTC): ${date(item.requested_unlocked_at)}`,
      `  Actual (UTC):    ${date(item.actual_unlocked_at)}`,
      ...(item.error_code ? [`  Error: ${text(item.error_code)}`] : []),
      '',
    );
  }
  if (!data.complete) lines.push('Check each result before retrying.');
  return lines.join('\n').trimEnd();
}

function failure(error: PublicError, width: number) {
  const lines = [paragraph(`Error [${error.code}]: ${error.message}`, width)];
  if (error.details?.report) lines.push('', report(error.details.report, width));
  else
    for (const [name, value] of Object.entries(error.details ?? {})) {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        lines.push(paragraph(`${name}: ${value}`, width));
    }
  return lines.join('\n');
}

function isSuccess(outcome: CLIOutcome): outcome is SuccessOutcome {
  return outcome.result.ok;
}

export function formatOutput(
  outcome: CLIOutcome,
  { columns = 100 }: { columns?: number | undefined } = {},
) {
  if (outcome.format === 'json')
    return `${JSON.stringify(outcome.result, null, outcome.pretty ? 2 : undefined)}\n`;
  const width = Math.max(40, Math.min(Number.isFinite(columns) ? columns : 100, 140));
  if (!isSuccess(outcome)) return `${failure(outcome.result.error, width)}\n`;
  let body: string;
  switch (outcome.command) {
    case 'help':
      body = help(outcome.result.data, width);
      break;
    case 'auth login':
    case 'auth status':
    case 'auth logout':
    case 'auth finish':
    case 'auth import':
      body = login(outcome.result.data, width);
      break;
    case 'games list':
      body = games(outcome.result.data, width);
      break;
    case 'achievements list':
      body = achievements(outcome.result.data, width);
      break;
    case 'queue apply':
      body = report(outcome.result.data, width);
      break;
    case 'queue create':
    case 'queue add':
    case 'queue remove':
    case 'queue set-date':
    case 'queue show':
      body = queue(outcome.result.data, outcome.command, outcome.file, width);
      break;
    case 'doctor': {
      const data = outcome.result.data;
      body = [
        `${data.supported ? 'Supported' : 'Unsupported'} platform: ${text(data.platform)} (${text(data.architecture)})`,
        `Node: ${text(data.node)}`,
        `Credential store: ${(data.credentials_available ?? data.keychain_available) ? 'available' : 'unavailable'}`,
        'code' in data.login
          ? `Login check: ${text(data.login.message)}`
          : login(data.login, width),
      ].join('\n');
      break;
    }
    default:
      body = 'Command completed. Use --json for full details.';
  }
  return `${body}\n`;
}
