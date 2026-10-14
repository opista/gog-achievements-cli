import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GogAPI } from '../src/api.mjs';
import { fixture, GAME_ID, USER_ID, CLIENT_ID, ACHIEVEMENT_ID, SECOND_ID, DATE } from './fixture.mjs';

test('read commands use Bearer auth and preserve build, client and achievement IDs', async () => {
  const f = fixture();
  const result = await f.service.listAchievements(GAME_ID);
  assert.equal(result.game.client_id, CLIENT_ID);
  assert.equal(result.achievements[0].id, ACHIEVEMENT_ID);
  assert.equal(result.user_id, USER_ID);
  assert.equal(f.writes.length, 0);
  const authenticated = f.calls.filter(call => call.url.hostname === 'embed.gog.com' || call.url.hostname === 'gameplay.gog.com');
  assert.ok(authenticated.every(call => call.init.headers.Authorization === 'Bearer fake-account-access'));
  assert.ok(f.calls.every(call => call.init.redirect === 'error' && call.init.signal));
  assert.ok(!JSON.stringify(result).includes('fake-game-client-secret'));
});

test('game lists follow all pages and include title data', async () => {
  const f = fixture({ libraryPages: 2 });
  const result = await f.service.listGames({ search: 'Cyberpunk' });
  assert.equal(result.count, 2);
  assert.equal(result.games[0].title, 'Cyberpunk 2077');
  assert.ok(f.calls.every(call => call.url.searchParams.get('search') === 'Cyberpunk'));
});

test('a changing library or incomplete achievement list fails the read', async () => {
  const f = fixture({ libraryPages: 2 });
  f.setHook((url) => {
    if (url.pathname.includes('getFilteredProducts') && url.searchParams.get('page') === '2') {
      return new Response(JSON.stringify({ page: 2, totalPages: 3, products: [] }));
    }
  });
  await assert.rejects(f.service.listGames(), error => error.code === 'INCOMPLETE_RESPONSE');
  f.setHook(null);
  f.setTotal(3);
  await assert.rejects(f.service.listAchievements(GAME_ID), error => error.code === 'INCOMPLETE_RESPONSE');
});

test('a game the account does not own cannot be read or queued', async () => {
  const f = fixture({ owned: [] });
  await assert.rejects(f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE), error => error.code === 'GAME_NOT_OWNED');
  assert.equal(f.calls.length, 1);
  assert.equal(f.writes.length, 0);
});

test('queue creation and date edits are reads only; dry run issues no achievement POST', async () => {
  const f = fixture();
  let queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  queue = f.service.editQueue(queue, [ACHIEVEMENT_ID], { unlockedAt: '2026-02-01T12:00:00+01:00' });
  assert.equal(queue.items[0].unlocked_at, '2026-02-01T11:00:00Z');
  const result = await f.service.applyQueue(queue);
  assert.equal(result.dry_run, true);
  assert.equal(result.results[0].status, 'pending');
  assert.equal(f.writes.length, 0);
  assert.ok(!JSON.stringify(queue).includes('fake-account'));
});

test('whole-queue preflight blocks wrong accounts, clients, dates and unknown achievements', async () => {
  const f = fixture();
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  for (const [changed, code] of [
    [{ ...queue, user_id: '123456789' }, 'ACCOUNT_MISMATCH'],
    [{ ...queue, game: { ...queue.game, client_id: '123456789' } }, 'GAME_CLIENT_CHANGED'],
    [{ ...queue, items: [...queue.items, { ...queue.items[0], achievement_id: '999999999' }] }, 'ACHIEVEMENT_CHANGED'],
    [{ ...queue, items: [{ ...queue.items[0], unlocked_at: null }] }, 'INVALID_DATE'],
  ]) {
    await assert.rejects(f.service.applyQueue(changed, { dryRun: false }), error => error.code === code);
  }
  assert.equal(f.writes.length, 0);
});

