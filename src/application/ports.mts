import type { Game, LibraryGame, Achievement, PublicGame, PublicError } from '../domain/model.mjs';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
export interface Session {
  access_token: string;
  refresh_token: string;
  user_id: string | number;
  expires_at: number;
}

export interface LoginOptions {
  redirectURI?: string | undefined;
  state?: string | undefined;
}

export interface SignalOptions {
  signal?: AbortSignal | undefined;
}

export interface CredentialOptions extends SignalOptions {
  interactive?: boolean | undefined;
}

export interface CredentialVault {
  storage?: string;
  get(): Promise<unknown>;
  set(session: unknown, options?: CredentialOptions): Promise<void>;
  remove(): Promise<void>;
}

export interface GogAPIPort {
  exchangeCode(code: string, redirectURI?: string, options?: SignalOptions): Promise<Session>;
  refresh(token: string, game?: Game): Promise<Session>;
  ownedIDs(token: string): Promise<string[]>;
  games(token: string, search?: string): Promise<LibraryGame[]>;
  game(id: string): Promise<Game>;
  achievements(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id'> & Partial<Pick<Session, 'access_token'>>,
  ): Promise<Achievement[]>;
  unlock(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id' | 'access_token'>,
    id: string,
    date: string,
  ): Promise<unknown>;
}

export interface Context {
  session: Session;
  game: Game;
  achievements: Achievement[];
}

export interface GamesResult {
  user_id: string | number;
  count: number;
  games: LibraryGame[];
}

export interface AchievementsResult {
  user_id: string | number;
  game: PublicGame;
  count: number;
  achievements: Achievement[];
}

export interface AuthStatus {
  authenticated: boolean;
  user_id?: string | number;
  expired?: boolean;
  storage?: string;
  local_login_removed?: boolean;
  method?: string;
}

export interface ManualLogin extends AuthStatus {
  action_required: string;
  browser_opened: boolean;
  login_url: string;
  next_command: string;
  instructions: string;
}

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

export interface LoginService {
  loginURL(options?: LoginOptions): string;
  finishLogin(input: string, options?: LoginOptions & SignalOptions): Promise<AuthStatus>;
}

export interface NativeLoginOptions extends SignalOptions {
  service?: LoginService;
  progress?: (message: string) => unknown;
  timeoutMs?: number;
  runHelper?: (config: NativeConfig, options?: HelperOptions) => Promise<unknown>;
  platform?: string;
}

export interface FetchOptions extends RequestInit {
  headers: Record<string, string>;
}

export type FetchImpl = (url: string, options: FetchOptions) => Promise<Response>;
