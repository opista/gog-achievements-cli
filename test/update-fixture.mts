import { crc32, deflateRawSync } from 'node:zlib';
import type { UpdateCheck, UpdatePort } from '../src/application/update-ports.mjs';
import { selectRelease } from '../src/domain/updates.mjs';

export function releaseMetadata(version = '0.4.0', target = 'macos-arm64') {
  const archive = `gog-achievements-${version}-${target}.zip`;
  return {
    draft: false,
    prerelease: false,
    tag_name: `v${version}`,
    assets: [archive, `${archive}.sha256`].map((name) => ({ name, state: 'uploaded' })),
  };
}

export function updateStub(overrides: Partial<UpdatePort> = {}): UpdatePort {
  const data: UpdateCheck = {
    current_version: '0.3.0',
    latest_version: '0.3.0',
    update_available: false,
    release_url: 'https://github.com/opista/gog-achievements-cli/releases/tag/v0.3.0',
    can_update: true,
  };
  return {
    check: async () => data,
    install: async () => {
      throw new Error('Unexpected installation');
    },
    ...overrides,
  };
}

export interface ZipItem {
  name: string;
  bytes?: Buffer;
  mode?: number;
  method?: number;
  flags?: number;
  declaredSize?: number;
}

export function zipFixture(items: ZipItem[]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name);
    const data = item.bytes ?? Buffer.alloc(0);
    const method = item.method ?? 0;
    const bytes = method === 8 ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(item.flags ?? 0x800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(item.declaredSize ?? data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(
      ((item.mode ?? (item.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0,
      38,
    );
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + bytes.length;
  }
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50);
  footer.writeUInt16LE(items.length, 8);
  footer.writeUInt16LE(items.length, 10);
  footer.writeUInt32LE(Buffer.concat(central).length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, footer]);
}

export function packageFixture(platform = 'darwin', architecture = 'arm64', version = '0.4.0') {
  const target = `${platform === 'darwin' ? 'macos' : 'windows'}-${architecture}`;
  const release = selectRelease(releaseMetadata(version, target), platform, architecture);
  const root = release.archive.slice(0, -4);
  const executable = platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements';
  const files = new Map<string, Buffer>([
    [
      'build.json',
      Buffer.from(
        JSON.stringify({
          version,
          platform,
          architecture,
          layout: release.layout,
          runtime_included: true,
          native_helper_included: true,
        }),
      ),
    ],
    [executable, Buffer.from(`executable ${version}`)],
    ['README.md', Buffer.from(`readme ${version}`)],
    ['LICENSE', Buffer.from('license')],
    ['THIRD_PARTY_NOTICES.md', Buffer.from('notices')],
    ['licenses/NODE-LICENSE.txt', Buffer.from('node license')],
  ]);
  if (release.layout === 'native_launcher_with_private_runtime')
    for (const file of ['lib/node', 'lib/main.cjs', 'native/bin/gog-login'])
      files.set(file, Buffer.from(`${file} ${version}`));
  const items: ZipItem[] = [
    { name: `${root}/` },
    { name: `${root}/licenses/` },
    ...[...files].map(([name, bytes]) => ({
      name: `${root}/${name}`,
      bytes,
      mode: [executable, 'lib/node', 'native/bin/gog-login'].includes(name) ? 0o100755 : 0o100644,
    })),
  ];
  return { release, files, items, bytes: zipFixture(items) };
}
