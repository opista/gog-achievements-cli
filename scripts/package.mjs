import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { build } from 'esbuild';
import { inject } from 'postject';

const execute = promisify(execFile);
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
// Bundled Node/.NET compression can exceed 30 seconds on Windows.
const WINDOWS_ARCHIVE_TIMEOUT_MS = 120000;

/** @param {string} executable @param {string} bundle @param {string} staging @param {string} helper @param {string} platform */
async function packageSingleExecutable(executable, bundle, staging, helper, platform) {
  const blob = join(staging, 'sea.blob');
  const config = join(staging, 'sea.json');
  await writeFile(
    config,
    JSON.stringify({
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: 'none',
      assets: { 'login-helper': helper },
    }),
  );
  await execute(process.execPath, ['--experimental-sea-config', config], {
    timeout: 30000,
    maxBuffer: 1_000_000,
  });
  await copyFile(process.execPath, executable);
  await chmod(executable, 0o755);
  if (platform === 'darwin')
    await execute('/usr/bin/codesign', ['--remove-signature', executable], { timeout: 5000 });
  await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), {
    sentinelFuse: SEA_FUSE,
    ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
}

// Node 24's SEA tooling does not support Intel Macs. A small launcher starts
// the bundled runtime instead; users still need no Node installation.
/** @param {string} executable @param {string} bundle @param {string} folder @param {string} helper */
async function packageIntelMac(executable, bundle, folder, helper) {
  await mkdir(join(folder, 'lib'), { recursive: true });
  await mkdir(join(folder, 'native', 'bin'), { recursive: true });
  const runtime = join(folder, 'lib', 'node');
  const login = join(folder, 'native', 'bin', 'gog-login');
  await copyFile(process.execPath, runtime);
  await chmod(runtime, 0o755);
  await copyFile(bundle, join(folder, 'lib', 'main.cjs'));
  await copyFile(helper, login);
  await chmod(login, 0o755);
  await execute(
    '/usr/bin/xcrun',
    [
      'clang',
      '-arch',
      'x86_64',
      '-mmacosx-version-min=13.5',
      '-O2',
      'native/launcher.c',
      '-o',
      executable,
    ],
    { timeout: 30000 },
  );
}

/** @param {import('esbuild').BuildOptions} options */
export async function bundleCLI(options) {
  await build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: { 'import.meta.url': '__gog_module_url', __GOG_DISTRIBUTION__: 'true' },
    banner: { js: "const __gog_module_url = require('node:url').pathToFileURL(__filename).href;" },
    ...options,
  });
}

/** @param {{executable: string, bundle: string, staging: string, folder: string, helper: string, platform: string, architecture: string}} options */
export async function packageExecutable({
  executable,
  bundle,
  staging,
  folder,
  helper,
  platform,
  architecture,
}) {
  if (platform === 'darwin' && architecture === 'x64')
    await packageIntelMac(executable, bundle, folder, helper);
  else await packageSingleExecutable(executable, bundle, staging, helper, platform);
  if (platform === 'darwin')
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', executable], { timeout: 10000 });
}

/** @param {string} folder @param {string} archive @param {string} platform */
export async function createArchive(folder, archive, platform) {
  const folderName = basename(folder);
  await rm(archive, { force: true });
  if (platform === 'darwin')
    await execute('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', folder, archive], {
      timeout: 30000,
    });
  else {
    // Windows PowerShell Compress-Archive can store backslash paths, which
    // strict ZIP readers reject. The built-in tar writes standard ZIP paths.
    await execute(
      'tar.exe',
      ['--format', 'zip', '-c', '-f', archive, '-C', dirname(folder), folderName],
      { timeout: WINDOWS_ARCHIVE_TIMEOUT_MS },
    );
  }
  const checksum = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
  return archive;
}
