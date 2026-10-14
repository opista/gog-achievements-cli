import type { CommandName, CommandSpec } from './contracts.mjs';
import { parseArgs } from 'node:util';
import { GogError, requireValue } from '../domain/errors.mjs';
import { id } from '../domain/values.mjs';
import { COMMANDS, FLAGS, commandDefinitions } from './definitions.mjs';
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

export function parseArguments(args: string[]) {
  try {
    return parseArgs({ args, allowPositionals: true, strict: true, options: ARGUMENT_OPTIONS });
  } catch {
    throw new GogError(
      'INVALID_ARGUMENTS',
      'Invalid command arguments. Run --help for the command list.',
      2,
    );
  }
}
export type ParsedFlags = ReturnType<typeof parseArguments>['values'];
type RequiredFlag<K extends CommandName> = (typeof COMMANDS)[K] extends {
  required: readonly (infer F)[];
}
  ? Extract<F, keyof ParsedFlags>
  : never;
export type ParsedCommand = {
  [K in CommandName]: {
    command: K;
    flags: ParsedFlags & Required<Pick<ParsedFlags, RequiredFlag<K>>>;
  };
}[CommandName];
export function resolveCommand(topic: string) {
  const spec = commandDefinitions[topic];
  requireValue(spec, 'UNKNOWN_COMMAND', 'Unknown command. Run --help for the command list.');
  return { command: topic as CommandName, spec };
}
export function validatedCommand(
  command: CommandName,
  flags: ParsedFlags,
  spec: CommandSpec,
): ParsedCommand {
  requireValue(
    Object.keys(flags).every((key) => ['pretty', 'json'].includes(key) || spec.flags.includes(key)),
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

  // The same command definitions establish the required flag fields above.
  return { command, flags } as ParsedCommand;
}
