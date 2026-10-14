import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/process.mjs';

const node = (code, input = '', options) =>
  runProcess(process.execPath, ['-e', code], input, options);

test('native processes capture private stdout and discard stderr', async () => {
  const result = await node(
    "process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => process.stdout.write(chunk)); process.stderr.write('private diagnostics');",
    'fixture-secret',
  );
  assert.deepEqual(result, { code: 0, stdout: 'fixture-secret' });
});

test('native output limits count UTF-8 bytes and expose no returned data', async () => {
  await assert.rejects(
    node("process.stdout.write('é'.repeat(150));", '', { maxOutputBytes: 200 }),
    (error) => error.code === 'PROCESS_OUTPUT_LIMIT' && !error.message.includes('é'),
  );
});

test('cancelled processes stop promptly and pre-cancelled calls never spawn', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(
    node('', '', { signal, spawnImpl: () => assert.fail('Must not spawn') }),
    (error) => error.code === 'PROCESS_CANCELLED',
  );
  const abort = new AbortController();
  const pending = node('setInterval(() => {}, 1000);', '', { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, (error) => error.code === 'PROCESS_CANCELLED');
});

test('missing executables and spawn failures hide raw process errors', async () => {
  await assert.rejects(
    runProcess('missing-gog-private-token-file', []),
    (error) => error.code === 'PROCESS_MISSING' && !error.message.includes('private-token'),
  );
  await assert.rejects(
    runProcess('helper', [], '', {
      spawnImpl: () => {
        throw new Error('private-token');
      },
    }),
    (error) => error.code === 'PROCESS_FAILED' && !error.message.includes('private-token'),
  );
});
