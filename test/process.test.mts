import { gogError } from './assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/process.mjs';
import { spawnFixtureProcess } from './process-fixture.mjs';

const node = (code: string, input = '', options?: import('../src/types.mjs').ProcessOptions) =>
  runProcess(process.execPath, ['-e', code], input, { spawnImpl: spawnFixtureProcess, ...options });

void test('native processes capture private stdout and discard stderr', async () => {
  const result = await node(
    "process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => process.stdout.write(chunk)); process.stderr.write('private diagnostics');",
    'fixture-secret',
  );
  assert.deepEqual(result, { code: 0, stdout: 'fixture-secret' });
});

void test('background native processes keep Windows window hiding enabled', async () => {
  await node('', '', {
    spawnImpl: (file, args, options) => {
      assert.equal(options.windowsHide, true);
      return spawnFixtureProcess(file, args, options);
    },
  });
});

void test('native output limits count UTF-8 bytes and expose no returned data', async () => {
  await assert.rejects(
    node("process.stdout.write('é'.repeat(150));", '', { maxOutputBytes: 200 }),
    (error) =>
      gogError(error).code === 'PROCESS_OUTPUT_LIMIT' && !gogError(error).message.includes('é'),
  );
});

void test('cancelled processes stop promptly and pre-cancelled calls never spawn', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(
    node('', '', { signal, spawnImpl: () => assert.fail('Must not spawn') }),
    (error) => gogError(error).code === 'PROCESS_CANCELLED',
  );
  const abort = new AbortController();
  const pending = node('setInterval(() => {}, 1000);', '', { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, (error) => gogError(error).code === 'PROCESS_CANCELLED');
});

void test('missing executables and spawn failures hide raw process errors', async () => {
  await assert.rejects(
    runProcess('missing-gog-private-token-file', []),
    (error) =>
      gogError(error).code === 'PROCESS_MISSING' &&
      !gogError(error).message.includes('private-token'),
  );
  await assert.rejects(
    runProcess('helper', [], '', {
      spawnImpl: () => {
        throw new Error('private-token');
      },
    }),
    (error) =>
      gogError(error).code === 'PROCESS_FAILED' &&
      !gogError(error).message.includes('private-token'),
  );
});
