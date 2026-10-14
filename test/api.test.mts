import { gogError } from './assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GogAPI } from '../src/api.mjs';
import { VERSION } from '../src/version.mjs';
import { fixture, GAME_ID, CLIENT_ID, USER_ID } from './fixture.mjs';

const apiReturning = (data: unknown, status = 200) =>
  new GogAPI({
    fetchImpl: async () =>
      new Response(typeof data === 'string' ? data : JSON.stringify(data), { status }),
  });

void test('API responses reject invalid JSON, empty bodies and incomplete token data', async () => {
  for (const api of [
    apiReturning('private-token malformed'),
    new GogAPI({ fetchImpl: async () => new Response(null) }),
    apiReturning({
      access_token: 'private-token',
      refresh_token: 'refresh',
      expires_in: 0,
      user_id: USER_ID,
    }),
  ]) {
    await assert.rejects(
      api.refresh('fixture-refresh'),
      (error) =>
        gogError(error).code === 'INVALID_RESPONSE' &&
        !gogError(error).message.includes('private-token'),
    );
  }
});

void test('rejected HTTP requests close their body and expose only status, not secrets', async () => {
  for (const status of [401, 403, 500]) {
    let cancelled = false;
    const api = new GogAPI({
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers['User-Agent'], `gog-achievements-cli/${VERSION}`);
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        );
      },
    });
    await assert.rejects(
      api.refresh('private-refresh'),
      (error) =>
        gogError(error).code === (status === 401 ? 'AUTH_REJECTED' : 'API_REJECTED') &&
        gogError(error).details!.status === status &&
        !gogError(error).message.includes('private-refresh'),
    );
    assert.equal(cancelled, true);
  }
});

void test('oversized responses are cancelled before JSON parsing', async () => {
  let cancelled = false;
  const api = new GogAPI({
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(2_000_001));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(
    api.request('https://fixture.invalid'),
    (error) => gogError(error).code === 'INVALID_RESPONSE',
  );
  assert.equal(cancelled, true);
});

void test('achievement pagination follows cursors and rejects missing or changing totals', async () => {
  const f = fixture();
  const game = { client_id: CLIENT_ID };
  const session = { user_id: USER_ID, access_token: 'fixture-access' };
  let pages: unknown[];
  f.setHook(() => new Response(JSON.stringify(pages.shift())));
  pages = [
    { items: [f.achievements[0]!], total_count: 2, next_page_token: 'next' },
    { items: [f.achievements[1]!], total_count: 2, next_page_token: '0' },
  ];
  assert.equal((await f.api.achievements(game, session)).length, 2);
  assert.equal(f.calls[1]!.url.searchParams.get('page_token'), 'next');
  for (const secondTotal of [1, 3]) {
    pages = [
      { items: [f.achievements[0]!], next_page_token: 'next' },
      { items: [f.achievements[1]!], total_count: secondTotal },
    ];
    await assert.rejects(
      f.api.achievements(game, session),
      (error) => gogError(error).code === 'INCOMPLETE_RESPONSE',
    );
  }
  pages = [
    { items: [f.achievements[0]!], next_page_token: 'next' },
    { items: [f.achievements[1]!], next_page_token: '0' },
  ];
  assert.equal((await f.api.achievements(game, session)).length, 2);
});

void test('invalid library, build and achievement data fail before any writes', async () => {
  const f = fixture();
  for (const [data, operation] of [
    [{ owned: 'wrong' }, () => f.api.ownedIDs('fixture-access')],
    [{ totalPages: -1, products: [] }, () => f.api.games('fixture-access')],
    [{ builds: [] }, () => f.api.game(GAME_ID)],
    [
      { items: [f.achievements[0]!, f.achievements[0]!], total_count: 2 },
      () => f.api.achievements({ client_id: CLIENT_ID }, { user_id: USER_ID }),
    ],
    [
      { items: [{ ...f.achievements[0]!, date_unlocked: 'wrong' }], total_count: 1 },
      () => f.api.achievements({ client_id: CLIENT_ID }, { user_id: USER_ID }),
    ],
  ] satisfies [unknown, () => Promise<unknown>][]) {
    f.setHook(() => new Response(JSON.stringify(data)));
    await assert.rejects(operation());
  }
  assert.equal(f.writes.length, 0);
});