test('apply writes game-scoped auth and verifies dates; rerun preserves earned dates', async () => {
  const f = fixture();
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  const result = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(result.complete, true);
  assert.equal(result.results[0].status, 'restored');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].body, { date_unlocked: '2026-01-01T12:34:56+0000' });
  assert.equal(f.writes[0].authorization, 'Bearer fake-scoped-access');
  const repeated = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(repeated.results[0].status, 'skipped_already_unlocked');
  assert.equal(f.writes.length, 1);
});

test('a lost POST response is reconciled by a read without a second write', async () => {
  const f = fixture({ loseWriteResponse: true });
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, true);
  assert.equal(report.results[0].status, 'restored');
  assert.equal(f.writes.length, 1);
});

test('rejected writes stop apply, keep later items pending for retry, and never expose server bodies', async () => {
  const f = fixture({ rejectWrites: true });
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID, SECOND_ID], DATE);
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, false);
  assert.equal(report.results[0].status, 'failed');
  assert.equal(report.results[1].status, 'not_attempted');
  assert.equal(f.writes.length, 1);
  assert.ok(!JSON.stringify(report).includes('fake-token'));
});

test('server date changes are reported distinctly and stop later writes', async () => {
  const f = fixture({ clampDate: '2026-01-02T00:00:00Z' });
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID, SECOND_ID], DATE);
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.complete, false);
  assert.equal(report.results[0].status, 'restored_with_different_date');
  assert.equal(report.results[0].actual_unlocked_at, '2026-01-02T00:00:00Z');
  assert.equal(report.results[1].status, 'not_attempted');
});

test('newly earned achievements are skipped by the final read before a write', async () => {
  const f = fixture();
  const queue = await f.service.createQueue(GAME_ID, [ACHIEVEMENT_ID], DATE);
  f.setHook(url => {
    if (url.hostname === 'auth.gog.com') f.achievements[0].date_unlocked = '2026-01-02T00:00:00Z';
  });
  const report = await f.service.applyQueue(queue, { dryRun: false });
  assert.equal(report.results[0].status, 'skipped_already_unlocked');
  assert.equal(f.writes.length, 0);
});

test('expired account tokens are refreshed into the vault without returning secrets', async () => {
  const f = fixture();
  f.vault.value.expires_at = 0;
  const games = await f.service.listGames();
  assert.equal(f.vault.saved.length, 1);
  assert.ok(!JSON.stringify(games).includes('fake-refreshed-token'));
});

test('a redirected credential request cannot disclose URLs or tokens', async () => {
  const f = fixture();
  f.api.fetch = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    throw new Error('Credential-bearing URL should not be exposed');
  };
  await assert.rejects(f.api.refresh('secret-token'), error => error.code === 'NETWORK_ERROR' && !error.message.includes('secret-token'));
});

test('an actual HTTP request is aborted within the configured timeout', async t => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const localURL = `http://127.0.0.1:${server.address().port}`;
  const api = new GogAPI({ timeoutMs: 50, fetchImpl: (_url, init) => fetch(localURL, init) });
  const started = Date.now();
  await assert.rejects(api.request('https://auth.gog.com/token?refresh_token=secret'),
    error => error.code === 'NETWORK_ERROR' && !error.message.includes('secret'));
  assert.ok(Date.now() - started < 2000);
});

test('login accepts only a GOG redirect and never returns credentials', async () => {
  const f = fixture();
  await assert.rejects(f.service.finishLogin('https://attacker.example/on_login_success?code=test'), error => error.code === 'INVALID_LOGIN_CODE');
  assert.equal(f.calls.length, 0);
  const result = await f.service.finishLogin('https://embed.gog.com/on_login_success?origin=client&code=test-login-code');
  assert.equal(result.authenticated, true);
  assert.ok(!JSON.stringify(result).includes('fake-refreshed-token'));
  const trailing = await f.service.finishLogin('https://embed.gog.com/on_login_success/?origin=client&code=test-login-code');
  assert.equal(trailing.authenticated, true);
});
