import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { compile } from './compile.mjs';

compile();
const root = '.build/typescript/test';
const files = (await readdir(root, { recursive: true }))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `${root}/${name}`);
if (!files.length) throw new Error('No emitted tests were found.');
const coverage = process.argv.includes('--coverage')
  ? [
      '--experimental-test-coverage',
      '--test-coverage-include=.build/typescript/src/**/*.mjs',
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
