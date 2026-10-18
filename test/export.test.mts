import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Achievement } from '../src/domain/model.mjs';
import { achievementCSV } from '../src/cli/csv.mjs';
import { writeExportFile } from '../src/adapters/export-files.mjs';
import { gogError } from './assertions.mjs';

const game = { id: '999999999999999999999999999999', title: 'A, "game"', client_id: '123' };
const achievement: Achievement = {
  id: '48497841707623054',
  key: 'TEST',
  name: 'Café, "winner"',
  description: 'First line\r\nSecond line\nLast\rline',
  hidden: true,
  unlocked: true,
  unlocked_at: '2026-01-01T13:34:56+01:00',
  image_locked: null,
  image_unlocked: null,
  rarity: null,
};
const header = 'game_id,game_title,achievement_id,name,description,hidden,status,unlocked_at\r\n';

void test('CSV preserves exact IDs, UTF-8 text, CSV escaping and UTC dates', () => {
  const csv = achievementCSV(game, [achievement]);
  assert.equal(
    csv,
    header +
      '999999999999999999999999999999,"A, ""game""",48497841707623054,"Café, ""winner""","First line\r\nSecond line\nLast\rline",true,unlocked,2026-01-01T12:34:56Z\r\n',
  );
  assert.equal(Buffer.from(csv, 'utf8').toString('utf8'), csv);
});

void test('CSV writes an empty date for locked entries and a header for zero rows', () => {
  assert.equal(achievementCSV(game, []), header);
  const csv = achievementCSV({ ...game, title: '' }, [
    {
      ...achievement,
      name: '',
      description: '',
      hidden: false,
      unlocked: false,
      unlocked_at: null,
    },
  ]);
  assert.equal(csv, header + `${game.id},,${achievement.id},,,false,locked,\r\n`);
});

void test('file export writes UTF-8 and returns an absolute path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'achievements.csv');
  const csv = achievementCSV(game, [achievement]);
  assert.equal(await writeExportFile(relative(process.cwd(), path), csv), path);
  assert.deepEqual(await readFile(path), Buffer.from(csv, 'utf8'));
  assert.deepEqual(await readdir(directory), ['achievements.csv']);
});

void test('file export refuses existing files, directories and concurrent exports', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'existing.csv');
  await writeFile(path, 'Keep this file.');
  await assert.rejects(
    writeExportFile(path, 'Replacement'),
    (error) => gogError(error).code === 'EXPORT_EXISTS',
  );
  assert.equal(await readFile(path, 'utf8'), 'Keep this file.');
  const folder = join(directory, 'folder');
  await mkdir(folder);
  await assert.rejects(
    writeExportFile(folder, 'Replacement'),
    (error) => gogError(error).code === 'EXPORT_EXISTS',
  );
  const concurrent = join(directory, 'concurrent.csv');
  const results = await Promise.allSettled([
    writeExportFile(concurrent, 'First'),
    writeExportFile(concurrent, 'Second'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.ok(failure?.status === 'rejected');
  assert.equal(gogError(failure.reason).code, 'EXPORT_EXISTS');
  assert.ok(['First', 'Second'].includes(await readFile(concurrent, 'utf8')));
  assert.deepEqual((await readdir(directory)).sort(), ['concurrent.csv', 'existing.csv', 'folder']);
});

void test(
  'file export refuses a dangling symlink without creating its target',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'gog-export-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'link.csv');
    await symlink(join(directory, 'absent.csv'), path);
    await assert.rejects(
      writeExportFile(path, 'Replacement'),
      (error) => gogError(error).code === 'EXPORT_EXISTS',
    );
    assert.deepEqual(await readdir(directory), ['link.csv']);
  },
);

void test('file export reports write failures without raw error details or temporary files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gog-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    writeExportFile(join(directory, 'missing', 'file.csv'), 'Export'),
    (error) => gogError(error).code === 'EXPORT_WRITE_FAILED',
  );
  assert.deepEqual(await readdir(directory), []);
});
