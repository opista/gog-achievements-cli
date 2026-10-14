import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function compile() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  rmSync(resolve(root, '.build/typescript'), { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.json')],
    { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 30000 },
  );
  if (result.error || result.status !== 0) throw new Error('TypeScript compilation failed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) compile();
