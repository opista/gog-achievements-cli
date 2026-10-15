import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { inject } from 'postject';

const execute = promisify(execFile);
const root = resolve('.');
const digest = (/** @type {Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const platform = process.platform;
const architecture = process.arch;
assert.ok(['darwin', 'win32'].includes(platform) && ['arm64', 'x64'].includes(architecture));
const portable = platform === 'darwin' && architecture === 'x64';
const target = `${platform === 'darwin' ? 'macos' : 'windows'}-${architecture}`;
const current = /** @type {{version: string}} */ (
  JSON.parse(await readFile('package.json', 'utf8'))
).version;
const [major, minor] = current.split('.').map(Number);
const latest = `${major}.${/** @type {number} */ (minor) + 1}.0`;
const template = resolve('dist', `gog-achievements-${current}-${target}`);
const executableName = platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements';
const productionExecutable = join(template, executableName);
const originalExecutableHash = digest(await readFile(productionExecutable));
const originalPackage = await readFile('package.json');
const helper = resolve('native/bin', platform === 'win32' ? 'gog-login.exe' : 'gog-login');
const temporary = await mkdtemp(join(tmpdir(), 'gog-full-update-flow-'));
await mkdir('.build', { recursive: true });
const evidence = await mkdtemp(resolve('.build', 'update-flow-proof-'));
/** @type {string[]} */
const transcript = [];
/** @type {{scenario: string, exit_code: number, stdout: string, stderr: string}[]} */
const commands = [];
const archiveName = `gog-achievements-${latest}-${target}.zip`;
const archive = join(temporary, `${archiveName}`);
let checksum = '';
let corruptChecksum = false;
let unavailable = false;
/** @type {string[]} */
const requests = [];
const server = createServer((request, response) => {
  try {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    const path = request.url ?? '';
    requests.push(path);
    if (path === '/repos/opista/gog-achievements-cli/releases/latest') {
      if (unavailable) {
        response.writeHead(503).end('Fixture release service unavailable');
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          draft: false,
          prerelease: false,
          tag_name: `v${latest}`,
          assets: [archiveName, `${archiveName}.sha256`].map((name) => ({
            name,
            state: 'uploaded',
          })),
        }),
      );
    } else if (
      path === `/opista/gog-achievements-cli/releases/download/v${latest}/${archiveName}.sha256`
    ) {
      response.end(`${corruptChecksum ? '0'.repeat(64) : checksum}  ${archiveName}\n`);
    } else if (
      path === `/opista/gog-achievements-cli/releases/download/v${latest}/${archiveName}`
    ) {
      createReadStream(archive).pipe(response);
    } else response.writeHead(404).end('Unexpected fixture request');
  } catch {
    response.writeHead(500).end('Fixture request validation failed');
  }
});

function log(/** @type {string} */ message) {
  transcript.push(message);
  process.stdout.write(message + '\n');
}

async function command(
  /** @type {string} */ executable,
  /** @type {string[]} */ args,
  /** @type {string} */ scenario,
  expected = 0,
) {
  let code = 0;
  let stdout = '';
  let stderr = '';
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE'].includes(key.toUpperCase()),
    ),
  );
  try {
    ({ stdout, stderr } = await execute(executable, args, {
      cwd: dirname(executable),
      env,
      timeout: 30000,
      maxBuffer: 256000,
      windowsHide: true,
    }));
  } catch (error) {
    assert.ok(
      error instanceof Error &&
        'code' in error &&
        typeof error.code === 'number' &&
        'stdout' in error &&
        'stderr' in error,
    );
    code = error.code;
    stdout = String(error.stdout);
    stderr = String(error.stderr);
  }
  commands.push({ scenario, exit_code: code, stdout, stderr });
  assert.equal(code, expected, `${scenario}: ${stderr || stdout}`);
  return { stdout, stderr };
}

