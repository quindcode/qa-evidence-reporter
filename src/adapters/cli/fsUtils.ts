import { access, stat } from 'node:fs/promises';

/** `true` si `path` existe (archivo o directorio), `false` en cualquier otro caso (incluyendo errores de permisos). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** `true` si `path` existe y es un directorio. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
