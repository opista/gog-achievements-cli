import assert from 'node:assert/strict';
import { GogError } from '../src/errors.mjs';
import type { CLIOutcome, CommandData, SuccessOutcome } from '../src/types.mjs';
import type { CLIService } from '../src/cli.mjs';
import { fields } from '../src/validation.mjs';

export function gogError(error: unknown): GogError {
  assert.ok(error instanceof GogError);
  return error;
}

export function successData<K extends keyof CommandData>(
  outcome: CLIOutcome,
  command: K,
): CommandData[K] {
  assert.equal(outcome.command, command);
  assert.ok(outcome.result.ok);
  // The public outcome is already typed. The assertion above checks its discriminant.
  return outcome.result.data as CommandData[K];
}

export function failureData(outcome: CLIOutcome) {
  assert.ok(!outcome.result.ok);
  return outcome.result.error;
}

export function successOutcome<K extends keyof CommandData>(
  outcome: CLIOutcome,
  command: K,
): Extract<SuccessOutcome, { command: K }> {
  successData(outcome, command);
  return outcome as Extract<SuccessOutcome, { command: K }>;
}

export function serviceStub(overrides: Partial<CLIService> = {}): CLIService {
  const unexpected = () => assert.fail('Unexpected service access');
  return {
    loginURL: unexpected,
    finishLogin: unexpected,
    importLogin: unexpected,
    authStatus: unexpected,
    logout: unexpected,
    listGames: unexpected,
    listAchievements: unexpected,
    createQueue: unexpected,
    addToQueue: unexpected,
    editQueue: unexpected,
    applyQueue: unexpected,
    ...overrides,
  };
}

export function processError(error: unknown) {
  assert.ok(error instanceof Error);
  const data = fields(error);
  return {
    message: error.message,
    code: data.code,
    stdout: data.stdout,
    stderr: typeof data.stderr === 'string' ? data.stderr : '',
  };
}

export function jsonValue(text: string, ...path: (string | number)[]): unknown {
  let value: unknown = JSON.parse(text);
  for (const key of path) value = fields(value)[key];
  return value;
}
