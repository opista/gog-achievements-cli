import type { CLIOutcome, CommandName } from './contracts.mjs';
import type { CLIEffects, CommandResponse } from './handler-contracts.mjs';
import { GogError, errorResult, requireValue } from '../domain/errors.mjs';
import { commandHelp } from './definitions.mjs';
import { parseArguments, resolveCommand, validatedCommand } from './parse.mjs';
import { handleAuth } from './auth-handlers.mjs';
import { handleQueue } from './queue-handlers.mjs';
import { handleQuery } from './query-handlers.mjs';
import { handleUpdate } from './update-handler.mjs';
export type { CLIService, CLIEffects } from './handler-contracts.mjs';

export async function dispatchCLI(args: string[], effects: CLIEffects): Promise<CLIOutcome> {
  let pretty = args.includes('--pretty');
  let format: 'json' | 'text' = args.includes('--json') ? 'json' : 'text';
  let command: CommandName | undefined;
  let file: string | undefined;
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
    const validated = validatedCommand(command, rawFlags, resolved.spec);
    let response: CommandResponse;
    switch (validated.command) {
      case 'auth login':
      case 'auth finish':
      case 'auth import':
      case 'auth status':
      case 'auth logout':
        response = await handleAuth(validated, effects, format);
        break;
      case 'queue show':
      case 'queue create':
      case 'queue apply':
      case 'queue add':
      case 'queue remove':
      case 'queue set-date':
        response = await handleQueue(validated, effects);
        break;
      case 'games list':
      case 'achievements list':
      case 'achievements export':
      case 'doctor':
        response = await handleQuery(validated, effects);
        break;
      case 'self update':
        response = await handleUpdate(validated, effects, format);
        break;
    }
    return Object.assign(
      { exitCode: 0, pretty, format, command: response.command, file },
      response,
    );
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
