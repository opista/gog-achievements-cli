import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runCLI } from '../src/cli.mjs';
import { formatOutput } from '../src/output.mjs';
import { VERSION } from '../src/version.mjs';
import * as exported from '../src/index.mjs';
import { fixture } from './fixture.mjs';
import { captureContracts, normalizeContractText } from './contract-fixture.mjs';
import { fields, isArray } from '../src/validation.mjs';

void test('CLI results, output, files and request order match the JavaScript baseline', async () => {
  const expected: unknown = JSON.parse(
    await readFile('test/contracts/javascript-baseline.json', 'utf8'),
  );
  const actual = await captureContracts({ runCLI, formatOutput, fixture, version: VERSION });
  assert.ok(isArray(actual) && isArray(expected));
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    const label: unknown = fields(actual[index]).label;
    assert.deepEqual(
      actual[index],
      expected[index],
      typeof label === 'string' ? label : 'contract step',
    );
  }
});

void test('the public entry retains the existing JavaScript exports', () => {
  assert.deepEqual(
    Object.keys(exported).sort(),
    [
      'GogAPI',
      'LOGIN_URL',
      'LOGIN_REDIRECT',
      'buildLoginURL',
      'loginWithNativeWindow',
      'GogAchievements',
      'MacKeychain',
      'WindowsVault',
      'credentialVault',
      'GogError',
      'validateQueue',
      'readQueue',
      'saveQueue',
      'withQueueLock',
      'timestamp',
      'id',
      'runCLI',
      'HELP',
    ].sort(),
  );
});

void test('contract paths normalize both Windows JSON escaping levels', () => {
  const directory = 'C:\\Users\\tester\\Temp\\contract';
  const path = `${directory}\\queue.json`;
  assert.equal(normalizeContractText(JSON.stringify(path), directory), '"<TEMP>/queue.json"');
  assert.equal(
    normalizeContractText(JSON.stringify(JSON.stringify(path)), directory),
    '"\\"<TEMP>/queue.json\\""',
  );
});
