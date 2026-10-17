import type { ProcessOptions, ProcessResult } from '../../application/ports.mjs';
import { errorCode } from '../../domain/objects.mjs';
import { spawn } from 'node:child_process';
import { GogError } from '../../domain/errors.mjs';

// Helpers use private pipes. Raw process errors and stderr can contain secrets.
export async function runProcess(
  command: string,
  args: string[],
  input = '',
  {
    timeoutMs = 5000,
    maxOutputBytes = 128_000,
    windowsHide = true,
    signal,
    spawnImpl = spawn,
  }: ProcessOptions = {},
): Promise<ProcessResult> {
  if (signal?.aborted)
    throw new GogError('PROCESS_CANCELLED', 'The native command was cancelled.', 7);
  return new Promise<ProcessResult>((resolve, reject) => {
    let child: ReturnType<NonNullable<ProcessOptions['spawnImpl']>>;
    try {
      child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide });
    } catch {
      reject(new GogError('PROCESS_FAILED', 'Cannot start a required native command.', 7));
      return;
    }
    let stdout = '';
    let outputBytes = 0;
    let problem: GogError | undefined;
    let finished = false;
    const stop = (code: string, message: string) => {
      problem ??= new GogError(code, message, 7);
      child.kill('SIGKILL');
    };
    const onAbort = () => stop('PROCESS_CANCELLED', 'The native command was cancelled.');
    const timer = setTimeout(
      () => stop('PROCESS_TIMEOUT', 'The native command timed out.'),
      timeoutMs,
    );
    const finish = (error: GogError | undefined, code: number | null = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (problem) reject(problem);
      else resolve({ code, stdout });
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part: string) => {
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
          errorCode(error) === 'ENOENT' ? 'PROCESS_MISSING' : 'PROCESS_FAILED',
          'Cannot start a required native command.',
          7,
        ),
      ),
    );
    child.on('close', (code: number | null) => finish(undefined, code));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdin.end(input);
  });
}
