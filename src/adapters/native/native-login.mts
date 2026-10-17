import { LOGIN_TIMEOUT_MS, MAX_LOGIN_TIMEOUT_MS } from '../../domain/login-policy.mjs';
import type {
  NativeConfig,
  HelperOptions,
  NativeLoginOptions,
  AuthStatus,
} from '../../application/ports.mjs';

import { fields, errorCode } from '../../domain/objects.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { LOGIN_REDIRECT } from '../../application/oauth.mjs';
import { GogError, requireValue } from '../../domain/errors.mjs';
import { nativeHelperPath } from './assets.mjs';
import { runProcess } from './process.mjs';

const HELPER_ERRORS = new Map<string, [string, number]>([
  ['AUTH_CANCELLED', ['Sign-in was cancelled.', 3]],
  ['AUTH_TIMEOUT', ['Sign-in timed out. Run auth login to try again.', 3]],
  [
    'INVALID_LOGIN_STATE',
    ['GOG returned an unexpected sign-in response. Run auth login again.', 3],
  ],
  [
    'LOGIN_PAGE_FAILED',
    ['The GOG sign-in page could not load. Check your connection and try again.', 4],
  ],
  ['INVALID_LOGIN_CODE', ['GOG did not return a valid login code.', 3]],
  [
    'WEBVIEW2_MISSING',
    [
      'Install the Microsoft Edge WebView2 Runtime from https://developer.microsoft.com/microsoft-edge/webview2/, then retry auth login.',
      7,
    ],
  ],
]);

export async function runNativeHelper(
  config: NativeConfig,
  {
    signal,
    helperPath,
    spawnImpl,
    execute = runProcess,
    platform = process.platform,
  }: HelperOptions = {},
) {
  if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
  let result;
  try {
    result = await execute(helperPath ?? nativeHelperPath(platform), [], JSON.stringify(config), {
      timeoutMs: config.timeout_ms + 5000,
      maxOutputBytes: 16_000,
      // On Windows, hiding a process also hides its first GUI window.
      windowsHide: platform !== 'win32',
      signal,
      spawnImpl,
    });
  } catch (error) {
    if (errorCode(error) === 'PROCESS_CANCELLED')
      throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
    if (errorCode(error) === 'PROCESS_TIMEOUT')
      throw new GogError('AUTH_TIMEOUT', 'Sign-in timed out. Run auth login to try again.', 3);
    if (errorCode(error) === 'PROCESS_OUTPUT_LIMIT')
      throw new GogError(
        'INVALID_LOGIN_RESPONSE',
        'The sign-in helper returned an invalid response.',
        3,
      );
    throw new GogError(
      errorCode(error) === 'PROCESS_MISSING' ? 'NATIVE_HELPER_MISSING' : 'NATIVE_HELPER_FAILED',
      errorCode(error) === 'PROCESS_MISSING'
        ? 'Build the native sign-in helper with npm run build, then retry auth login.'
        : 'Cannot start the native sign-in window.',
      7,
    );
  }
  if (!result.stdout.trim()) {
    throw result.code === 0
      ? new GogError('AUTH_CANCELLED', 'The sign-in window closed without completing login.', 3)
      : new GogError(
          'NATIVE_HELPER_FAILED',
          'The native sign-in window could not start or closed unexpectedly.',
          7,
        );
  }
  let event: unknown;
  try {
    event = JSON.parse(result.stdout);
  } catch {
    throw new GogError(
      'INVALID_LOGIN_RESPONSE',
      'The sign-in helper returned an invalid response.',
      3,
    );
  }
  if (result.code !== 0 && fields(event).type !== 'error')
    throw new GogError('NATIVE_HELPER_FAILED', 'The native sign-in window closed unexpectedly.', 7);
  return event;
}

export async function loginWithNativeWindow({
  service,
  progress = () => {},
  timeoutMs = LOGIN_TIMEOUT_MS,
  signal,
  runHelper = runNativeHelper,
  platform = process.platform,
}: NativeLoginOptions = {}): Promise<AuthStatus> {
  requireValue(service, 'INVALID_LOGIN_OPTIONS', 'A login service is required.');
  requireValue(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_LOGIN_TIMEOUT_MS,
    'INVALID_LOGIN_TIMEOUT',
    'The sign-in timeout must be at most 600 seconds.',
  );
  const state = randomBytes(32).toString('base64url');
  progress('Complete GOG sign-in in the window. This command will finish automatically.');
  const event = fields(
    await runHelper(
      { login_url: service.loginURL({ state }), state, timeout_ms: timeoutMs },
      { signal, platform },
    ),
  );
  if (event?.type === 'error') {
    const [message, exitCode] = HELPER_ERRORS.get(String(event.code)) ?? [
      'The native sign-in window could not finish login.',
      7,
    ];
    throw new GogError(
      HELPER_ERRORS.has(String(event.code)) ? String(event.code) : 'NATIVE_HELPER_FAILED',
      message,
      exitCode,
    );
  }
  requireValue(
    event?.type === 'code' &&
      typeof event.code === 'string' &&
      /^[A-Za-z0-9._~+=/-]{1,4096}$/.test(event.code),
    'INVALID_LOGIN_RESPONSE',
    'The sign-in helper did not return a valid login response.',
    3,
  );
  // The registered GOG callback does not always echo OAuth state. The helper
  // captures only a main-frame GOG callback in its own nonpersistent webview.
  // If GOG does echo state, verify it again before exchanging the code.
  if (event.state !== null && event.state !== undefined) {
    requireValue(
      typeof event.state === 'string',
      'INVALID_LOGIN_STATE',
      'GOG returned an unexpected sign-in response.',
      3,
    );
    const actual = Buffer.from(event.state);
    const expected = Buffer.from(state);
    requireValue(
      actual.length === expected.length && timingSafeEqual(actual, expected),
      'INVALID_LOGIN_STATE',
      'GOG returned an unexpected sign-in response.',
      3,
    );
  }
  if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
  const data = await service.finishLogin(event.code, { redirectURI: LOGIN_REDIRECT, signal });
  return { ...data, method: 'native_webview' };
}
