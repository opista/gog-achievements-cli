import { fromBufferPromise } from 'yauzl';
import type { Entry } from 'yauzl';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fields } from '../../domain/objects.mjs';
import { GogError, requireValue } from '../../domain/errors.mjs';
import type { CLIRelease } from '../../domain/updates.mjs';

export function packageEntries(release: Pick<CLIRelease, 'platform' | 'layout'>) {
  return [
    release.platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements',
    'build.json',
    'README.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses',
    ...(release.layout === 'native_launcher_with_private_runtime' ? ['lib', 'native'] : []),
  ];
}

function safeEntry(entry: Entry, release: CLIRelease, seen: Map<string, boolean>) {
  const name = new TextDecoder('utf-8', { fatal: true }).decode(entry.fileNameRaw);
  const directory = name.endsWith('/');
  const parts = name.split('/');
  if (directory) parts.pop();
  requireValue(
    !/[\\:\x00-\x1f\x7f-\x9f]/.test(name) &&
      parts.every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ) &&
      parts.shift() === release.archive.slice(0, -4),
    'INVALID_UPDATE_ARCHIVE',
    'The update archive contains an unsafe path.',
    4,
  );
  const path = parts.join('/');
  // Older ditto archives can include AppleDouble metadata beside tool files.
  // Validate these paths and entry types, but never extract their contents.
  const metadata = !directory && !!parts.at(-1)?.startsWith('._');
  const top = metadata && parts.length === 1 ? parts[0]!.slice(2) : parts[0];
  requireValue(
    (!path && directory) || packageEntries(release).includes(top!),
    'INVALID_UPDATE_ARCHIVE',
    'The update archive contains an unexpected file.',
    4,
  );
  const key = path.normalize('NFC').toLowerCase();
  requireValue(
    !seen.has(key),
    'INVALID_UPDATE_ARCHIVE',
    'The update archive has duplicate paths.',
    4,
  );
  seen.set(key, directory);
  const mode = entry.externalFileAttributes >>> 16;
  const type = mode & 0xf000;
  requireValue(
    (!type || type === (directory ? 0x4000 : 0x8000)) &&
      !(entry.generalPurposeBitFlag & 1) &&
      [0, 8].includes(entry.compressionMethod) &&
      entry.uncompressedSize <= 256 * 1024 * 1024 &&
      entry.uncompressedSize <= Math.max(1, entry.compressedSize) * 1000 &&
      (!directory || entry.uncompressedSize === 0),
    'INVALID_UPDATE_ARCHIVE',
    'The update archive contains an unsupported or oversized entry.',
    4,
  );
  return { entry, path, directory, mode, metadata };
}

export async function validatePackage(
  directory: string,
  release: Pick<CLIRelease, 'version' | 'platform' | 'architecture' | 'layout'>,
) {
  const stat = await lstat(join(directory, 'build.json'));
  requireValue(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536,
    'INVALID_UPDATE_PACKAGE',
    'The update build metadata is invalid.',
    4,
  );
  const metadata = fields(
    JSON.parse(await readFile(join(directory, 'build.json'), 'utf8')) as unknown,
  );
  requireValue(
    ['version', 'platform', 'architecture', 'layout'].every(
      (key) => metadata[key] === release[key as keyof typeof release],
    ) &&
      metadata.runtime_included === true &&
      metadata.native_helper_included === true,
    'INVALID_UPDATE_PACKAGE',
    'The update package does not match this release and computer.',
    4,
  );
  const executable = release.platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements';
  const executables = [
    executable,
    ...(release.layout === 'native_launcher_with_private_runtime'
      ? ['lib/node', 'native/bin/gog-login']
      : []),
  ];
  for (const path of [
    executable,
    'README.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses/NODE-LICENSE.txt',
    ...(release.layout === 'native_launcher_with_private_runtime'
      ? ['lib/node', 'lib/main.cjs', 'native/bin/gog-login']
      : []),
  ]) {
    const file = await lstat(join(directory, path));
    requireValue(
      file.isFile() &&
        !file.isSymbolicLink() &&
        file.size > 0 &&
        (process.platform === 'win32' ||
          release.platform !== 'darwin' ||
          !executables.includes(path) ||
          !!(file.mode & 0o111)),
      'INVALID_UPDATE_PACKAGE',
      'The update is missing a required file or executable permission.',
      4,
    );
  }
}

export async function extractUpdate(bytes: Buffer, directory: string, release: CLIRelease) {
  try {
    const zip = await fromBufferPromise(bytes, {
      lazyEntries: true,
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    try {
      requireValue(
        zip.entryCount <= 1024,
        'INVALID_UPDATE_ARCHIVE',
        'The update has too many files.',
        4,
      );
      const seen = new Map<string, boolean>();
      const entries = [];
      let size = 0;
      for await (const entry of zip.eachEntry()) {
        size += entry.uncompressedSize;
        requireValue(
          size <= 512 * 1024 * 1024,
          'INVALID_UPDATE_ARCHIVE',
          'The extracted update exceeds the size limit.',
          4,
        );
        entries.push(safeEntry(entry, release, seen));
      }
      for (const item of entries) {
        const parts = item.path.split('/');
        parts.pop();
        while (parts.length) {
          requireValue(
            seen.get(parts.join('/').normalize('NFC').toLowerCase()) !== false,
            'INVALID_UPDATE_ARCHIVE',
            'The update has a file and directory conflict.',
            4,
          );
          parts.pop();
        }
      }
      for (const item of entries) {
        if (!item.path || item.metadata) continue;
        const path = join(directory, item.path);
        if (item.directory) await mkdir(path, { recursive: true, mode: 0o755 });
        else {
          await mkdir(dirname(path), { recursive: true, mode: 0o755 });
          await pipeline(
            await zip.openReadStreamPromise(item.entry),
            createWriteStream(path, { flags: 'wx', mode: 0o644 }),
          );
          if (release.platform === 'darwin' && item.mode & 0o111) await chmod(path, 0o755);
        }
      }
      await validatePackage(directory, release);
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error instanceof GogError) throw error;
    throw new GogError('INVALID_UPDATE_ARCHIVE', 'The update archive is invalid or incomplete.', 4);
  }
}
