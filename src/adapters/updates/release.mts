import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import type { FetchImpl, SignalOptions } from '../../application/ports.mjs';
import { GogError, requireValue } from '../../domain/errors.mjs';
import { UPDATE_REPOSITORY, selectRelease } from '../../domain/updates.mjs';

const API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
export const ARCHIVE_LIMIT = 256 * 1024 * 1024;

interface DownloadOptions extends SignalOptions {
  request?: FetchImpl;
  timeoutMs?: number;
}

// Metadata is small and buffered. Release archives have a separate transfer budget.
export const ARCHIVE_TIMEOUT_MS = 5 * 60_000;
export const ARCHIVE_INACTIVITY_TIMEOUT_MS = 30_000;

function downloadError(error: unknown) {
  return error instanceof GogError
    ? error
    : new GogError('UPDATE_REQUEST_FAILED', 'Could not download update data. Try again later.', 4);
}

async function responseBody(url: string, limit: number, request: FetchImpl, signal: AbortSignal) {
  const api = new URL(url).hostname === 'api.github.com';
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
    return response.body;
  }
  throw downloadError(undefined);
}

function checkSize(size: number, limit: number) {
  requireValue(size <= limit, 'UPDATE_SIZE_LIMIT', 'Update data exceeds the download limit.', 4);
}

export async function downloadBytes(
  url: string,
  limit: number,
  { request = fetch, timeoutMs = 30000, signal }: DownloadOptions = {},
) {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const body = await responseBody(
      url,
      limit,
      request,
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    );
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        checkSize(size, limit);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  } catch (error) {
    throw downloadError(error);
  }
}

export async function downloadArchive(
  url: string,
  path: string,
  {
    request = fetch,
    timeoutMs = ARCHIVE_TIMEOUT_MS,
    inactivityTimeoutMs = ARCHIVE_INACTIVITY_TIMEOUT_MS,
    signal,
    limit = ARCHIVE_LIMIT,
  }: DownloadOptions & { inactivityTimeoutMs?: number; limit?: number } = {},
): Promise<string> {
  const idle = new AbortController();
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([idle.signal, timeout, ...(signal ? [signal] : [])]);
  let timer: ReturnType<typeof setTimeout>;
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), inactivityTimeoutMs);
    timer.unref();
  };
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let complete = false;
  progress();
  try {
    const body = await responseBody(url, limit, request, combined);
    const reader = body.getReader();
    try {
      file = await open(path, 'wx', 0o600);
      const hash = createHash('sha256');
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        combined.throwIfAborted();
        size += part.value.byteLength;
        checkSize(size, limit);
        progress();
        hash.update(part.value);
        await file.writeFile(part.value);
      }
      combined.throwIfAborted();
      await file.close();
      complete = true;
      return hash.digest('hex');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    throw downloadError(error);
  } finally {
    clearTimeout(timer!);
    if (file && !complete) {
      await file.close().catch(() => {});
      await rm(path, { force: true }).catch(() => {});
    }
  }
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
