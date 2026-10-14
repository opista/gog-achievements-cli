import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('Build the sign-in helper on a Mac with Xcode Command Line Tools.');
const temporary = await mkdtemp(join(tmpdir(), 'gog-native-build-'));
try {
  await mkdir('native/bin', { recursive: true });
  for (const architecture of ['arm64', 'x86_64']) {
    await execute('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${architecture}-apple-macos12.0`,
      '-module-cache-path', join(temporary, 'modules'), '-framework', 'AppKit', '-framework', 'WebKit',
      'native/gog-login.swift', '-o', join(temporary, architecture)], { timeout: 30000, maxBuffer: 1_000_000 });
  }
  await execute('/usr/bin/lipo', ['-create', join(temporary, 'arm64'), join(temporary, 'x86_64'), '-output', 'native/bin/gog-login'], { timeout: 5000 });
  await execute('/usr/bin/codesign', ['--force', '--sign', '-', 'native/bin/gog-login'], { timeout: 5000 });
  const result = await execute('./native/bin/gog-login', ['--self-test'], { timeout: 5000 });
  process.stdout.write(result.stdout + '\n');
  process.stdout.write('Built Mac sign-in helper for Apple Silicon and Intel.\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
