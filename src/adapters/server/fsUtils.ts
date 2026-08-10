import { access } from 'node:fs/promises';

/**
 * `true` si `path` existe (archivo o directorio). Copia mínima de
 * `adapters/cli/fsUtils.ts` (mismo cuerpo) — se duplica en vez de importar
 * desde `adapters/cli` por la regla de dependencia estricta de
 * ARCHITECTURE.md ("`adapters/cli/**` y `adapters/server/**` ... nunca
 * entre sí directamente"), igual que `templatePaths.ts` en este mismo
 * módulo.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
