import type {
  CredentialVault,
  Session,
  LoginOptions,
  SignalOptions,
  AuthStatus,
} from './auth-ports.mjs';
import type { GogAPIPort } from './achievement-ports.mjs';
import { GogError, requireValue } from '../domain/errors.mjs';
import { fields } from '../domain/objects.mjs';
import { id } from '../domain/values.mjs';
import { LOGIN_REDIRECT } from './oauth.mjs';
export interface SessionState {
  api: Pick<GogAPIPort, 'exchangeCode' | 'refresh'>;
  vault: CredentialVault;
  now: () => number;
  cachedSession: Session | null;
}
export function validSession(value: unknown): Session {
  const session = fields(value);
  requireValue(
    value &&
      typeof session.access_token === 'string' &&
      session.access_token &&
      typeof session.refresh_token === 'string' &&
      session.refresh_token &&
      typeof session.expires_at === 'number' &&
      Number.isFinite(session.expires_at),
    'AUTH_REQUIRED',
    'Sign in with auth login.',
    3,
  );
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_id: id(session.user_id, 'User ID'),
    expires_at: session.expires_at,
  };
}
export async function finishLogin(
  state: SessionState,
  input: string,
  { redirectURI = LOGIN_REDIRECT, signal }: LoginOptions & SignalOptions = {},
): Promise<AuthStatus> {
  const checkCancelled = () => {
    if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
  };
  checkCancelled();
  let code = input.trim();
  if (/^https?:/i.test(code)) {
    let url;
    try {
      url = new URL(code);
    } catch {
      throw new GogError('INVALID_LOGIN_CODE', 'Use the final GOG login URL.', 2);
    }
    requireValue(
      url.protocol === 'https:' &&
        ['embed.gog.com', 'www.gog.com'].includes(url.hostname) &&
        url.pathname.replace(/\/$/, '') === '/on_login_success' &&
        !url.username &&
        !url.password &&
        !url.port,
      'INVALID_LOGIN_CODE',
      'This URL is not the GOG login callback. Run auth login for automatic sign-in.',
      2,
    );
    code = url.searchParams.get('code') ?? '';
  }
  requireValue(
    /^[A-Za-z0-9._~+=/-]{1,4096}$/.test(code),
    'INVALID_LOGIN_CODE',
    'The login code is missing or not valid.',
    2,
  );
  let session;
  try {
    session = validSession(await state.api.exchangeCode(code, redirectURI, { signal }));
  } catch (error) {
    checkCancelled();
    throw error;
  }
  checkCancelled();
  try {
    await state.vault.set(session, { interactive: true, signal });
  } catch (error) {
    checkCancelled();
    throw error;
  }
  checkCancelled();
  state.cachedSession = session;
  return {
    authenticated: true,
    user_id: session.user_id,
    storage: state.vault.storage ?? 'macos_keychain',
  };
}
export async function importLogin(state: SessionState, input: string): Promise<AuthStatus> {
  const refreshToken = input.trim();
  requireValue(
    refreshToken.length > 0 && refreshToken.length <= 16_000 && !/\s/.test(refreshToken),
    'INVALID_CREDENTIALS',
    'Supply one refresh token through stdin.',
    2,
  );
  const session = validSession(await state.api.refresh(refreshToken));
  await state.vault.set(session, { interactive: true });
  state.cachedSession = session;
  return {
    authenticated: true,
    user_id: session.user_id,
    storage: state.vault.storage ?? 'macos_keychain',
  };
}
export async function authStatus(state: SessionState): Promise<AuthStatus> {
  const stored = await state.vault.get();
  if (!stored) return { authenticated: false, storage: state.vault.storage ?? 'macos_keychain' };
  const session = validSession(stored);
  return {
    authenticated: true,
    user_id: session.user_id,
    expired: session.expires_at <= state.now(),
    storage: state.vault.storage ?? 'macos_keychain',
  };
}
export async function logout(state: SessionState): Promise<AuthStatus> {
  await state.vault.remove();
  state.cachedSession = null;
  return { authenticated: false, local_login_removed: true };
}
export async function session(state: SessionState) {
  let session = validSession(state.cachedSession ?? (await state.vault.get()));
  if (session.expires_at <= state.now() + 30_000) {
    const refreshed = validSession(await state.api.refresh(session.refresh_token));
    requireValue(
      refreshed.user_id === session.user_id,
      'ACCOUNT_MISMATCH',
      'The refreshed login belongs to another account.',
      5,
    );
    await state.vault.set(refreshed);
    session = refreshed;
  }
  state.cachedSession = session;
  return session;
}
