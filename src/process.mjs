import { spawn } from 'node:child_process';
import { GogError } from './errors.mjs';

// Helpers use private pipes. Raw process errors and stderr can contain secrets.
export async function runProcess(
  command,
  args,
  input = '',
  { timeoutMs = 5000, maxOutputBytes = 128_000, signal, spawnImpl = spawn } = {},
) {
  if (signal?.aborted)
    throw new GogError('PROCESS_CANCELLED', 'The native command was cancelled.', 7);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      reject(new GogError('PROCESS_FAILED', 'Cannot start a required native command.', 7));
      return;
    }
    let stdout = '';
    let outputBytes = 0;
    let problem;
    let finished = false;
    const stop = (code, message) => {
      problem ??= new GogError(code, message, 7);
      child.kill('SIGKILL');
    };
    const onAbort = () => stop('PROCESS_CANCELLED', 'The native command was cancelled.');
    const timer = setTimeout(
      () => stop('PROCESS_TIMEOUT', 'The native command timed out.'),
      timeoutMs,
    );
    const finish = (error, code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error || problem) reject(error ?? problem);
      else resolve({ code, stdout });
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part) => {
      outputBytes += Buffer.byteLength(part, 'utf8');
      if (outputBytes > maxOutputBytes)
        stop('PROCESS_OUTPUT_LIMIT', 'The native command returned too much data.');
      else stdout += part;
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', (error) =>
      finish(
        new GogError(
          error.code === 'ENOENT' ? 'PROCESS_MISSING' : 'PROCESS_FAILED',
          'Cannot start a required native command.',
          7,
        ),
      ),
    );
    child.on('close', (code) => finish(undefined, code));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdin.end(input);
  });
}
