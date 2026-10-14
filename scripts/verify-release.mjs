import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_TARGETS } from './build-targets.mjs';

export async function verifyRelease(tag, { directory = 'dist', version } = {}) {
  version ??= JSON.parse(await readFile('package.json', 'utf8')).version;
  if (tag !== `v${version}`) throw new Error('The release tag must match package.json version.');
  const archives = BUILD_TARGETS.map(({ name }) => `gog-achievements-${version}-${name}.zip`);
  const expected = archives.flatMap((name) => [name, `${name}.sha256`]).sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('The release must contain all four archives and their checksums.');
  for (const name of archives) {
    const checksum = createHash('sha256')
      .update(await readFile(join(directory, name)))
      .digest('hex');
    const stored = await readFile(join(directory, `${name}.sha256`), 'utf8');
    if (stored !== `${checksum}  ${name}\n`)
      throw new Error('A release archive does not match its checksum.');
  }
  return archives;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await verifyRelease(process.argv[2]);
  process.stdout.write('Release version, all targets and SHA-256 checksums verified.\n');
}
