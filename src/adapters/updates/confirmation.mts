import { createInterface } from 'node:readline/promises';
import type { InputStream, OutputStream } from '../../application/ports.mjs';

export async function confirmUpdate(question: string, input: InputStream, output: OutputStream) {
  if (!input.isTTY) return false;
  const lines = createInterface({ input, terminal: false });
  try {
    output.write(question);
    const answer = await lines.question('');
    return /^(y|yes)$/i.test(answer.trim());
  } catch {
    return false;
  } finally {
    lines.close();
  }
}
