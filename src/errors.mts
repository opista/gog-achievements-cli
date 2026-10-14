import type { PublicError, Failure } from './types.mjs';
export class GogError extends Error {
  declare code: string;
  declare exitCode: number;
  declare details?: PublicError['details'];
  constructor(code: string, message: string, exitCode = 4, details?: PublicError['details']) {
    super(message);
    this.name = 'GogError';
    this.code = code;
    this.exitCode = exitCode;
    if (details !== undefined) this.details = details;
  }
}

export function requireValue(
  condition: unknown,
  code: string,
  message: string,
  exitCode = 2,
  details?: PublicError['details'],
): asserts condition {
  if (!condition) throw new GogError(code, message, exitCode, details);
}

export function errorResult(error: unknown): Failure {
  if (!(error instanceof GogError)) {
    // Fetch, process and filesystem errors can contain credentials or URLs.
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The command failed. No account change was confirmed.',
      },
    };
  }
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
