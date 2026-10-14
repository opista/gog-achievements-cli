import { gogError } from './assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
  lstatSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cacheNativeHelper, isPackaged } from '../src/assets.mjs';

function workspace(t: import('node:test').TestContext) {
  const path = mkdtempSync(join(tmpdir(), 'gog-assets-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

void test('helper extraction preserves bytes, executable permissions and a stable path', (t) => {
  const root = join(workspace(t), 'components');
  const bytes = Buffer.from('fixture helper');
  const path = cacheNativeHelper(bytes, root, 'gog-login');
  assert.deepEqual(readFileSync(path), bytes);
  assert.equal(cacheNativeHelper(bytes, root, 'gog-login'), path);
  assert.notEqual(cacheNativeHelper(Buffer.from('new version'), root, 'gog-login'), path);
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(path).mode & 0o777, 0o500);
    assert.equal(lstatSync(dirname(path)).mode & 0o777, 0o700);
  }
  assert.equal(isPackaged(), false);
});

void test('a corrupt cached helper is repaired and temporary files are removed', (t) => {
  const root = workspace(t);
  const bytes = Buffer.from('fixture helper');
  const path = cacheNativeHelper(bytes, root, 'gog-login');
  chmodSync(path, 0o600);
  writeFileSync(path, 'corrupted');
  chmodSync(path, 0o500);
  assert.equal(cacheNativeHelper(bytes, root, 'gog-login'), path);
  assert.deepEqual(readFileSync(path), bytes);
  assert.deepEqual(readdirSync(dirname(path)), ['gog-login']);
});

void test('unsafe extraction folders are rejected without revealing paths', (t) => {
  const path = join(workspace(t), 'private-path');
  writeFileSync(path, 'file, not folder');
  assert.throws(
    () => cacheNativeHelper(Buffer.from('fixture helper'), path, 'gog-login'),
    (error) =>
      gogError(error).code === 'BUNDLED_ASSET_FAILED' &&
      !gogError(error).message.includes('private-path'),
  );
});

void test(
  'helper symlinks are replaced without changing their targets',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = workspace(t);
    const bytes = Buffer.from('fixture helper');
    const path = cacheNativeHelper(bytes, root, 'gog-login');
    const target = join(root, 'other-file');
    writeFileSync(target, 'leave unchanged');
    rmSync(path);
    symlinkSync(target, path);
    cacheNativeHelper(bytes, root, 'gog-login');
    assert.equal(lstatSync(path).isSymbolicLink(), false);
    assert.equal(readFileSync(target, 'utf8'), 'leave unchanged');
    const linkedRoot = join(root, 'linked');
    symlinkSync(dirname(path), linkedRoot);
    assert.throws(
      () => cacheNativeHelper(bytes, linkedRoot, 'gog-login'),
      (error) => gogError(error).code === 'BUNDLED_ASSET_FAILED',
    );
  },
);
