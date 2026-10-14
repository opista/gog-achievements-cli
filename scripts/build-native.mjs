import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);

async function buildWindows(architecture, dotnet) {
  process.stdout.write(`Building Windows ${architecture} sign-in helper...\n`);
  await execute(
    dotnet,
    [
      'publish',
      'native/windows/Gog.Login.csproj',
      '--configuration',
      'Release',
      '--runtime',
      `win-${architecture}`,
      '--self-contained',
      'true',
      '--output',
      'native/bin',
      `-p:PlatformTarget=${architecture}`,
      '-p:PublishSingleFile=true',
      '-p:IncludeNativeLibrariesForSelfExtract=true',
    ],
    { timeout: 180000, maxBuffer: 2_000_000 },
  );
  return resolve('native/bin/gog-login.exe');
}

async function buildMac() {
  const temporary = await mkdtemp(join(tmpdir(), 'gog-native-build-'));
  try {
    process.stdout.write('Building universal Mac sign-in helper...\n');
    for (const target of ['arm64', 'x86_64']) {
      await execute(
        '/usr/bin/xcrun',
        [
          'swiftc',
          '-swift-version',
          '5',
          '-O',
          '-target',
          `${target}-apple-macos12.0`,
          '-module-cache-path',
          join(temporary, 'modules'),
          '-framework',
          'AppKit',
          '-framework',
          'WebKit',
          '-framework',
          'Security',
          'native/gog-login.swift',
          '-o',
          join(temporary, target),
        ],
        { timeout: 30000, maxBuffer: 1_000_000 },
      );
    }
    const helper = resolve('native/bin/gog-login');
    await execute(
      '/usr/bin/lipo',
      ['-create', join(temporary, 'arm64'), join(temporary, 'x86_64'), '-output', helper],
      { timeout: 5000 },
    );
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', helper], { timeout: 5000 });
    return helper;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyHelper(helper, platform) {
  const commands = [
    '--self-test',
    '--vault-self-test',
    ...(platform === 'win32' ? ['--browser-self-test'] : []),
  ];
  for (const command of commands) {
    const result = await execute(helper, [command], { timeout: 10000 });
    const outcome = JSON.parse(result.stdout);
    if (!outcome.self_test_passed) throw new Error(`Native ${command} failed.`);
    process.stdout.write(`Native ${command}: ${outcome.checks} checks passed.\n`);
  }
}

export async function buildNative({
  platform = process.platform,
  architecture = process.arch,
  dotnet = process.env.GOG_BUILD_DOTNET ?? 'dotnet',
  runSelfTest = true,
} = {}) {
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(architecture)) {
    throw new Error('Builds support macOS and Windows on arm64 or x64.');
  }
  await mkdir('native/bin', { recursive: true });
  const helper = platform === 'win32' ? await buildWindows(architecture, dotnet) : await buildMac();
  if (runSelfTest) await verifyHelper(helper, platform);
  return helper;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildNative();
