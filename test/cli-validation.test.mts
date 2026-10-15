import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCLI } from '../src/cli/handlers.mjs';
import { failureData, serviceStub } from './assertions.mjs';

void test('unknown and inherited command names fail before external operations', async () => {
  const unexpected = () => assert.fail('Unknown commands must not access external operations.');
  for (const command of ['unknown-command', ...Object.getOwnPropertyNames(Object.prototype)]) {
    for (const flags of [[], ['--file', 'never-touch.json']]) {
      const outcome = await dispatchCLI([command, ...flags, '--json'], {
        service: serviceStub(),
        stderr: { write: unexpected },
        platform: 'darwin',
        isPackaged: unexpected,
        systemInfo: unexpected,
        readInput: unexpected,
        nativeLogin: unexpected,
        updates: { check: unexpected, install: unexpected },
        confirm: unexpected,
        files: { read: unexpected, save: unexpected, withLock: unexpected },
      });
      assert.equal(outcome.exitCode, 2, command);
      assert.equal(failureData(outcome).code, 'UNKNOWN_COMMAND', command);
      assert.equal(outcome.command, undefined, command);
      assert.equal(outcome.file, undefined, command);
    }
  }
});
