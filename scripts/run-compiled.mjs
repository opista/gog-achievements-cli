import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { withCompiled } from './compile.mjs';

const [command, ...args] = process.argv.slice(2);
if (command !== 'start' && command !== 'demo') throw new Error('Use start or demo.');
await withCompiled(async (output) => {
  const entry =
    command === 'start'
      ? join(output, '../../bin/gog-achievements.mjs')
      : join(output, 'scripts/demo.mjs');
  await new Promise((accept) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', () => {
      process.exitCode = 1;
      accept(undefined);
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
      accept(undefined);
    });
  });
});
