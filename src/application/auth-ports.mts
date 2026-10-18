export interface Session {
  access_token: string;
  refresh_token: string;
  user_id: string;
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
export interface AuthStatus {
  authenticated: boolean;
  user_id?: string;
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
export interface LoginService {
  loginURL(options?: LoginOptions): string;
  finishLogin(input: string, options?: LoginOptions & SignalOptions): Promise<AuthStatus>;
}
