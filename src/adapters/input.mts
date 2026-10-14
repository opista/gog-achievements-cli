import type { InputStream, ProcessRunner } from '../application/ports.mjs';
import { GogError, requireValue } from '../domain/errors.mjs';
export async function readStdin(input: InputStream): Promise<string> {
  requireValue(
    !input.isTTY,
    'STDIN_REQUIRED',
    'Pipe the login value through stdin. The CLI will not prompt.',
  );
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      input.pause();
    };
    const onData = (chunk: Buffer | string) => {
      value += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (value.length > 16_000) {
        cleanup();
        reject(new GogError('INPUT_TOO_LARGE', 'Login input exceeds 16 KB.', 2));
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(value);
    };
    const onError = () => {
      cleanup();
      reject(new GogError('STDIN_FAILED', 'Cannot read login input.', 2));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new GogError('STDIN_TIMEOUT', 'No complete login input was received within 30 seconds.', 2),
      );
    }, 30_000);
    input.on('data', onData).once('end', onEnd).once('error', onError);
    input.resume();
  });
}
export async function readClipboard(
  platform: string,
  execute: ProcessRunner,
  helperPath: (platform: string) => string,
): Promise<string> {
  requireValue(
    ['darwin', 'win32'].includes(platform),
    'UNSUPPORTED_PLATFORM',
    'Clipboard login supports macOS and Windows.',
    7,
  );
  const clipboard = await execute(
    platform === 'darwin' ? '/usr/bin/pbpaste' : helperPath(platform),
    platform === 'darwin' ? [] : ['--clipboard'],
  );
  requireValue(clipboard.code === 0, 'CLIPBOARD_FAILED', 'Cannot read the clipboard.', 7);
  return clipboard.stdout;
}
