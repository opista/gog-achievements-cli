import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import type { PublicError } from '../domain/model.mjs';
import type { AuthStatus, LoginService, SignalOptions } from './auth-ports.mjs';
export interface DoctorResult {
  supported: boolean;
  platform: string;
  architecture: string;
  node: string;
  credentials_available: boolean;
  keychain_available: boolean | null;
  login: AuthStatus | PublicError;
}

export type NativeChild = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr'> &
  Pick<EventEmitter, 'on'> & { kill(signal: NodeJS.Signals): unknown };

export type SpawnProcess = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean },
) => NativeChild;

export interface ProcessOptions extends SignalOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  windowsHide?: boolean;
  spawnImpl?: SpawnProcess | undefined;
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  input?: string,
  options?: ProcessOptions,
) => Promise<ProcessResult>;

export type InputStream = Readable & { isTTY?: boolean };

export interface OutputStream {
  write(message: string): unknown;
}

export interface NativeConfig {
  timeout_ms: number;
  login_url?: string;
  state?: string;
}

export interface HelperOptions extends SignalOptions {
  helperPath?: string;
  spawnImpl?: SpawnProcess | undefined;
  execute?: ProcessRunner;
  platform?: string;
}
export interface NativeLoginOptions extends SignalOptions {
  service?: LoginService;
  progress?: (message: string) => unknown;
  timeoutMs?: number;
  runHelper?: (config: NativeConfig, options?: HelperOptions) => Promise<unknown>;
  platform?: string;
}
