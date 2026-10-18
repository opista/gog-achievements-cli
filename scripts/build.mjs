import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, rm, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { withCompiled } from './compile.mjs';
import { bundleCLI, createArchive, packageExecutable } from './package.mjs';
import { buildNative } from './build-native.mjs';
import { BUILD_HELP, parseBuildArguments, selectBuildTarget } from './build-targets.mjs';

const execute = promisify(execFile);
/** @param {string} folder */
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

async function main() {
  const options = parseBuildArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(BUILD_HELP);
    return;
  }
  const { name: label, platform, architecture } = selectBuildTarget(options.target);
  await withCompiled(async () => {
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
      throw new Error('package.json must have a valid release version.');
    const tag =
      process.env.GOG_RELEASE_TAG ??
      (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
    if (tag && tag !== `v${version}`)
      throw new Error('The release tag must match package.json version.');
    const folderName = `gog-achievements-${version}-${label}`;
    const folder = resolve('dist', folderName);
    const staging = resolve('.build', label);
    for (const path of [staging, folder]) {
      await rm(path, { recursive: true, force: true });
      await mkdir(path, { recursive: true });
    }
    const helper = await buildNative({ platform, architecture });
    const bundle = join(staging, 'main.cjs');
    await bundleCLI({
      entryPoints: ['.build/typescript/scripts/standalone-entry.mjs'],
      outfile: bundle,
    });
    const executable = join(folder, `gog-achievements${platform === 'win32' ? '.exe' : ''}`);
    const portable = platform === 'darwin' && architecture === 'x64';
    process.stdout.write(`Packaging ${label} executable with Node ${process.versions.node}...\n`);
    await packageExecutable({
      executable,
      bundle,
      staging,
      folder,
      helper,
      platform,
      architecture,
    });
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
    const archive = await createArchive(folder, resolve('dist', `${folderName}.zip`), platform);
    // Self updates select stable releases; keep development prerelease builds supported.
    if (/^\d+\.\d+\.\d+$/.test(version)) {
      const updateSmoke = await execute(process.execPath, ['scripts/smoke-update.mjs', archive], {
        timeout: 90000,
        maxBuffer: 1_000_000,
      });
      process.stdout.write(updateSmoke.stdout);
    }
    process.stdout.write(`Built ${executable}\nArchive: ${archive}\n`);
  });
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Build failed: ${error instanceof Error ? error.message : 'Unknown build error'}\n`,
  );
  process.exitCode = 1;
}
