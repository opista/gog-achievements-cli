import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, chmod, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { build } from 'esbuild';
import { inject } from 'postject';
import { buildNative } from './build-native.mjs';

const execute = promisify(execFile);
const platform = process.platform;
const architecture = process.arch;
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

async function packageSingleExecutable(executable, bundle, staging, helper) {
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

async function copyDocumentation(folder) {
  for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
    await copyFile(name, join(folder, name));
  await cp('licenses', join(folder, 'licenses'), { recursive: true });
  for (const candidate of [
    resolve(dirname(process.execPath), '..', 'LICENSE'),
    resolve(dirname(process.execPath), 'LICENSE'),
  ]) {
    try {
      await copyFile(candidate, join(folder, 'licenses', 'NODE-LICENSE.txt'));
      break;
    } catch {
      /* The checked-in license covers the pinned Node distribution. */
    }
  }
}

async function createArchive(folder, folderName) {
  const archive = resolve('dist', `${folderName}.zip`);
  await rm(archive, { force: true });
  if (platform === 'darwin')
    await execute('/usr/bin/ditto', ['-c', '-k', '--keepParent', folder, archive], {
      timeout: 30000,
    });
  else {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    await execute(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -LiteralPath ${quote(folder)} -DestinationPath ${quote(archive)}`,
      ],
      { timeout: 30000 },
    );
  }
  const checksum = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  await writeFile(`${archive}.sha256`, `${checksum}  ${folderName}.zip\n`);
  return archive;
}

async function main() {
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(architecture)) {
    throw new Error('Build on macOS or Windows using arm64 or x64 Node.');
  }
  if (process.argv.length > 2)
    throw new Error(
      'build creates a release for the current platform and Node architecture. Other targets build on native CI runners.',
    );
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
    throw new Error('package.json must have a valid release version.');
  const tag =
    process.env.GOG_RELEASE_TAG ??
    (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  if (tag && tag !== `v${version}`)
    throw new Error('The release tag must match package.json version.');
  const label = `${platform === 'darwin' ? 'macos' : 'windows'}-${architecture}`;
  const folderName = `gog-achievements-${version}-${label}`;
  const folder = resolve('dist', folderName);
  const staging = resolve('.build', label);
  for (const path of [staging, folder]) {
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });
  }
  const helper = await buildNative();
  const bundle = join(staging, 'main.cjs');
  await build({
    entryPoints: ['scripts/standalone-entry.mjs'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: { 'import.meta.url': '__gog_module_url', __GOG_DISTRIBUTION__: 'true' },
    banner: { js: "const __gog_module_url = require('node:url').pathToFileURL(__filename).href;" },
  });
  const executable = join(folder, `gog-achievements${platform === 'win32' ? '.exe' : ''}`);
  const portable = platform === 'darwin' && architecture === 'x64';
  process.stdout.write(`Packaging ${label} executable with Node ${process.versions.node}...\n`);
  if (portable) await packageIntelMac(executable, bundle, folder, helper);
  else await packageSingleExecutable(executable, bundle, staging, helper);
  if (platform === 'darwin')
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', executable], { timeout: 10000 });
  await copyDocumentation(folder);
  await writeFile(
    join(folder, 'build.json'),
    `${JSON.stringify(
      {
        version,
        platform,
        architecture,
        node: process.versions.node,
        runtime_included: true,
        native_helper_included: true,
        layout: portable ? 'native_launcher_with_private_runtime' : 'single_executable',
        signing: platform === 'darwin' ? 'ad_hoc' : 'unsigned',
      },
      null,
      2,
    )}\n`,
  );
  const smoke = await execute(process.execPath, ['scripts/smoke.mjs', executable], {
    timeout: 90000,
    maxBuffer: 1_000_000,
  });
  process.stdout.write(smoke.stdout);
  const archive = await createArchive(folder, folderName);
  process.stdout.write(`Built ${executable}\nArchive: ${archive}\n`);
}

await main();
