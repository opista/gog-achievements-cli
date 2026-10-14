/** @typedef {{name: string, platform: string, architecture: string}} BuildTarget */
/** @type {readonly Readonly<BuildTarget>[]} */
export const BUILD_TARGETS = Object.freeze(
  [
    { name: 'macos-arm64', platform: 'darwin', architecture: 'arm64' },
    { name: 'macos-x64', platform: 'darwin', architecture: 'x64' },
    { name: 'windows-arm64', platform: 'win32', architecture: 'arm64' },
    { name: 'windows-x64', platform: 'win32', architecture: 'x64' },
  ].map((target) => Object.freeze(target)),
);

const targetNames = BUILD_TARGETS.map(({ name }) => name).join(', ');

export const BUILD_HELP = `Usage: npm run build -- [--target TARGET] [--help]

Build one distribution, run native checks, and create its ZIP and checksum.
Default: the current OS and Node architecture.

Targets:
${BUILD_TARGETS.map(({ name }) => `  ${name}`).join('\n')}

Each target requires its OS and matching Node architecture.
Other target files in dist/ are kept.
`;

/** @param {string[]} args */
export function parseBuildArguments(args) {
  let target;
  let help = false;
  for (let index = 0; index < args.length; index++) {
    const argument = /** @type {string} */ (args[index]);
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--target' || argument.startsWith('--target=')) {
      if (target !== undefined) throw new Error('Use --target only once.');
      target = argument === '--target' ? args[++index] : argument.slice('--target='.length);
      if (!target || target.startsWith('-')) throw new Error('--target requires a target name.');
    } else {
      throw new Error(`Unknown build argument: ${argument}. Use --help for build options.`);
    }
  }
  return { target, help };
}

/** @param {string | undefined} name
 * @param {{platform?: string, architecture?: string}} [options] */
export function selectBuildTarget(
  name,
  { platform = process.platform, architecture = process.arch } = {},
) {
  const target = name === undefined ? undefined : BUILD_TARGETS.find((item) => item.name === name);
  if (name !== undefined && !target)
    throw new Error(`Unknown build target: ${name}. Choose ${targetNames}.`);
  const host = BUILD_TARGETS.find(
    (item) => item.platform === platform && item.architecture === architecture,
  );
  if (!host) throw new Error('Build on macOS or Windows using arm64 or x64 Node.');
  if (target && target !== host)
    throw new Error(
      `Target ${target.name} requires ${target.platform === 'darwin' ? 'macOS' : 'Windows'} with ${target.architecture} Node. The current runtime is ${host.name}. Run this build on a matching native runner.`,
    );
  return target ?? host;
}
