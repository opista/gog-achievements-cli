import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { loginWithBrowser } from '../src/browser-login.mjs';
import { fixture, USER_ID } from './fixture.mjs';

function callback(authURL, { code = 'test-secret-code', state } = {}) {
  const auth = new URL(authURL);
  const redirectURI = auth.searchParams.get('redirect_uri');
  const url = new URL(redirectURI);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state ?? auth.searchParams.get('state'));
  return { url, redirectURI };
}

async function assertClosed(redirectURI) {
  await assert.rejects(fetch(redirectURI, { signal: AbortSignal.timeout(1000) }));
}

test('one browser command exchanges the callback code, stores login and closes its listener', async () => {
  const f = fixture();
  let redirectURI;
  let openings = 0;
  const result = await loginWithBrowser({ service: f.service, timeoutMs: 1000, openBrowser: async authURL => {
    openings++;
    const request = callback(authURL);
    redirectURI = request.redirectURI;
    assert.equal(new URL(redirectURI).hostname, '127.0.0.1');
    const response = await fetch(request.url, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.ok(body.includes('Signed in'));
    assert.ok(body.includes('history.replaceState'));
    assert.ok(!body.includes('test-secret-code'));
    return true;
  } });
  assert.equal(openings, 1);
  assert.equal(result.authenticated, true);
  assert.equal(result.user_id, USER_ID);
  assert.equal(result.method, 'browser_callback');
  assert.equal(f.vault.saved.length, 1);
  assert.equal(f.calls[0].url.searchParams.get('redirect_uri'), redirectURI);
  assert.ok(!JSON.stringify(result).includes('fake-refreshed-token'));
  await assertClosed(redirectURI);
});

test('wrong states, duplicate states, paths and Host headers cannot complete login', async () => {
  const f = fixture();
  const result = await loginWithBrowser({ service: f.service, timeoutMs: 1000, openBrowser: async authURL => {
    const correct = callback(authURL);
    const wrongState = callback(authURL, { state: 'wrong-state' });
    assert.equal((await fetch(wrongState.url)).status, 400);
    const duplicate = new URL(correct.url);
    duplicate.searchParams.append('state', duplicate.searchParams.get('state'));
    assert.equal((await fetch(duplicate)).status, 400);
    const wrongPath = new URL(correct.url);
    wrongPath.pathname = '/callback/other';
    assert.equal((await fetch(wrongPath)).status, 404);
    // Fetch normalizes Host. Use the HTTP client to send a real mismatched header.
    const wrongHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(correct.url, { headers: { Host: 'attacker.example' }, timeout: 1000 }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject).on('timeout', () => request.destroy(new Error('Test request timed out')));
      request.end();
    });
    assert.equal(wrongHostStatus, 404);
    assert.equal(f.calls.length, 0);
    const response = await fetch(correct.url);
    await response.text();
    return true;
  } });
  assert.equal(result.authenticated, true);
  assert.equal(f.calls.length, 1);
});

test('a browser failure closes the listener and leaves credentials unchanged', async () => {
  const f = fixture();
  let redirectURI;
  await assert.rejects(loginWithBrowser({ service: f.service, openBrowser: async authURL => {
    redirectURI = callback(authURL).redirectURI;
    return false;
  } }), error => error.code === 'BROWSER_OPEN_FAILED');
  assert.equal(f.vault.saved.length, 0);
  await assertClosed(redirectURI);
});

test('browser timeout and cancellation close the listener without saving login', async () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    let redirectURI;
    const abort = new AbortController();
    const flow = loginWithBrowser({ service: f.service, timeoutMs: 30, signal: abort.signal, openBrowser: async authURL => {
      redirectURI = callback(authURL).redirectURI;
      if (cancel) abort.abort();
      return true;
    } });
    await assert.rejects(flow, error => error.code === (cancel ? 'AUTH_CANCELLED' : 'AUTH_TIMEOUT'));
    assert.equal(f.vault.saved.length, 0);
    await assertClosed(redirectURI);
  }
});

test('GOG denial and token errors return safe errors and close the listener', async () => {
  for (const denial of [true, false]) {
    const f = fixture();
    if (!denial) f.setHook(url => url.hostname === 'auth.gog.com' ? new Response('sensitive server body', { status: 401 }) : null);
    let redirectURI;
    await assert.rejects(loginWithBrowser({ service: f.service, timeoutMs: 1000, openBrowser: async authURL => {
      const request = callback(authURL);
      redirectURI = request.redirectURI;
      if (denial) { request.url.searchParams.delete('code'); request.url.searchParams.set('error', 'access_denied'); }
      const response = await fetch(request.url);
      const body = await response.text();
      assert.ok(!body.includes('sensitive server body'));
      return true;
    } }), error => error.code === (denial ? 'AUTH_CANCELLED' : 'AUTH_REJECTED'));
    assert.equal(f.vault.saved.length, 0);
    await assertClosed(redirectURI);
  }
});

test('a closed browser callback does not leave a completed login waiting forever', async () => {
  const f = fixture();
  const originalFinish = f.service.finishLogin.bind(f.service);
  f.service.finishLogin = async (...args) => { await delay(30); return originalFinish(...args); };
  let redirectURI;
  const result = await loginWithBrowser({ service: f.service, timeoutMs: 1000, openBrowser: async authURL => {
    const request = callback(authURL);
    redirectURI = request.redirectURI;
    const abort = new AbortController();
    const pending = fetch(request.url, { signal: abort.signal });
    setTimeout(() => abort.abort(), 10);
    await pending.catch(() => {});
    return true;
  } });
  assert.equal(result.authenticated, true);
  assert.equal(f.vault.saved.length, 1);
  await assertClosed(redirectURI);
});
