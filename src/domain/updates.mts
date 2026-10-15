import { fields, isArray } from './objects.mjs';
import { requireValue } from './errors.mjs';

export const UPDATE_REPOSITORY = 'opista/gog-achievements-cli';
export const RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;

export interface CLIRelease {
  version: string;
  platform: string;
  architecture: string;
  layout: 'single_executable' | 'native_launcher_with_private_runtime';
  archive: string;
  archive_url: string;
  checksum_url: string;
  release_url: string;
}

function versionParts(value: string) {
  requireValue(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value),
    'INVALID_UPDATE_RELEASE',
    'The release version is invalid.',
    4,
  );
  const parts = value.split(/[+-]/)[0]!.split('.').map(Number);
  requireValue(
    parts.every(Number.isSafeInteger),
    'INVALID_UPDATE_RELEASE',
    'The release version is invalid.',
    4,
  );
  return parts;
}

export function newerVersion(installed: string, latest: string) {
  const current = versionParts(installed);
  const next = versionParts(latest);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index]! > current[index]!;
  }
  return installed.split('+')[0]!.includes('-') && !latest.split('+')[0]!.includes('-');
}

export function selectRelease(value: unknown, platform: string, architecture: string): CLIRelease {
  requireValue(
    ['darwin', 'win32'].includes(platform) && ['arm64', 'x64'].includes(architecture),
    'UNSUPPORTED_PLATFORM',
    'Updates support macOS and Windows on arm64 or x64.',
    7,
  );
  const data = fields(value);
  requireValue(
    data.draft === false &&
      data.prerelease === false &&
      typeof data.tag_name === 'string' &&
      /^v\d+\.\d+\.\d+$/.test(data.tag_name),
    'INVALID_UPDATE_RELEASE',
    'GitHub did not return a stable published release.',
    4,
  );
  const version = data.tag_name.slice(1);
  versionParts(version);
  const target = `${platform === 'darwin' ? 'macos' : 'windows'}-${architecture}`;
  const archive = `gog-achievements-${version}-${target}.zip`;
  requireValue(isArray(data.assets), 'INVALID_UPDATE_RELEASE', 'The release has no assets.', 4);
  for (const name of [archive, `${archive}.sha256`]) {
    const matches = data.assets.filter((asset) => fields(asset).name === name);
    requireValue(
      matches.length === 1 && fields(matches[0]).state === 'uploaded',
      'INVALID_UPDATE_RELEASE',
      'The release is missing a complete package or checksum for this computer.',
      4,
    );
  }
  const archiveURL = `${RELEASES_URL}/download/${data.tag_name}/${archive}`;
  return {
    version,
    platform,
    architecture,
    archive,
    layout:
      platform === 'darwin' && architecture === 'x64'
        ? 'native_launcher_with_private_runtime'
        : 'single_executable',
    archive_url: archiveURL,
    checksum_url: `${archiveURL}.sha256`,
    release_url: `${RELEASES_URL}/tag/${data.tag_name}`,
  };
}
