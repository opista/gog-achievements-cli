import type { AuthStatus, LoginService } from '../application/auth-ports.mjs';
import type { OutputStream, NativeLoginOptions } from '../application/native-ports.mjs';
import type { AchievementServicePort } from '../application/service-contract.mjs';
import type { UpdatePort } from '../application/update-ports.mjs';
import type { Queue, Success } from '../domain/model.mjs';
import type { CommandName, CommandData } from './contracts.mjs';
import type { ParsedCommand } from './parse.mjs';

export type CLIService = AchievementServicePort;
export interface CLIEffects {
  service: CLIService;
  stderr: OutputStream;
  platform: string;
  isPackaged: () => boolean;
  systemInfo: () => { node: string; architecture: string };
  readInput: (mode: 'clipboard' | 'stdin') => Promise<string>;
  nativeLogin: (options: NativeLoginOptions & { service: LoginService }) => Promise<AuthStatus>;
  files: {
    read: (path: string) => Promise<Queue>;
    save: (path: string, queue: unknown, options?: { create?: boolean }) => Promise<void>;
    withLock: <T>(path: string, operation: () => Promise<T>) => Promise<T>;
  };
  updates: UpdatePort;
  confirm: (question: string) => Promise<boolean>;
  writeExport: (path: string, data: string) => Promise<string>;
}

export type FamilyCommand<K extends CommandName> = Extract<ParsedCommand, { command: K }>;
export type CommandResponse<K extends CommandName = CommandName> = {
  [Name in K]: { command: Name; result: Success<CommandData[Name]> };
}[K];

export function commandSuccess<K extends CommandName>(
  name: K,
  data: NoInfer<CommandData[K]>,
): { command: K; result: Success<CommandData[K]> } {
  return { command: name, result: { ok: true, data } };
}
