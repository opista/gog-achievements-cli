import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withCompiled } from '../scripts/compile.mjs';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'gog-compiler-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['src', 'test', 'scripts', 'node_modules/typescript/bin'])
    await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, 'src/main.mts'), 'initial source');
  await writeFile(join(root, 'tsconfig.json'), '{}');
  await writeFile(join(root, 'node_modules/typescript/package.json'), '{"version":"fixture"}');
  await writeFile(
    join(root, 'node_modules/typescript/bin/tsc'),
    `const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync('compiler-runs', 'run\\n');
const source = fs.readFileSync('src/main.mts', 'utf8');
if (source === 'fail') process.exit(1);
const output = process.argv[process.argv.indexOf('--outDir') + 1];
fs.mkdirSync(path.join(output, 'src'), { recursive: true });
fs.writeFileSync(path.join(output, 'src/main.mjs'), source);
`,
  );
  return {
    root,
    source: join(root, 'src/main.mts'),
    emitted: join(root, '.build/typescript/src/main.mjs'),
    runs: async () =>
      (await readFile(join(root, 'compiler-runs'), 'utf8')).trim().split('\n').length,
  };
}

void test('compilation reuses unchanged input and verifies every emitted file', async (t) => {
  const f = await fixture(t);
  await withCompiled(() => {}, f);
  await withCompiled(() => {}, f);
  assert.equal(await f.runs(), 1);
  await writeFile(f.source, 'changed source');
  await withCompiled(() => {}, f);
  assert.equal(await f.runs(), 2);
  assert.equal(await readFile(f.emitted, 'utf8'), 'changed source');
  await writeFile(f.emitted, 'changed output');
  await withCompiled(() => {}, f);
  assert.equal(await f.runs(), 3);
  assert.equal(await readFile(f.emitted, 'utf8'), 'changed source');
  await rm(f.emitted);
  await withCompiled(() => {}, f);
  assert.equal(await f.runs(), 4);
});

void test('failed compilation preserves the last output and releases its lease', async (t) => {
  const f = await fixture(t);
  await withCompiled(() => {}, f);
  await writeFile(f.source, 'fail');
  await assert.rejects(
    withCompiled(() => {}, f),
    /TypeScript compilation failed/,
  );
  assert.equal(await readFile(f.emitted, 'utf8'), 'initial source');
  await writeFile(f.source, 'recovered source');
  await withCompiled(() => {}, f);
  assert.equal(await readFile(f.emitted, 'utf8'), 'recovered source');
});

void test('the lease protects readers and is released when an operation fails', async (t) => {
  const f = await fixture(t);
  const failure = new Error('consumer failed');
  await assert.rejects(
    withCompiled(async () => {
      await writeFile(f.source, 'next source');
      await assert.rejects(
        withCompiled(() => {}, { ...f, lockTimeoutMs: 20 }),
        /output is in use/,
      );
      assert.equal(await readFile(f.emitted, 'utf8'), 'initial source');
      throw failure;
    }, f),
    failure,
  );
  await withCompiled(() => {}, f);
  assert.equal(await readFile(f.emitted, 'utf8'), 'next source');
});
