import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { LOGIN_REDIRECT } from './api.mjs';
import { GogError, requireValue } from './errors.mjs';

const HELPER_PATH = fileURLToPath(new URL('../native/bin/gog-login', import.meta.url));
const HELPER_ERRORS = new Map([
  ['AUTH_CANCELLED', ['Sign-in was cancelled.', 3]],
  ['AUTH_TIMEOUT', ['Sign-in timed out. Run auth login to try again.', 3]],
  ['INVALID_LOGIN_STATE', ['GOG returned an unexpected sign-in response. Run auth login again.', 3]],
  ['LOGIN_PAGE_FAILED', ['The GOG sign-in page could not load. Check your connection and try again.', 4]],
  ['INVALID_LOGIN_CODE', ['GOG did not return a valid login code.', 3]],
]);

export async function runNativeHelper(config, { signal, helperPath = HELPER_PATH, spawnImpl = spawn } = {}) {
  if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let problem;
    let finished = false;
    const onAbort = () => { problem = new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3); child.kill('SIGKILL'); };
    const timer = setTimeout(() => {
      problem = new GogError('AUTH_TIMEOUT', 'Sign-in timed out. Run auth login to try again.', 3);
      child.kill('SIGKILL');
    }, config.timeout_ms + 5000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', part => {
      output += part;
      if (output.length > 16_000) {
        problem = new GogError('INVALID_LOGIN_RESPONSE', 'The sign-in helper returned an invalid response.', 3);
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', () => {}); // WebKit diagnostics can contain navigation URLs.
    child.stdin.on('error', () => {});
    child.on('error', error => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new GogError(error.code === 'ENOENT' ? 'NATIVE_HELPER_MISSING' : 'NATIVE_HELPER_FAILED',
        error.code === 'ENOENT' ? 'Build the Mac sign-in helper with npm run build:mac, then retry auth login.' :
          'Cannot start the Mac sign-in window.', 7));
    });
    child.on('close', () => {
      if (finished) return;
      finished = true;
      cleanup();
      if (problem) { reject(problem); return; }
      if (!output.trim()) { reject(new GogError('AUTH_CANCELLED', 'The sign-in window closed without completing login.', 3)); return; }
      try { resolve(JSON.parse(output)); }
      catch { reject(new GogError('INVALID_LOGIN_RESPONSE', 'The sign-in helper returned an invalid response.', 3)); }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    // The helper's private pipe carries the auth URL and its callback response.
    // Its stdout is captured here; login codes never reach CLI stdout or argv.
    child.stdin.end(JSON.stringify(config));
  });
}

export async function loginWithNativeWindow({ service, progress = () => {}, timeoutMs = 180_000,
  signal, runHelper = runNativeHelper } = {}) {
  requireValue(service, 'INVALID_LOGIN_OPTIONS', 'A login service is required.');
  requireValue(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600_000,
    'INVALID_LOGIN_TIMEOUT', 'The sign-in timeout must be at most 600 seconds.');
  const state = randomBytes(32).toString('base64url');
  progress('Complete GOG sign-in in the window. This command will finish automatically.');
  const event = await runHelper({ login_url: service.loginURL({ state }), state, timeout_ms: timeoutMs }, { signal });
  if (event?.type === 'error') {
    const [message, exitCode] = HELPER_ERRORS.get(event.code) ?? ['The Mac sign-in window could not finish login.', 7];
    throw new GogError(HELPER_ERRORS.has(event.code) ? event.code : 'NATIVE_HELPER_FAILED', message, exitCode);
  }
  requireValue(event?.type === 'code' && typeof event.code === 'string' && /^[A-Za-z0-9._~+=/-]{1,4096}$/.test(event.code),
    'INVALID_LOGIN_RESPONSE', 'The sign-in helper did not return a valid login response.', 3);
  // The registered GOG callback does not always echo OAuth state. The helper
  // captures only a main-frame GOG callback in its own nonpersistent webview.
  // If GOG does echo state, verify it again before exchanging the code.
  if (event.state !== null && event.state !== undefined) {
    requireValue(typeof event.state === 'string', 'INVALID_LOGIN_STATE', 'GOG returned an unexpected sign-in response.', 3);
    const actual = Buffer.from(event.state);
    const expected = Buffer.from(state);
    requireValue(actual.length === expected.length && timingSafeEqual(actual, expected),
      'INVALID_LOGIN_STATE', 'GOG returned an unexpected sign-in response.', 3);
  }
  if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
  const data = await service.finishLogin(event.code, { redirectURI: LOGIN_REDIRECT, signal });
  return { ...data, method: 'native_webview' };
}
