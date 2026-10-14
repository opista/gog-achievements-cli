export async function withLoginSignals<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abort = new AbortController();
  const onInterrupt = () => abort.abort();
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  try {
    return await operation(abort.signal);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
}
