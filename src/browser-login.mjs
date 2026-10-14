import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { GogError, requireValue } from './errors.mjs';

const CLEAN_HISTORY = "history.replaceState(null,'','/done');";
const SCRIPT_HASH = createHash('sha256').update(CLEAN_HISTORY).digest('base64');

function sendPage(response, title, message, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; frame-ancestors 'none'; base-uri 'none'`,
  });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body><h1>${title}</h1><p>${message}</p><script>${CLEAN_HISTORY}</script></body></html>`);
}

async function stopServer(server) {
  if (!server.listening) return;
  await new Promise(resolve => {
    const forceClose = setTimeout(() => { server.closeAllConnections(); resolve(); }, 1000);
    server.close(() => { clearTimeout(forceClose); resolve(); });
    server.closeIdleConnections();
  });
}

export async function loginWithBrowser({ service, openBrowser, progress = () => {}, timeoutMs = 180_000, signal } = {}) {
  requireValue(service && typeof openBrowser === 'function', 'INVALID_LOGIN_OPTIONS', 'A browser opener and login service are required.');
  requireValue(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600_000,
    'INVALID_LOGIN_TIMEOUT', 'The browser sign-in timeout must be at most 600 seconds.');
  if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);

  const state = randomBytes(32).toString('base64url');
  const expectedState = Buffer.from(state);
  const callbackPath = `/callback/${randomBytes(24).toString('base64url')}`;
  let host;
  let redirectURI;
  let timer;
  let claimed = false;
  let ended = false;
  let resolveLogin;
  let rejectLogin;
  const completion = new Promise((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; });
  // The browser can send a response before openBrowser finishes. Attach a
  // handler now, then await the same promise below.
  completion.catch(() => {});
  const fail = error => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    rejectLogin(error);
  };
  const succeed = data => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    resolveLogin(data);
  };
  const afterResponse = (response, callback) => {
    if (response.destroyed) { callback(); return; }
    response.once('finish', callback);
    response.once('close', callback);
  };
  const onAbort = () => fail(new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3));

  const server = createServer((request, response) => {
    handleCallback(request, response).catch(() => {
      if (!response.headersSent) sendPage(response, 'Sign-in failed', 'See the terminal for details.', 500);
      else response.end();
      fail(new GogError('AUTH_FAILED', 'Sign-in could not finish. Run auth login to try again.', 3));
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.on('error', () => fail(new GogError('AUTH_SERVER_FAILED', 'Cannot use the local sign-in callback.', 7)));

  async function handleCallback(request, response) {
    let url;
    try { url = new URL(request.url, `http://${host}`); } catch { /* invalid request */ }
    if (request.method !== 'GET' || request.headers.host !== host || !url ||
      url.origin !== `http://${host}` || url.pathname !== callbackPath || request.url.length > 8192) {
      response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Not found.');
      return;
    }
    const states = url.searchParams.getAll('state');
    const receivedState = Buffer.from(states[0] ?? '');
    if (states.length !== 1 || receivedState.length !== expectedState.length || !timingSafeEqual(receivedState, expectedState)) {
      sendPage(response, 'Invalid sign-in response', 'Continue sign-in in the GOG tab.', 400);
      return;
    }
    if (ended || claimed || signal?.aborted) {
      sendPage(response, 'Sign-in response already handled', 'Return to the terminal.', 409);
      return;
    }
    if (url.searchParams.has('error')) {
      claimed = true;
      clearTimeout(timer);
      afterResponse(response, () => fail(new GogError('AUTH_CANCELLED', 'GOG sign-in was cancelled or rejected.', 3)));
      sendPage(response, 'Sign-in cancelled', 'You can close this tab and return to the terminal.');
      return;
    }
    const codes = url.searchParams.getAll('code');
    if (codes.length !== 1 || !/^[A-Za-z0-9._~+=/-]{1,4096}$/.test(codes[0])) {
      sendPage(response, 'Invalid sign-in response', 'GOG did not return a valid login code.', 400);
      return;
    }
    claimed = true;
    clearTimeout(timer); // Browser wait ends here; token/Keychain calls have their own timeouts.
    try {
      const data = await service.finishLogin(codes[0], { redirectURI, signal });
      afterResponse(response, () => succeed({ ...data, method: 'browser_callback' }));
      sendPage(response, 'Signed in', 'You can close this tab and return to the terminal.');
    } catch (error) {
      afterResponse(response, () => fail(error instanceof GogError ? error :
        new GogError('AUTH_FAILED', 'Sign-in could not finish. Run auth login to try again.', 3)));
      sendPage(response, 'Sign-in failed', 'See the terminal for details.', 500);
    }
  }

  try {
    await new Promise((resolve, reject) => {
      const onError = () => reject(new GogError('AUTH_SERVER_FAILED', 'Cannot start the local sign-in callback.', 7));
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', onError); resolve(); });
    });
    host = `127.0.0.1:${server.address().port}`;
    redirectURI = `http://${host}${callbackPath}`;
    timer = setTimeout(() => fail(new GogError('AUTH_TIMEOUT', 'Sign-in timed out. Run auth login to try again.', 3)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) throw new GogError('AUTH_CANCELLED', 'Sign-in was cancelled.', 3);
    progress('Complete GOG sign-in in the browser. This command will finish automatically.');
    const opened = await openBrowser(service.loginURL({ redirectURI, state }));
    requireValue(opened, 'BROWSER_OPEN_FAILED', 'Cannot open the browser. Use auth login --no-open for manual sign-in.', 7);
    return await completion;
  } finally {
    ended = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await stopServer(server);
  }
}
