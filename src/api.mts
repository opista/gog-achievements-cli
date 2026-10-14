import type {
  Session,
  Game,
  Achievement,
  LibraryGame,
  FetchImpl,
  LoginOptions,
  SignalOptions,
} from './types.mjs';
import { fields, requiredFields, isArray } from './validation.mjs';
import { VERSION } from './version.mjs';
import { GogError, requireValue } from './errors.mjs';
import { id, parseJSON, timestamp } from './data.mjs';

// Public Galaxy application parameters, also used by Heroic/gogdl.
const GALAXY_CLIENT_ID = '46899977096215655';
const GALAXY_CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';
export const LOGIN_REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';
export function buildLoginURL({ redirectURI = LOGIN_REDIRECT, state }: LoginOptions = {}) {
  return `https://auth.gog.com/auth?${new URLSearchParams({
    client_id: GALAXY_CLIENT_ID,
    redirect_uri: redirectURI,
    response_type: 'code',
    layout: 'client2',
    ...(state ? { state } : {}),
  })}`;
}
export const LOGIN_URL = buildLoginURL();

export class GogAPI {
  fetch: FetchImpl;
  timeoutMs: number;
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
  }: { fetchImpl?: FetchImpl; timeoutMs?: number } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(
    url: string,
    {
      token,
      body,
      empty = false,
      signal,
    }: SignalOptions & { token?: string | undefined; body?: unknown; empty?: boolean } = {},
  ): Promise<unknown> {
    let response;
    try {
      response = await this.fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
          : AbortSignal.timeout(this.timeoutMs),
        headers: {
          Accept: 'application/json',
          'User-Agent': `gog-achievements-cli/${VERSION}`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GogError(
          response.status === 401 ? 'AUTH_REJECTED' : 'API_REJECTED',
          response.status === 401
            ? 'GOG rejected the login. Sign in again.'
            : 'The service rejected the request.',
          response.status === 401 ? 3 : 4,
          { status: response.status },
        );
      }
      if (empty) {
        await response.body?.cancel();
        return null;
      }
      requireValue(response.body, 'INVALID_RESPONSE', 'The service returned an empty response.', 4);
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new GogError('INVALID_RESPONSE', 'The service response exceeds 2 MB.');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return parseJSON(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new GogError('INVALID_RESPONSE', 'The service did not return valid JSON.');
      }
    } catch (error) {
      if (error instanceof GogError) throw error;
      throw new GogError(
        'NETWORK_ERROR',
        body === undefined
          ? 'The request failed or timed out.'
          : 'The write request failed or timed out. Read the achievement state before retrying.',
      );
    }
  }

  async authorize(
    parameters: Record<string, string>,
    { signal }: SignalOptions = {},
  ): Promise<Session> {
    const url = new URL('https://auth.gog.com/token');
    url.search = new URLSearchParams({
      client_id: GALAXY_CLIENT_ID,
      client_secret: GALAXY_CLIENT_SECRET,
      ...parameters,
    }).toString();
    const data = fields(await this.request(url.href, { signal }));
    requireValue(
      typeof data?.access_token === 'string' &&
        data.access_token &&
        typeof data.refresh_token === 'string' &&
        data.refresh_token &&
        Number.isFinite(Number(data.expires_in)) &&
        Number(data.expires_in) > 0,
      'INVALID_RESPONSE',
      'GOG returned incomplete login data.',
      4,
    );
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: id(data.user_id, 'User ID'),
      expires_at: Date.now() + Number(data.expires_in) * 1000,
    };
  }

  exchangeCode(code: string, redirectURI = LOGIN_REDIRECT, { signal }: SignalOptions = {}) {
    return this.authorize(
      { grant_type: 'authorization_code', redirect_uri: redirectURI, code },
      { signal },
    );
  }

  refresh(refreshToken: string, game?: Game) {
    return this.authorize({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(game
        ? { client_id: game.client_id, client_secret: game.client_secret, without_new_session: '1' }
        : {}),
    });
  }

  async ownedIDs(token: string) {
    const data = fields(await this.request('https://embed.gog.com/user/data/games', { token }));
    requireValue(
      isArray(data.owned),
      'INVALID_RESPONSE',
      'GOG returned an invalid owned-game list.',
      4,
    );
    return [...new Set(data.owned.map((value) => id(value, 'Game ID')))];
  }

  async games(token: string, search = ''): Promise<LibraryGame[]> {
    const games = new Map<string, LibraryGame>();
    let expectedPages;
    for (let page = 1; page <= 100; page++) {
      const url = new URL('https://embed.gog.com/account/getFilteredProducts');
      url.search = new URLSearchParams({
        mediaType: '1',
        sortBy: 'title',
        page: String(page),
        ...(search ? { search } : {}),
      }).toString();
      const data = fields(await this.request(url.href, { token }));
      const pages = Number(data?.totalPages);
      requireValue(
        isArray(data.products) && Number.isInteger(pages) && pages >= 0 && pages <= 100,
        'INVALID_RESPONSE',
        'GOG returned an invalid game-library page.',
        4,
      );
      expectedPages ??= pages;
      requireValue(
        expectedPages === pages && Number(data.page) === page,
        'INCOMPLETE_RESPONSE',
        'The game library changed during paging. Retry the read.',
        4,
      );
      for (const raw of data.products) {
        const game = requiredFields(raw);
        const gameID = id(game.id, 'Game ID');
        requireValue(
          typeof game.title === 'string' && !games.has(gameID),
          'INCOMPLETE_RESPONSE',
          'GOG returned a duplicate or invalid game.',
          4,
        );
        games.set(gameID, {
          id: gameID,
          title: game.title,
          slug: typeof game.slug === 'string' ? game.slug : null,
          image: typeof game.image === 'string' ? game.image : null,
          works_on: game.worksOn ?? null,
        });
      }
      if (page >= pages) return [...games.values()];
    }
    throw new GogError('INCOMPLETE_RESPONSE', 'The game library exceeds the paging limit.');
  }

  async game(gameID: unknown): Promise<Game> {
    const normalizedID = id(gameID, 'Game ID');
    const product = fields(
      await this.request(`https://www.gogdb.org/data/products/${normalizedID}/product.json`),
    );
    requireValue(
      isArray(product.builds),
      'INVALID_RESPONSE',
      'The game build list is not valid.',
      4,
    );
    const builds = product.builds
      .map(requiredFields)
      .filter(
        (build) => build.listed && typeof build.date_published === 'string' && build.date_published,
      )
      .sort((left, right) =>
        String(right.date_published).localeCompare(String(left.date_published)),
      );
    requireValue(
      builds.length,
      'NO_GALAXY_BUILD',
      'No published Galaxy build was found for this game.',
      4,
    );
    const buildID = id(builds[0]!.id, 'Build ID');
    const build = fields(
      await this.request(
        `https://www.gogdb.org/data/products/${normalizedID}/builds/${buildID}.json`,
      ),
    );
    requireValue(
      typeof product.title === 'string' &&
        typeof build?.clientSecret === 'string' &&
        build.clientSecret,
      'INVALID_RESPONSE',
      'The game login metadata is not valid.',
      4,
    );
    return {
      id: normalizedID,
      title: product.title,
      client_id: id(build.clientId, 'Client ID'),
      client_secret: build.clientSecret,
    };
  }

  async achievements(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id'> & Partial<Pick<Session, 'access_token'>>,
  ): Promise<Achievement[]> {
    const items = new Map<string, Achievement>();
    let pageToken = '0';
    let expectedTotal;
    const visitedTokens = new Set();
    for (let page = 0; page < 50; page++) {
      const url = new URL(
        `https://gameplay.gog.com/clients/${id(game.client_id)}/users/${id(session.user_id)}/achievements`,
      );
      if (page) url.searchParams.set('page_token', pageToken);
      const data = fields(await this.request(url.href, { token: session.access_token }));
      requireValue(
        isArray(data.items),
        'INVALID_RESPONSE',
        'GOG returned an invalid achievement list.',
        4,
      );
      const total = data.total_count === undefined ? null : Number(data.total_count);
      requireValue(
        total === null || (Number.isInteger(total) && total >= 0),
        'INVALID_RESPONSE',
        'The achievement total is not valid.',
        4,
      );
      if (page === 0) expectedTotal = total;
      requireValue(
        total === expectedTotal,
        'INCOMPLETE_RESPONSE',
        'The achievement list changed during paging.',
        4,
      );
      for (const raw of data.items) {
        const item = requiredFields(raw);
        const achievementID = id(item.achievement_id, 'Achievement ID');
        requireValue(
          !items.has(achievementID) &&
            typeof item.name === 'string' &&
            typeof item.achievement_key === 'string' &&
            (item.date_unlocked === null ||
              (typeof item.date_unlocked === 'string' &&
                Number.isFinite(Date.parse(item.date_unlocked)))),
          'INVALID_RESPONSE',
          'GOG returned an invalid or duplicate achievement.',
          4,
        );
        const state =
          item.date_unlocked === null
            ? { unlocked: false as const, unlocked_at: null }
            : { unlocked: true as const, unlocked_at: item.date_unlocked };
        items.set(achievementID, {
          id: achievementID,
          key: item.achievement_key,
          name: item.name,
          description: typeof item.description === 'string' ? item.description : '',
          ...state,
          hidden: item.visible === false,
          image_locked: item.image_url_locked ?? null,
          image_unlocked: item.image_url_unlocked ?? null,
          rarity: item.rarity ?? null,
        });
      }
      if (total !== null && items.size === total) return [...items.values()];
      const next = data.next_page_token ?? data.page_token;
      if (total === null && (!next || next === '0')) return [...items.values()];
      requireValue(
        typeof next === 'string' &&
          next !== pageToken &&
          next !== '0' &&
          !visitedTokens.has(next) &&
          data.items.length,
        'INCOMPLETE_RESPONSE',
        'GOG returned only part of the achievement list.',
        4,
      );
      visitedTokens.add(next);
      pageToken = next;
    }
    throw new GogError('INCOMPLETE_RESPONSE', 'The achievement list exceeds the paging limit.');
  }

  async unlock(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id' | 'access_token'>,
    achievementID: string,
    unlockedAt: string,
  ) {
    const date = timestamp(unlockedAt).replace(/Z$/, '+0000');
    return this.request(
      `https://gameplay.gog.com/clients/${id(game.client_id)}/users/${id(session.user_id)}/achievements/${id(achievementID)}`,
      { token: session.access_token, body: { date_unlocked: date }, empty: true },
    );
  }
}
