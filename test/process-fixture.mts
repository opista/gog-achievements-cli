import { spawn } from 'node:child_process';
import type { SpawnProcess } from '../src/types.mjs';

// These Node processes stand in for native helpers and load no application code.
// A deliberately killed helper can leave an empty V8 coverage file behind.
export const spawnFixtureProcess: SpawnProcess = (command, args, options) => {
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  return spawn(command, args, { ...options, env });
};
