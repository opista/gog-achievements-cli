import { isSea, getAsset } from 'node:sea';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  renameSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { distributionRuntime, sourceHelperPath } from './runtime-paths.mjs';
import { GogError } from './errors.mjs';

export function isPackaged() {
  return isSea() || distributionRuntime();
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  if (process.platform !== 'win32') chmodSync(path, 0o700);
}

// A stable, content-based path preserves Keychain identity. Check bytes on every
// lookup so a replaced or corrupt cached helper cannot be executed.
export function cacheNativeHelper(bytes: Uint8Array, root: string, filename: string) {
  try {
    privateDirectory(root);
    const checksum = digest(bytes);
    const directory = join(root, checksum);
    privateDirectory(directory);
    const path = join(directory, filename);
    let valid = false;
    try {
      const stat = lstatSync(path);
      valid = stat.isFile() && !stat.isSymbolicLink() && digest(readFileSync(path)) === checksum;
    } catch {}
    if (!valid) {
      // Windows cannot replace a read-only cached executable with rename.
      if (process.platform === 'win32') rmSync(path, { force: true });
      const temporary = join(directory, `${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o500 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    chmodSync(path, 0o500);
    return path;
  } catch {
    throw new GogError(
      'BUNDLED_ASSET_FAILED',
      'Cannot load a bundled native component. Download a fresh executable and retry.',
      7,
    );
  }
}

export function nativeHelperPath(platform: string = process.platform) {
  if (!['darwin', 'win32'].includes(platform))
    throw new GogError('UNSUPPORTED_PLATFORM', 'This tool supports macOS and Windows.', 7);
  const name = platform === 'win32' ? 'gog-login.exe' : 'gog-login';
  if (!isSea()) return sourceHelperPath(name);
  const root =
    platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'gog-achievements-cli')
      : join(
          process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
          'GogAchievementsCli',
          'components',
        );
  return cacheNativeHelper(Buffer.from(getAsset('login-helper')), root, name);
}
