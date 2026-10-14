import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const files = (await readdir('test'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `test/${name}`);
const coverage = process.argv.includes('--coverage')
  ? [
      '--experimental-test-coverage',
      '--test-coverage-include=src/*.mjs',
      '--test-coverage-lines=95',
      '--test-coverage-branches=85',
      '--test-coverage-functions=90',
    ]
  : [];
const child = spawn(process.execPath, ['--test', '--test-timeout=15000', ...coverage, ...files], {
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
