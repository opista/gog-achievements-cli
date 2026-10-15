import assert from 'node:assert/strict';
import type { Session, FetchOptions } from '../src/types.mjs';
import { fields } from '../src/validation.mjs';
import { GogAPI } from '../src/api.mjs';
import { GogAchievements } from '../src/service.mjs';

export const GAME_ID = '1423049311';
export const USER_ID = '48628349957132247';
export const CLIENT_ID = '14370605671234567';
export const BUILD_ID = '1007860867957265845';
export const ACHIEVEMENT_ID = '48497841707623054';
export const SECOND_ID = '48225958150521213';
export const DATE = '2026-01-01T12:34:56Z';

export class MemoryVault {
  storage?: string;
  value: Session | null;
  saved: Session[] = [];
  constructor(
    session: Session | null = {
      user_id: USER_ID,
      access_token: 'fake-account-access',
      refresh_token: 'fake-account-refresh',
      expires_at: Date.now() + 3600_000,
    },
  ) {
    this.value = session;
    this.saved = [];
  }
  async get() {
    return this.value;
  }
  async set(value: Session) {
    this.value = value;
    this.saved.push(value);
  }
  async remove() {
    this.value = null;
  }
}

export function fixture(
  options: {
    libraryPages?: number;
    authUser?: string;
    owned?: unknown;
    rejectWrites?: boolean;
    clampDate?: string;
    loseWriteResponse?: boolean;
  } = {},
) {
  const calls: { url: URL; init: FetchOptions }[] = [];
  const writes: {
    achievement_id: string;
    body: { date_unlocked: string | null };
    authorization: string | undefined;
  }[] = [];
  const achievements: {
    achievement_id: string;
    achievement_key: string;
    name: string;
    description: string;
    date_unlocked: string | null;
    visible: boolean;
  }[] = [
    {
      achievement_id: ACHIEVEMENT_ID,
      achievement_key: 'ACH_FIRST',
      name: 'Earned but missing',
      description: 'First description',
      date_unlocked: null,
      visible: true,
    },
    {
      achievement_id: SECOND_ID,
      achievement_key: 'ACH_SECOND',
      name: 'Second achievement',
      description: 'Second description',
      date_unlocked: null,
      visible: true,
    },
  ];
  let libraryPages = options.libraryPages ?? 1;
  let readCount = 0;
  let total = 2;
  let responseHook:
    | ((url: URL, init: FetchOptions) => Response | void | Promise<Response | void>)
    | null
    | undefined;
  const fetchImpl = async (url: string, init: FetchOptions) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    if (responseHook) {
      const override = await responseHook(parsed, init);
      if (override) return override;
    }
    let data: unknown;
    if (parsed.hostname === 'auth.gog.com') {
      data = {
        user_id: options.authUser ?? USER_ID,
        access_token: 'fake-scoped-access',
        refresh_token: 'fake-refreshed-token',
        expires_in: 3600,
      };
    } else if (parsed.pathname === '/user/data/games') {
      data = { owned: options.owned ?? [GAME_ID] };
    } else if (parsed.pathname === '/account/getFilteredProducts') {
      const page = Number(parsed.searchParams.get('page'));
      data = {
        page,
        totalPages: libraryPages,
        totalProducts: libraryPages,
        products: [
          {
            id: page === 1 ? GAME_ID : '1207658691',
            title: page === 1 ? 'Cyberpunk 2077' : 'Another game',
            slug: 'test-game',
            worksOn: { Mac: true },
          },
        ],
      };
    } else if (parsed.pathname.endsWith('/product.json')) {
      // Raw numeric IDs deliberately exceed Number.MAX_SAFE_INTEGER.
      return new Response(
        `{"id":${GAME_ID},"title":"Cyberpunk 2077","builds":[{"id":${BUILD_ID},"listed":true,"date_published":"2026-01-01T00:00:00Z"}]}`,
      );
    } else if (parsed.pathname.includes('/builds/')) {
      if (!parsed.pathname.endsWith(`/${BUILD_ID}.json`)) throw new Error('Build ID was rounded');
      return new Response(`{"clientId":${CLIENT_ID},"clientSecret":"fake-game-client-secret"}`);
    } else if (parsed.pathname.endsWith('/achievements') && init.method === 'GET') {
      readCount++;
      data = { items: achievements, total_count: total, limit: 1000, page_token: '0' };
    } else if (parsed.pathname.includes('/achievements/') && init.method === 'POST') {
      const achievementID = parsed.pathname.split('/').at(-1)!;
      assert.equal(typeof init.body, 'string');
      const body = fields(JSON.parse(init.body as string));
      assert.ok(body.date_unlocked === null || typeof body.date_unlocked === 'string');
      const writeBody = { date_unlocked: body.date_unlocked };
      writes.push({
        achievement_id: achievementID,
        body: writeBody,
        authorization: init.headers.Authorization,
      });
      if (options.rejectWrites)
        return new Response('DO NOT ECHO SECRET: fake-token', { status: 403 });
      const achievement = achievements.find((item) => item.achievement_id === achievementID);
      assert.ok(achievement);
      achievement.date_unlocked = options.clampDate ?? writeBody.date_unlocked;
      if (options.loseWriteResponse)
        throw new Error(`Network error with credential URL ${url}?token=fake-scoped-access`);
      return new Response(null, { status: 204 });
    } else throw new Error(`Unexpected fixture request ${parsed.href}`);
    return new Response(JSON.stringify(data));
  };
  const api = new GogAPI({ fetchImpl, timeoutMs: 1000 });
  const vault = new MemoryVault();
  const service = new GogAchievements({ api, vault, wait: async () => {} });
  return {
    api,
    vault,
    service,
    calls,
    writes,
    achievements,
    get readCount() {
      return readCount;
    },
    setTotal(value: number) {
      total = value;
    },
    setHook(value: typeof responseHook) {
      responseHook = value;
    },
    setLibraryPages(value: number) {
      libraryPages = value;
    },
  };
}
