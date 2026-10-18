import { open, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GogError } from '../domain/errors.mjs';
import { errorCode } from '../domain/objects.mjs';

export async function writeExportFile(path: string, data: string): Promise<string> {
  const target = resolve(path);
  const temporary = `${target}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await file.writeFile(data, 'utf8');
    } finally {
      await file.close();
    }
    // Publish only the complete file. A concurrent export cannot replace it.
    await link(temporary, target);
    return target;
  } catch (error) {
    const exists = errorCode(error) === 'EEXIST';
    throw new GogError(
      exists ? 'EXPORT_EXISTS' : 'EXPORT_WRITE_FAILED',
      exists
        ? 'The export file already exists. Use another file.'
        : 'Cannot save the export file. Check the path and file permissions.',
      2,
    );
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
