import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { CLIRelease } from '../../domain/updates.mjs';
import { fields, errorCode } from '../../domain/objects.mjs';
import { GogError, requireValue } from '../../domain/errors.mjs';
import { isPackaged } from '../native/assets.mjs';
import { extractUpdate, packageEntries, validatePackage } from './archive.mjs';

const execute = promisify(execFile);
export const SOURCE_UPDATE_INSTRUCTIONS =
  'Update this source or package manager installation with its original installation method.';
export const MANAGED_UPDATE_INSTRUCTIONS =
  'This CLI belongs to the desktop app. Update the desktop app instead.';
export interface Installation {
  directory?: string;
  instructions?: string;
}

export async function installation(
  release: Pick<CLIRelease, 'version' | 'platform' | 'architecture' | 'layout'>,
  {
    packaged = isPackaged(),
    executable = process.execPath,
  }: { packaged?: boolean; executable?: string } = {},
): Promise<Installation> {
  if (!packaged) return { instructions: SOURCE_UPDATE_INSTRUCTIONS };
  try {
    const executablePath = await realpath(executable);
    const directory =
      release.layout === 'native_launcher_with_private_runtime'
        ? dirname(dirname(executablePath))
        : dirname(executablePath);
    if (
      /\.app[\\/]|[\\/]resources[\\/]cli(?:[\\/](?:macos|windows)-(?:arm64|x64))?$/i.test(directory)
    )
      return { instructions: MANAGED_UPDATE_INSTRUCTIONS };
    const expected =
      release.layout === 'native_launcher_with_private_runtime'
        ? join(directory, 'lib', 'node')
        : join(
            directory,
            release.platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements',
          );
    requireValue(
      executablePath === expected,
      'SELF_UPDATE_UNSUPPORTED',
      'The executable was renamed or moved out of its release package.',
      7,
    );
    await validatePackage(directory, release);
    return { directory };
  } catch {
    return {
      instructions: 'Extract the complete standalone release package before using self update.',
    };
  }
}

type UpdateProcess = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    env: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string }>;

export async function verifyExecutable(
  directory: string,
  release: Pick<CLIRelease, 'version' | 'platform'>,
  run: UpdateProcess = execute,
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase()),
    ),
  );
  const result = await run(
    join(directory, release.platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements'),
    ['--help', '--json'],
    { cwd: directory, timeout: 10000, maxBuffer: 128000, windowsHide: true, env },
  );
  const output = fields(JSON.parse(result.stdout) as unknown);
  const data = fields(output.data);
  requireValue(
    output.ok === true && data.name === 'gog-achievements' && data.version === release.version,
    'UPDATE_VERIFICATION_FAILED',
    'The new executable did not confirm the expected version.',
    7,
  );
}

export function verifyChecksum(bytes: Buffer, checksum: Buffer, release: CLIRelease) {
  const expected = createHash('sha256').update(bytes).digest('hex');
  requireValue(
    checksum.toString('utf8').trim() === `${expected}  ${release.archive}`,
    'UPDATE_CHECKSUM_MISMATCH',
    'The update failed its SHA-256 check. The installed CLI was not changed.',
    4,
  );
}

export async function installPackage(
  directory: string,
  release: CLIRelease,
  prepare: (staging: string) => Promise<void>,
  {
    verify = verifyExecutable,
    move = rename,
  }: {
    verify?: (directory: string, release: CLIRelease) => Promise<void>;
    move?: typeof rename;
  } = {},
) {
  const lockPath = join(directory, '.gog-achievements-update.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch((error: unknown) => {
    throw new GogError(
      errorCode(error) === 'EEXIST' ? 'UPDATE_LOCKED' : 'UPDATE_INSTALL_FAILED',
      errorCode(error) === 'EEXIST'
        ? 'Another update is running, or an interrupted update needs recovery. See the update instructions.'
        : 'The CLI folder is not writable. Move the complete package to a writable folder and retry.',
      7,
    );
  });
  let staging: string | undefined;
  let backup: string | undefined;
  let retainBackup = false;
  let recoveryRequired = false;
  try {
    staging = await mkdtemp(join(directory, '.gog-achievements-update-'));
    await prepare(staging);
    await verify(staging, release);
    backup = await mkdtemp(join(directory, '.gog-achievements-backup-'));
    await lock.writeFile(JSON.stringify({ backup_directory: backup, version: release.version }));
    const changed: { name: string; previous: boolean; installed: boolean }[] = [];
    try {
      for (const name of packageEntries(release)) {
        // All paths are fixed, package-owned entries. User queues and other files stay in place.
        const previous = await lstat(join(directory, name)).catch((error: unknown) => {
          if (errorCode(error) !== 'ENOENT') throw error;
          return undefined;
        });
        requireValue(
          !previous?.isSymbolicLink(),
          'UPDATE_INSTALL_FAILED',
          'A tool file is a symbolic link. Restore the original package before updating.',
          7,
        );
        const step = { name, previous: false, installed: false };
        changed.push(step);
        if (previous) {
          await move(join(directory, name), join(backup, name));
          step.previous = true;
        }
        await move(join(staging, name), join(directory, name));
        step.installed = true;
      }
      await verify(directory, release);
    } catch (error) {
      try {
        for (const step of changed.reverse()) {
          if (step.installed)
            await rm(join(directory, step.name), { recursive: true, force: true });
          if (step.previous) await move(join(backup, step.name), join(directory, step.name));
        }
      } catch {
        retainBackup = true;
        recoveryRequired = true;
        throw new GogError(
          'UPDATE_RECOVERY_REQUIRED',
          'The update could not restore all tool files. Restore them from the backup directory.',
          7,
          { backup_directory: backup },
        );
      }
      throw error;
    }
    retainBackup = true;
    return backup;
  } catch (error) {
    if (error instanceof GogError) throw error;
    throw new GogError(
      'UPDATE_INSTALL_FAILED',
      'The update failed. The previous CLI files were restored.',
      7,
    );
  } finally {
    await lock.close();
    if (staging) await rm(staging, { recursive: true, force: true });
    if (backup && !retainBackup) await rm(backup, { recursive: true, force: true });
    if (!recoveryRequired) await rm(lockPath, { force: true });
  }
}

export async function preparePackage(
  bytes: Buffer,
  checksum: Buffer,
  staging: string,
  release: CLIRelease,
) {
  verifyChecksum(bytes, checksum, release);
  await extractUpdate(bytes, staging, release);
}