async function terminalUpdate(
  /** @type {string} */ executable,
  /** @type {string} */ answer,
  /** @type {string} */ scenario,
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE'].includes(key.toUpperCase()),
    ),
  );
  const terminal = String.raw`
import errno, json, os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen([sys.argv[1], 'self', 'update'], stdin=slave, stdout=slave,
    stderr=slave, cwd=os.path.dirname(sys.argv[1]), close_fds=True, start_new_session=True)
os.close(slave)
output = bytearray()
answered = False
deadline = time.monotonic() + 20
try:
    while time.monotonic() < deadline:
        readable, _, _ = select.select([master], [], [], 0.1)
        if not readable:
            if child.poll() is not None:
                break
            continue
        try:
            part = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not part:
            break
        output.extend(part)
        if not answered and b'[y/N]' in output:
            answered = True
            os.write(master, (sys.argv[2] + '\n').encode())
    else:
        child.kill()
    code = child.wait(timeout=2)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
print(json.dumps({'exit_code': code, 'output': output.decode('utf-8', errors='replace'), 'answered': answered}))
`;
  const result = await execute('python3', ['-c', terminal, executable, answer], {
    cwd: dirname(executable),
    env,
    timeout: 30000,
    maxBuffer: 256000,
  });
  const data = /** @type {{exit_code: number, output: string, answered: boolean}} */ (
    JSON.parse(result.stdout)
  );
  commands.push({
    scenario,
    exit_code: data.exit_code,
    stdout: data.output,
    stderr: result.stderr,
  });
  assert.ok(
    data.answered,
    `The real CLI must show its terminal confirmation prompt: ${data.output}`,
  );
  assert.equal(data.exit_code, answer === 'n' ? 2 : 0, data.output);
  return data.output;
}

