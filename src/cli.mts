import type {
  InputStream,
  OutputStream,
  ProcessRunner,
  NativeLoginOptions,
  AuthStatus,
} from './application/ports.mjs';
import type { CLIOutcome } from './cli/contracts.mjs';
import { GogAchievements } from './service.mjs';
import { readQueue, saveQueue, withQueueLock } from './adapters/queue-files.mjs';
import { runProcess } from './adapters/native/process.mjs';
import { loginWithNativeWindow } from './adapters/native/native-login.mjs';
import { nativeHelperPath, isPackaged } from './adapters/native/assets.mjs';
import { readStdin, readClipboard } from './adapters/input.mjs';
import { withLoginSignals } from './adapters/native/login-lifecycle.mjs';
import { dispatchCLI } from './cli/handlers.mjs';
import type { CLIService } from './cli/handlers.mjs';
export { HELP } from './cli/definitions.mjs';
export type { CLIService } from './cli/handlers.mjs';
export interface CLIOptions {
  service?: CLIService;
  stdin?: InputStream;
  stderr?: OutputStream;
  execute?: ProcessRunner;
  platform?: string;
  nativeLogin?: (options: NativeLoginOptions & { service: CLIService }) => Promise<AuthStatus>;
}
export async function runCLI(
  args: string[],
  {
    service = new GogAchievements(),
    stdin = process.stdin,
    stderr = process.stderr,
    execute = runProcess,
    platform = process.platform,
    nativeLogin = loginWithNativeWindow,
  }: CLIOptions = {},
): Promise<CLIOutcome> {
  return dispatchCLI(args, {
    service,
    stderr,
    platform,
    isPackaged,
    systemInfo: () => ({ node: process.versions.node, architecture: process.arch }),
    files: { read: readQueue, save: saveQueue, withLock: withQueueLock },
    readInput: (mode) =>
      mode === 'clipboard' ? readClipboard(platform, execute, nativeHelperPath) : readStdin(stdin),
    nativeLogin: (options) => withLoginSignals((signal) => nativeLogin({ ...options, signal })),
  });
}
