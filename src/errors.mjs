export class GogError extends Error {
  constructor(code, message, exitCode = 4, details) {
    super(message);
    this.name = 'GogError';
    this.code = code;
    this.exitCode = exitCode;
    if (details !== undefined) this.details = details;
  }
}

export function requireValue(condition, code, message, exitCode = 2, details) {
  if (!condition) throw new GogError(code, message, exitCode, details);
}

export function errorResult(error) {
  if (!(error instanceof GogError)) {
    // Fetch, process and filesystem errors can contain credentials or URLs.
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The command failed. No account change was confirmed.' } };
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
