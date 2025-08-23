import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes aggregated content to a file on disk.
 * - Ensures parent directory exists
 * - Honors overwrite flag
 * - Always writes UTF-8 text
 */
export async function writeExport(absoluteOutputPath: string, content: string, overwrite?: boolean): Promise<{ bytes: number }> {
  const parent = path.dirname(absoluteOutputPath);
  try {
    await fs.promises.mkdir(parent, { recursive: true });
  } catch {
    // Ignore mkdir errors; write will surface if critical
  }

  try {
    const st = await fs.promises.stat(absoluteOutputPath);
    if (st.isFile() && overwrite !== true) {
      throw Object.assign(new Error('File exists; set overwrite=true to replace'), { code: 'EEXIST' });
    }
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      // If it's some other error (not "doesn't exist"), rethrow
      if (e?.code === 'EEXIST') throw e;
    }
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  await fs.promises.writeFile(absoluteOutputPath, content, 'utf8');
  return { bytes };
}