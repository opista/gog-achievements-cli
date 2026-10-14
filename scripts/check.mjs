import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const directory of ['src', 'bin', 'scripts', 'test']) {
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${name}`], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0) {
      process.stderr.write(result.stderr ?? 'Syntax check failed.\n');
      process.exit(1);
    }
  }
}
process.stdout.write('Syntax checks passed.\n');
