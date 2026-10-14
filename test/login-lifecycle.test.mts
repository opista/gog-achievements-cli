import test from 'node:test';
import assert from 'node:assert/strict';
import { withLoginSignals } from '../src/adapters/native/login-lifecycle.mjs';

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

void test('native login removes signal handlers after success and failure', async () => {
  const before = SIGNALS.map((signal) => process.listeners(signal));
  assert.equal(
    await withLoginSignals(async (signal) => {
      assert.equal(signal.aborted, false);
      assert.equal(process.listenerCount('SIGINT'), before[0]!.length + 1);
      return 'complete';
    }),
    'complete',
  );
  const failure = new Error('fixture failure');
  await assert.rejects(
    withLoginSignals(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    SIGNALS.map((signal) => process.listeners(signal)),
    before,
  );
});

void test('native login passes SIGINT and SIGTERM to cancellation and removes both handlers', async () => {
  for (const event of SIGNALS) {
    const before = SIGNALS.map((signal) => process.listeners(signal));
    await withLoginSignals(async (signal) => {
      process.emit(event);
      assert.equal(signal.aborted, true);
    });
    assert.deepEqual(
      SIGNALS.map((signal) => process.listeners(signal)),
      before,
    );
  }
});
