import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ruta absoluta al template `default` que se distribuye DENTRO del paquete
 * (`templates/default`, ver ARCHITECTURE.md — es el árbol que consume
 * `createHandlebarsTemplateEngine` de `core/report`). Se resuelve a partir
 * de `import.meta.url` de ESTE archivo, NUNCA de `process.cwd()`: el comando
 * `report` (`adapters/cli/commands/report.ts`) corre con el cwd del
 * PROYECTO del QA (donde vive su `qa-config.json`/`features/`/etc.), que no
 * tiene ninguna relación con dónde quedó instalado `qa-evidence-reporter`
 * (`node_modules/qa-evidence-reporter/...` en una instalación global o
 * local). Si se resolviera contra el cwd, `qa-evidence-reporter report`
 * fallaría al no encontrar `templates/` ahí.
 *
 * Este archivo vive en `src/adapters/cli/templatePaths.ts` y compila a
 * `dist/adapters/cli/templatePaths.js` (ver `tsconfig.json`:
 * `rootDir: "src"`, `outDir: "dist"` — la estructura de `dist/` es un espejo
 * exacto de `src/`). En ambos casos el archivo queda exactamente 3 niveles
 * bajo la raíz del paquete (`src/adapters/cli/` o `dist/adapters/cli/`), así
 * que subir 3 niveles desde `dirname(import.meta.url)` llega a la raíz del
 * paquete tanto en desarrollo (tests corriendo sobre `src/`) como en
 * producción (`node dist/adapters/cli/index.js` ya compilado, incluyendo
 * cuando el paquete está instalado como dependencia de otro proyecto, ya que
 * `templates/` se publica junto con `dist/` — ver `package.json`).
 */
export const DEFAULT_TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'templates',
  'default',
);
