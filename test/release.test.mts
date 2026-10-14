import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRelease } from '../scripts/verify-release.mjs';

async function archives(t: import('node:test').TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'gog-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = ['macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64'].map(
    (target) => `gog-achievements-0.2.0-${target}.zip`,
  );
  for (const name of names) {
    const bytes = Buffer.from(`fixture archive for ${name}`);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, name), bytes);
    await writeFile(join(directory, `${name}.sha256`), `${checksum}  ${name}\n`);
  }
  return { directory, version: '0.2.0', names };
}

void test('release verification requires the matching version, complete target set and exact checksums', async (t) => {
  const options = await archives(t);
  assert.deepEqual(await verifyRelease('v0.2.0', options), options.names);
  await assert.rejects(verifyRelease('v0.3.0', options), /must match/);
  await writeFile(join(options.directory, options.names[0]!), 'tampered archive');
  await assert.rejects(verifyRelease('v0.2.0', options), /checksum/);
});

void test('release verification blocks missing targets and unexpected files', async (t) => {
  const options = await archives(t);
  const extra = join(options.directory, 'unexpected.zip');
  await writeFile(extra, 'extra archive');
  await assert.rejects(verifyRelease('v0.2.0', options), /all four/);
  await rm(extra);
  await rm(join(options.directory, options.names[0]!));
  await assert.rejects(verifyRelease('v0.2.0', options), /all four/);
});
