import type {
  AuthStatus,
  ManualLogin,
  GamesResult,
  AchievementsResult,
  DoctorResult,
} from '../application/ports.mjs';
import type { Queue, RestorationReport, Success, Failure } from '../domain/model.mjs';
export interface FlagSpec {
  value?: string;
  multiple?: boolean;
  short?: string;
  description: string;
}

export interface CommandSpec {
  flags: readonly string[];
  required?: readonly string[];
  description: string;
}

export interface HelpData {
  name: string;
  version: string;
  output: string;
  commands: (CommandSpec & { command: string })[];
  common_flags: string[];
  exit_codes: Record<number, string>;
  examples: string[];
  topic?: string;
  options: (FlagSpec & { flag: string; required: boolean })[];
  usage: string;
}

export interface CommandData {
  help: HelpData;
  'auth login': AuthStatus | ManualLogin;
  'auth status': AuthStatus;
  'auth logout': AuthStatus;
  'auth finish': AuthStatus;
  'auth import': AuthStatus;
  'games list': GamesResult;
  'achievements list': AchievementsResult;
  'queue create': Queue;
  'queue add': Queue;
  'queue remove': Queue;
  'queue set-date': Queue;
  'queue show': Queue;
  'queue apply': RestorationReport;
  doctor: DoctorResult;
}

export type CommandName = Exclude<keyof CommandData, 'help'>;

export interface OutcomeMeta {
  exitCode: number;
  pretty: boolean;
  format: 'text' | 'json';
  file?: string | undefined;
}

export type SuccessOutcome = {
  [K in keyof CommandData]: OutcomeMeta & { command: K; result: Success<CommandData[K]> };
}[keyof CommandData];

export type FailureOutcome = OutcomeMeta & {
  command?: CommandName | 'help' | undefined;
  result: Failure;
};

export type CLIOutcome = SuccessOutcome | FailureOutcome;
