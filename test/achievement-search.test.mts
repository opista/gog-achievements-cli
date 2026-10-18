import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAchievements } from '../src/index.mjs';
import { validateAchievementStatus } from '../src/domain/achievements.mjs';
import { runCLI } from '../src/cli.mjs';
import { formatOutput } from '../src/output.mjs';
import { fixture, GAME_ID, ACHIEVEMENT_ID, SECOND_ID, DATE } from './fixture.mjs';
import { failureData, serviceStub, successData } from './assertions.mjs';

void test('the shared filter searches names and descriptions and retains source order and data', async () => {
  const f = fixture();
  f.achievements[1]!.date_unlocked = DATE;
  f.achievements[1]!.visible = false;
  const { achievements } = await f.service.listAchievements(GAME_ID);
  const original = structuredClone(achievements);
  for (const options of [{}, { search: '' }, { search: '  ' }, { status: 'all' as const }]) {
    assert.deepEqual(filterAchievements(achievements, options), original);
  }
  assert.deepEqual(filterAchievements(achievements, { search: ' EARNED BUT ' }), [achievements[0]]);
  assert.deepEqual(filterAchievements(achievements, { search: 'SECOND DESCRIPTION' }), [
    achievements[1],
  ]);
  assert.deepEqual(filterAchievements(achievements, { search: 'description', status: 'locked' }), [
    achievements[0],
  ]);
  assert.deepEqual(
    filterAchievements(achievements, { search: 'description', status: 'unlocked' }),
    [achievements[1]],
  );
  assert.deepEqual(filterAchievements(achievements, { search: 'no match' }), []);
  assert.deepEqual(filterAchievements([], { search: 'description' }), []);
  assert.deepEqual(achievements, original);
  assert.equal(filterAchievements(achievements)[0], achievements[0]);
  assert.equal(f.writes.length, 0);
});

void test('achievement list combines search and status with the existing JSON shape', async () => {
  const f = fixture();
  f.achievements[1]!.date_unlocked = DATE;
  const original = structuredClone(f.achievements);
  for (const [args, ids] of [
    [[], [ACHIEVEMENT_ID, SECOND_ID]],
    [
      ['--status', 'all'],
      [ACHIEVEMENT_ID, SECOND_ID],
    ],
    [['--search', 'MISSING'], [ACHIEVEMENT_ID]],
    [['--search', 'SECOND DESCRIPTION'], [SECOND_ID]],
    [['--status', 'locked'], [ACHIEVEMENT_ID]],
    [['--status', 'unlocked'], [SECOND_ID]],
    [['--search', 'description', '--status', 'unlocked'], [SECOND_ID]],
    [['--search', 'missing', '--status', 'unlocked'], []],
    [
      ['--search', '  '],
      [ACHIEVEMENT_ID, SECOND_ID],
    ],
  ] satisfies [string[], string[]][]) {
    const outcome = await runCLI(['achievements', 'list', '--game', GAME_ID, ...args, '--json'], {
      service: f.service,
    });
    assert.equal(outcome.exitCode, 0);
    const data = successData(outcome, 'achievements list');
    assert.deepEqual(Object.keys(data), ['user_id', 'game', 'count', 'achievements']);
    assert.equal(data.count, ids.length);
    assert.deepEqual(
      data.achievements.map((item) => item.id),
      ids,
    );
    const output = formatOutput(outcome);
    assert.equal(output.trim().split('\n').length, 1);
    assert.deepEqual(JSON.parse(output), { ok: true, data });
  }
  const text = formatOutput(
    await runCLI(['achievements', 'list', '--game', GAME_ID, '--status', 'locked'], {
      service: f.service,
    }),
  );
  assert.match(text, /Earned but missing/);
  assert.ok(!text.includes('Second achievement'));
  assert.deepEqual(f.achievements, original);
  assert.equal(f.writes.length, 0);
});

void test('invalid status and status flags on other commands fail before service access', async () => {
  for (const value of ['', 'pending', 'Locked', 'ALL']) {
    const result = await runCLI(
      ['achievements', 'list', '--game', GAME_ID, '--status', value, '--json'],
      { service: serviceStub() },
    );
    assert.equal(result.exitCode, 2);
    assert.equal(failureData(result).code, 'INVALID_ARGUMENTS');
    assert.match(failureData(result).message, /--status/);
  }
  for (const args of [
    ['games', 'list'],
    ['queue', 'show', '--file', 'unused.json'],
  ]) {
    const result = await runCLI([...args, '--status', 'locked'], { service: serviceStub() });
    assert.equal(result.exitCode, 2);
    assert.equal(failureData(result).code, 'INVALID_ARGUMENTS');
  }
  assert.equal(validateAchievementStatus(), 'all');
});

void test('achievement help exposes the filters without using credentials', async () => {
  const result = await runCLI(['achievements', 'list', '--help', '--json'], {
    service: serviceStub(),
  });
  const help = successData(result, 'help');
  assert.ok(help.options.some((option) => option.flag === 'search' && option.value === 'TEXT'));
  assert.ok(
    help.options.some(
      (option) => option.flag === 'status' && option.value === 'all|locked|unlocked',
    ),
  );
});
