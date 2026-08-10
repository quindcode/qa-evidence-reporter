import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ruta absoluta al template `default` embebido en el paquete, EXACTA COPIA
 * de la lógica de `adapters/cli/templatePaths.ts` (mismo cálculo: 3 niveles
 * hacia arriba desde `import.meta.url` de ESTE archivo, nunca
 * `process.cwd()` — ver el JSDoc de ese archivo para el razonamiento
 * completo, que aplica exactamente igual aquí).
 *
 * Decisión de diseño (por qué se duplica en vez de importar desde
 * `adapters/cli`): ARCHITECTURE.md (regla de dependencia estricta) prohíbe
 * que `adapters/server/**` importe de `adapters/cli/**` (y viceversa) — "no
 * importan entre sí directamente". El cálculo es trivial (una constante) y
 * depende únicamente de la posición del propio archivo dentro del paquete
 * (`src/adapters/server/templatePaths.ts` está a la misma profundidad que
 * `src/adapters/cli/templatePaths.ts`, así que la misma cuenta de `..`
 * aplica), así que duplicarlo es preferible a violar esa regla o a mover
 * este cálculo a `core/**` (que no debería conocer rutas de filesystem del
 * paquete instalado — eso es responsabilidad de cada adapter).
 */
export const DEFAULT_TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'templates',
  'default',
);

/** `config.reportTemplate` (relativo a `projectRoot` si no es absoluto) o el template embebido del paquete. */
export function resolveTemplateDir(projectRoot: string, reportTemplate: string | null): string {
  if (!reportTemplate) return DEFAULT_TEMPLATE_DIR;
  return resolve(projectRoot, reportTemplate);
}
