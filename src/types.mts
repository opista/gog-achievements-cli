import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

export interface Session {
  access_token: string;
  refresh_token: string;
  user_id: string | number;
  expires_at: number;
}
export interface PublicGame {
  id: string;
  title: string;
  client_id: string;
}
export interface Game extends PublicGame {
  client_secret: string;
}
export interface LibraryGame {
  id: string;
  title?: string;
  slug?: string | null;
  image?: string | null;
  works_on?: unknown;
}
interface AchievementData {
  id: string;
  key: string;
  name: string;
  description: string;
  hidden: boolean;
  image_locked: unknown;
  image_unlocked: unknown;
  rarity: unknown;
}
export type Achievement = AchievementData &
  ({ unlocked: false; unlocked_at: null } | { unlocked: true; unlocked_at: string });
export interface QueueItem {
  achievement_id: string;
  key: string;
  name: string;
  unlocked_at: string;
}
export interface Queue {
  schema_version: 1;
  user_id: string;
  game: PublicGame;
  created_at: string;
  updated_at: string;
  items: QueueItem[];
}
export type RestorationStatus =
  | 'pending'
  | 'restored'
  | 'skipped_already_unlocked'
  | 'restored_with_different_date'
  | 'failed'
  | 'unconfirmed'
  | 'not_attempted';
export interface RestorationResult {
  achievement_id: string;
  name: string;
  requested_unlocked_at: string;
  previous_unlocked_at: string | null;
  actual_unlocked_at: string | null;
  status: RestorationStatus;
  error_code?: string;
}
export interface RestorationReport {
  dry_run: boolean;
  user_id: string;
  game: PublicGame;
  complete: boolean;
  results: RestorationResult[];
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
export interface PublicError {
  code: string;
  message: string;
  details?: Record<string, unknown> & { report?: RestorationReport };
}
export interface Failure {
  ok: false;
  error: PublicError;
}
export interface Success<T> {
  ok: true;
  data: T;
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
export interface FlagSpec {
  value?: string;
  multiple?: boolean;
  short?: string;
  description: string;
}
export interface CommandSpec {
  flags: string[];
  required?: string[];
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
