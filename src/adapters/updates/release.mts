import type { FetchImpl } from '../../application/ports.mjs';
import { GogError, requireValue } from '../../domain/errors.mjs';
import { UPDATE_REPOSITORY, selectRelease } from '../../domain/updates.mjs';

const API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
export const ARCHIVE_LIMIT = 256 * 1024 * 1024;

export async function downloadBytes(
  url: string,
  limit: number,
  { request = fetch, timeoutMs = 30000 }: { request?: FetchImpl; timeoutMs?: number } = {},
) {
  const signal = AbortSignal.timeout(timeoutMs);
  const api = new URL(url).hostname === 'api.github.com';
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = new URL(url);
      requireValue(
        target.protocol === 'https:' &&
          !target.username &&
          !target.password &&
          !target.port &&
          (api
            ? target.hostname === 'api.github.com'
            : [
                'github.com',
                'release-assets.githubusercontent.com',
                'objects.githubusercontent.com',
              ].includes(target.hostname)),
        'UNSAFE_UPDATE_URL',
        'The update download URL is not trusted.',
        4,
      );
      const response = await request(url, {
        redirect: 'manual',
        credentials: 'omit',
        signal,
        headers: {
          Accept: api ? 'application/vnd.github+json' : 'application/octet-stream',
          'User-Agent': 'gog-achievements-cli',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        requireValue(
          location && redirects < 5,
          'UPDATE_REQUEST_FAILED',
          'The update request has too many redirects.',
          4,
        );
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok || Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new GogError(
          'UPDATE_REQUEST_FAILED',
          'Could not download update data. Try again later.',
          4,
        );
      }
      requireValue(response.body, 'UPDATE_REQUEST_FAILED', 'The update response is empty.', 4);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          requireValue(
            size <= limit,
            'UPDATE_SIZE_LIMIT',
            'Update data exceeds the download limit.',
            4,
          );
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return Buffer.concat(chunks);
    }
  } catch (error) {
    if (error instanceof GogError) throw error;
    throw new GogError(
      'UPDATE_REQUEST_FAILED',
      'Could not download update data. Try again later.',
      4,
    );
  }
  throw new GogError(
    'UPDATE_REQUEST_FAILED',
    'Could not download update data. Try again later.',
    4,
  );
}

export async function latestRelease(
  platform: string,
  architecture: string,
  options: { request?: FetchImpl; timeoutMs?: number } = {},
) {
  const bytes = await downloadBytes(API_URL, 1024 * 1024, options);
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new GogError('INVALID_UPDATE_RELEASE', 'GitHub returned invalid release metadata.', 4);
  }
  return selectRelease(data, platform, architecture);
}
