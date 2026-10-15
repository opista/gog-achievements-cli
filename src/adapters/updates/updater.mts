import type { FetchImpl } from '../../application/ports.mjs';
import type { UpdateCheck, UpdatePort, UpdateResult } from '../../application/update-ports.mjs';
import type { CLIRelease } from '../../domain/updates.mjs';
import { newerVersion } from '../../domain/updates.mjs';
import { requireValue } from '../../domain/errors.mjs';
import { VERSION } from '../../version.mjs';
import { ARCHIVE_LIMIT, downloadBytes, latestRelease } from './release.mjs';
import { installation, installPackage, preparePackage } from './install.mjs';
import { validatePackage } from './archive.mjs';

export interface UpdaterOptions {
  version?: string;
  platform?: string;
  architecture?: string;
  request?: FetchImpl;
  packaged?: boolean;
  executable?: string;
  verify?: (directory: string, release: CLIRelease) => Promise<void>;
}

export class CLIUpdater implements UpdatePort {
  private release: CLIRelease | undefined;
  private checked: UpdateCheck | undefined;
  constructor(private readonly options: UpdaterOptions = {}) {}

  async check({ timeoutMs = 10000 }: { timeoutMs?: number } = {}): Promise<UpdateCheck> {
    this.release = undefined;
    this.checked = undefined;
    const {
      version = VERSION,
      platform = process.platform,
      architecture = process.arch,
    } = this.options;
    const release = await latestRelease(platform, architecture, {
      ...(this.options.request && { request: this.options.request }),
      timeoutMs,
    });
    const installed = await installation({ ...release, version }, this.options);
    this.release = release;
    this.checked = {
      current_version: version,
      latest_version: release.version,
      update_available: newerVersion(version, release.version),
      release_url: release.release_url,
      can_update: !!installed.directory,
      ...(installed.instructions ? { instructions: installed.instructions } : {}),
    };
    return this.checked;
  }

  async install(): Promise<UpdateResult> {
    const { release, checked } = this;
    requireValue(
      release && checked,
      'UPDATE_CHECK_REQUIRED',
      'Check for updates before installing.',
      7,
    );
    if (!checked.update_available) return { ...checked, updated: false };
    const installed = await installation(
      { ...release, version: checked.current_version },
      this.options,
    );
    requireValue(
      installed.directory,
      'SELF_UPDATE_UNSUPPORTED',
      installed.instructions ?? 'This installation cannot update itself.',
      7,
    );
    const directory = installed.directory;
    const backup = await installPackage(
      directory,
      release,
      async (staging) => {
        // Recheck under the update lock in case another update finished after confirmation.
        await validatePackage(directory, { ...release, version: checked.current_version });
        const request = this.options.request ? { request: this.options.request } : {};
        const checksum = await downloadBytes(release.checksum_url, 256, request);
        const bytes = await downloadBytes(release.archive_url, ARCHIVE_LIMIT, request);
        await preparePackage(bytes, checksum, staging, release);
      },
      this.options.verify ? { verify: this.options.verify } : {},
    );
    this.release = undefined;
    this.checked = undefined;
    return {
      ...checked,
      current_version: release.version,
      update_available: false,
      updated: true,
      previous_version: checked.current_version,
      backup_directory: backup,
    };
  }
}
