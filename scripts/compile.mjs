import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STATE_FILE = '.compile-state.json';
const LOCK_TIMEOUT_MS = 30000;

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return files(path);
      if (!entry.isFile()) throw new Error(`Compilation input must be a regular file: ${path}`);
      return [path];
    }),
  );
  return nested.flat().sort();
}

/** @param {string} root @param {string[]} paths */
async function digest(root, paths) {
  const hash = createHash('sha256');
  for (const path of paths.sort()) {
    hash.update(path.slice(root.length));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** @param {string} root */
async function sourceDigest(root) {
  const paths = (
    await Promise.all(['src', 'scripts', 'test'].map((name) => files(join(root, name))))
  ).flat();
  for (const name of await readdir(root)) {
    if (/^(?:package(?:-lock)?|tsconfig(?:\.[\w-]+)?)\.json$/.test(name))
      paths.push(join(root, name));
  }
  paths.push(join(root, 'node_modules/typescript/package.json'));
  return digest(root, paths);
}

/** @param {string} output */
async function outputDigest(output) {
  return digest(
    output,
    (await files(output)).filter((path) => path !== join(output, STATE_FILE)),
  );
}

/** @param {string} root */
async function ensureCompiled(root) {
  const output = join(root, '.build/typescript');
  const source = await sourceDigest(root);
  try {
    const saved = /** @type {unknown} */ (
      JSON.parse(await readFile(join(output, STATE_FILE), 'utf8'))
    );
    if (
      saved &&
      typeof saved === 'object' &&
      'source' in saved &&
      'output' in saved &&
      saved.source === source &&
      saved.output === (await outputDigest(output))
    )
      return output;
  } catch (error) {
    if (!hasCode(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error;
  }
  const staging = await mkdtemp(join(root, '.build/typescript-staging-'));
  const backup = `${staging}-previous`;
  let published = false;
  try {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(root, 'tsconfig.json'),
        '--outDir',
        staging,
      ],
      { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 30000 },
    );
    if (result.error || result.status !== 0) throw new Error('TypeScript compilation failed.');
    if (source !== (await sourceDigest(root)))
      throw new Error('Compilation inputs changed during the build. Run the command again.');
    await writeFile(
      join(staging, STATE_FILE),
      JSON.stringify({ source, output: await outputDigest(staging) }),
    );
    let previous = false;
    try {
      await rename(output, backup);
      previous = true;
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    try {
      await rename(staging, output);
      published = true;
    } catch (error) {
      if (previous) await rename(backup, output);
      throw error;
    }
    return output;
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (published) await rm(backup, { recursive: true, force: true });
  }
}

/**
 * Keep emitted files stable until the caller has finished using them. Reuse is
 * allowed only when source, compiler version and every emitted file still match.
 * @template T
 * @param {(output: string) => T | Promise<T>} operation
 * @param {{root?: string, lockTimeoutMs?: number}} [options]
 */
export async function withCompiled(
  operation,
  { root = ROOT, lockTimeoutMs = LOCK_TIMEOUT_MS } = {},
) {
  const build = join(root, '.build');
  await mkdir(build, { recursive: true });
  const lock = join(build, 'typescript.lock');
  const deadline = Date.now() + lockTimeoutMs;
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Compiler output is in use. Retry after the other command finishes. If it was interrupted, remove ${lock}.`,
        );
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
    return await operation(await ensureCompiled(root));
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function compile() {
  return withCompiled((output) => output);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await compile();