async function packageVersion(
  /** @type {string} */ version,
  /** @type {string} */ directory,
  /** @type {string} */ fixtureURL,
) {
  await mkdir(directory, { recursive: true });
  for (const name of [
    executableName,
    'build.json',
    'README.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses',
    ...(portable ? ['lib', 'native'] : []),
  ])
    await cp(join(template, name), join(directory, name), { recursive: true });
  const staging = await mkdtemp(join(temporary, 'bundle-'));
  const bundle = join(staging, 'main.cjs');
  const modules = resolve('.build/typescript/src');
  // Only this isolated test entry supplies a fixture transport and simulated
  // successful native login. Production CLI entry points have neither switch.
  await build({
    stdin: {
      contents: `
      import { runCLI } from ${JSON.stringify(join(modules, 'cli.mjs'))};
      import { formatOutput } from ${JSON.stringify(join(modules, 'output.mjs'))};
      import { CLIUpdater } from ${JSON.stringify(join(modules, 'adapters/updates/updater.mjs'))};
      const updates = new CLIUpdater({ request: (url, options) =>
        fetch(${JSON.stringify(fixtureURL)} + new URL(url).pathname, options) });
      const service = new Proxy({}, { get() { throw new Error('The fixture must not access GOG services.'); } });
      async function main() {
        const outcome = await runCLI(process.argv.slice(2), {
          updates, service,
          nativeLogin: async ({ progress }) => {
            progress('Simulated sign-in complete.');
            return { authenticated: true, user_id: '123', storage: 'fixture' };
          },
        });
        const output = outcome.format === 'text' && !outcome.result.ok ? process.stderr : process.stdout;
        output.write(formatOutput(outcome));
        process.exitCode = outcome.exitCode;
      }
      main().catch(() => { process.stderr.write('The isolated CLI fixture failed.\\n'); process.exitCode = 7; });
    `,
      resolveDir: root,
      sourcefile: 'isolated-update-fixture.mjs',
    },
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: { 'import.meta.url': '__gog_module_url', __GOG_DISTRIBUTION__: 'true' },
    banner: { js: "const __gog_module_url = require('node:url').pathToFileURL(__filename).href;" },
    plugins: [
      {
        name: 'fixture-version',
        setup(builder) {
          builder.onLoad({ filter: /[/\\]src[/\\]version\.mjs$/ }, () => ({
            contents: `export const VERSION = ${JSON.stringify(version)};`,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const executable = join(directory, executableName);
  if (portable) {
    await copyFile(bundle, join(directory, 'lib/main.cjs'));
  } else {
    const config = join(staging, 'sea.json');
    const blob = join(staging, 'sea.blob');
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
      maxBuffer: 1000000,
    });
    await rm(executable);
    await copyFile(process.execPath, executable);
    await chmod(executable, 0o755);
    if (platform === 'darwin')
      await execute('/usr/bin/codesign', ['--remove-signature', executable], { timeout: 10000 });
    await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
    });
    if (platform === 'darwin')
      await execute('/usr/bin/codesign', ['--force', '--sign', '-', executable], {
        timeout: 10000,
      });
  }
  const metadata = /** @type {Record<string, unknown>} */ (
    JSON.parse(await readFile(join(directory, 'build.json'), 'utf8'))
  );
  await writeFile(join(directory, 'build.json'), JSON.stringify({ ...metadata, version }) + '\n');
  return executable;
}

/** @type {Record<string, unknown>} */
const report = {
  platform,
  architecture,
  installed_version: current,
  simulated_release_version: latest,
  login: 'simulated successful native login; no GOG service access',
  result: 'running',
};
try {
  await execute(process.execPath, ['scripts/compile.mjs'], {
    cwd: root,
    timeout: 30000,
    maxBuffer: 1000000,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const fixtureURL = `http://127.0.0.1:${address.port}`;
  const installedDirectory = join(temporary, 'installed');
  const nextDirectory = join(temporary, `gog-achievements-${latest}-${target}`);
  const executable = await packageVersion(current, installedDirectory, fixtureURL);
  const nextExecutable = await packageVersion(latest, nextDirectory, fixtureURL);
  if (platform === 'darwin')
    await execute(
      '/usr/bin/ditto',
      ['-c', '-k', '--norsrc', '--keepParent', nextDirectory, archive],
      { timeout: 30000 },
    );
  else {
    const quote = (/** @type {string} */ value) => `'${value.replaceAll("'", "''")}'`;
    await execute(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -LiteralPath ${quote(nextDirectory)} -DestinationPath ${quote(archive)}`,
      ],
      { timeout: 120000 },
    );
  }
  checksum = digest(await readFile(archive));
  const before = digest(await readFile(executable));
  const nextHash = digest(await readFile(nextExecutable));
  assert.notEqual(before, nextHash);
  const queue =
    JSON.stringify({
      schema_version: 1,
      user_id: '123',
      game: { id: '1423049311', title: 'Update test', client_id: '53652320436400298' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      items: [],
    }) + '\n';
  const queuePath = join(installedDirectory, 'queue.json');
  await writeFile(queuePath, queue);
  const initial = await command(
    executable,
    ['--help', '--json'],
    'installed version before update',
  );
  assert.equal(JSON.parse(initial.stdout).data.version, current);
  assert.equal(requests.length, 0);

  const login = await command(executable, ['auth', 'login'], 'text login with newer release');
  assert.match(
    login.stderr,
    new RegExp(`A newer version is available \\(${latest.replaceAll('.', '\\.')}\\)`),
  );
  assert.match(login.stderr, /Run: gog-achievements self update/);
  assert.equal(requests.length, 1);
  log('PASS: simulated text login printed the newer-version notice on stderr.');
  log(login.stderr.trim());

  const jsonLogin = await command(
    executable,
    ['auth', 'login', '--json'],
    'JSON login does not check releases',
  );
  assert.equal(JSON.parse(jsonLogin.stdout).data.authenticated, true);
  assert.ok(!jsonLogin.stderr.includes('newer version'));
  assert.equal(requests.length, 1);
  log('PASS: JSON login stayed valid and made no update request.');

  const check = await command(
    executable,
    ['self', 'update', '--check', '--json'],
    'manual newer-version check',
  );
  assert.equal(JSON.parse(check.stdout).data.update_available, true);
  assert.equal(JSON.parse(check.stdout).data.can_update, true);
  const unapproved = await command(
    executable,
    ['self', 'update', '--json'],
    'update without confirmation',
    2,
  );
  assert.equal(JSON.parse(unapproved.stdout).error.code, 'UPDATE_CONFIRMATION_REQUIRED');
  assert.equal(digest(await readFile(executable)), before);
  log('PASS: check-only and unconfirmed commands preserved the old executable.');

  corruptChecksum = true;
  const rejected = await command(
    executable,
    ['self', 'update', '--yes', '--json'],
    'corrupt checksum is rejected',
    4,
  );
  assert.equal(JSON.parse(rejected.stdout).error.code, 'UPDATE_CHECKSUM_MISMATCH');
  assert.equal(digest(await readFile(executable)), before);
  assert.equal(await readFile(queuePath, 'utf8'), queue);
  assert.equal(
    (await readdir(installedDirectory)).some((name) => name.startsWith('.gog-achievements-')),
    false,
  );
  corruptChecksum = false;
  log('PASS: a bad checksum blocked installation and left the old CLI and queue intact.');

  const updated = await command(
    executable,
    ['self', 'update', '--yes', '--json'],
    'running CLI replaces itself',
  );
  const data =
    /** @type {{updated: boolean, current_version: string, previous_version: string, backup_directory: string}} */ (
      JSON.parse(updated.stdout).data
    );
  assert.equal(data.updated, true);
  assert.equal(data.previous_version, current);
  assert.equal(data.current_version, latest);
  const after = digest(await readFile(executable));
  assert.equal(after, nextHash);
  assert.notEqual(after, before);
  const newHelp = await command(executable, ['--help', '--json'], 'new executable version');
  assert.equal(JSON.parse(newHelp.stdout).data.version, latest);
  const backupExecutable = join(data.backup_directory, executableName);
  assert.equal(digest(await readFile(backupExecutable)), before);
  const backupHelp = await command(
    backupExecutable,
    ['--help', '--json'],
    'old executable still runs from backup',
  );
  assert.equal(JSON.parse(backupHelp.stdout).data.version, current);
  assert.equal(await readFile(queuePath, 'utf8'), queue);
  const readQueue = await command(
    executable,
    ['queue', 'show', '--file', queuePath, '--json'],
    'new CLI reads preserved queue',
  );
  assert.deepEqual(JSON.parse(readQueue.stdout).data, JSON.parse(queue));
  log(
    `PASS: the running CLI replaced itself from ${current} to ${latest}; the new binary hash matches the downloaded package.`,
  );
  log(`PASS: the backup still reports ${current}, and the preserved queue works with ${latest}.`);

  if (platform === 'darwin') {
    const interactiveDirectory = join(temporary, 'interactive-install');
    await cp(data.backup_directory, interactiveDirectory, { recursive: true });
    const interactiveExecutable = join(interactiveDirectory, executableName);
    await writeFile(join(interactiveDirectory, 'queue.json'), queue);
    const declined = await terminalUpdate(
      interactiveExecutable,
      'n',
      'real terminal prompt: decline',
    );
    assert.match(declined, /UPDATE_CONFIRMATION_REQUIRED/);
    assert.equal(digest(await readFile(interactiveExecutable)), before);
    const accepted = await terminalUpdate(
      interactiveExecutable,
      'y',
      'real terminal prompt: accept and replace',
    );
    assert.ok(accepted.includes(`Updated gog-achievements from ${current} to ${latest}`));
    assert.equal(digest(await readFile(interactiveExecutable)), nextHash);
    assert.equal(await readFile(join(interactiveDirectory, 'queue.json'), 'utf8'), queue);
    const interactiveHelp = await command(
      interactiveExecutable,
      ['--help', '--json'],
      'interactive update installed the newer executable',
    );
    assert.equal(JSON.parse(interactiveHelp.stdout).data.version, latest);
    report.interactive_confirmation = 'decline and accept passed in a real pseudo-terminal';
    log(
      'PASS: the real terminal prompt preserved the old CLI on No, then installed the new CLI on Yes.',
    );
  }

  const currentLogin = await command(
    executable,
    ['auth', 'login'],
    'updated text login does not show an update notice',
  );
  assert.ok(!currentLogin.stderr.includes('newer version'));
  const noUpdate = await command(
    executable,
    ['self', 'update', '--yes', '--json'],
    'repeat update is a no-op',
  );
  assert.equal(JSON.parse(noUpdate.stdout).data.updated, false);
  assert.equal(JSON.parse(noUpdate.stdout).data.update_available, false);
  assert.equal(digest(await readFile(executable)), after);
  unavailable = true;
  const unavailableLogin = await command(
    executable,
    ['auth', 'login', '--json'],
    'JSON login with release service unavailable',
  );
  assert.equal(JSON.parse(unavailableLogin.stdout).data.authenticated, true);
  const textUnavailable = await command(
    executable,
    ['auth', 'login'],
    'release failure does not break text login',
  );
  assert.ok(!textUnavailable.stderr.includes('newer version'));
  log(
    'PASS: after the update there is no notice; another update is a no-op; release-service failure keeps login successful.',
  );

  assert.equal(digest(await readFile(productionExecutable)), originalExecutableHash);
  assert.deepEqual(await readFile('package.json'), originalPackage);
  Object.assign(report, {
    result: 'passed',
    before_sha256: before,
    after_sha256: after,
    backup_sha256: before,
    release_archive_sha256: checksum,
    queue_preserved: true,
    backup_runs: true,
    production_files_preserved: true,
  });
} catch (error) {
  Object.assign(report, {
    result: 'failed',
    error: error instanceof Error ? error.message : 'Unknown failure',
  });
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    join(evidence, 'report.json'),
    JSON.stringify({ ...report, commands, release_requests: requests }, null, 2) + '\n',
  );
  await writeFile(join(evidence, 'transcript.txt'), transcript.join('\n') + '\n');
  log(`Evidence: ${join(evidence, 'report.json')}`);
  if (report.result !== 'passed')
    process.stderr.write(`Full update flow failed: ${String(report.error)}\n`);
}
