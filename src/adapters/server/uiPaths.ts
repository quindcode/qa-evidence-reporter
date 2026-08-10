import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ruta absoluta esperada del build de `src/ui/` (fase 5b, Preact + Vite —
 * ver ARCHITECTURE.md, tabla de stack tecnológico). Se fija en
 * `<raíz del paquete>/dist/ui`, NO dentro de `src/ui/dist` ni de
 * `dist/ui-assets`, por dos motivos:
 *
 * 1. Co-ubicación con `dist/` (backend compilado): `package.json` ya declara
 *    `"files": ["dist", "templates"]` (fase 4) — cualquier cosa que quede
 *    bajo `dist/` se publica automáticamente con `npm publish` sin tocar ese
 *    campo. Un `outDir` separado (p. ej. `ui-dist/`) obligaría a agregar una
 *    entrada más a `files` y a mantenerla sincronizada.
 * 2. Resolución simétrica a `templatePaths.ts`: este archivo vive en
 *    `src/adapters/server/uiPaths.ts` → `dist/adapters/server/uiPaths.js`
 *    una vez compilado, exactamente 3 niveles bajo la raíz del paquete tanto
 *    en `src/` (tests) como en `dist/` (binario real) — la misma cuenta de
 *    `..` que usa `DEFAULT_TEMPLATE_DIR` llega a la raíz del paquete, y desde
 *    ahí se desciende a `dist/ui` (no a `templates/`).
 *
 * Fase 5b (`ui/`, Vite + `@preact/preset-vite`) debe configurar
 * `build.outDir` para que apunte exactamente a esta ruta (relativo a
 * `src/ui/`, sería `../../dist/ui`).
 */
export const UI_DIST_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'dist',
  'ui',
);

/**
 * HTML mínimo servido en `/` (y cualquier ruta no-API de la SPA) cuando
 * `UI_DIST_DIR` todavía no existe — el caso normal durante toda la fase 5a,
 * porque `ui/` recién se construye en la fase 5b. Evita un 404 "feo" o un
 * crash de `express.static` contra un directorio inexistente: es una
 * respuesta 200 explícita y legible en vez de un error.
 */
export const UI_NOT_BUILT_PLACEHOLDER_HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>qa-evidence-reporter</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: system-ui, sans-serif;
        max-width: 40rem;
        margin: 4rem auto;
        padding: 0 1.5rem;
        line-height: 1.5;
        color: #1a1a1a;
      }
      code {
        background: #f0f0f0;
        padding: 0.15rem 0.4rem;
        border-radius: 0.25rem;
      }
    </style>
  </head>
  <body>
    <h1>UI aún no construida</h1>
    <p>
      El servidor de <code>qa-evidence-reporter</code> está corriendo, pero el build de la
      interfaz (<code>src/ui/</code>, Preact + Vite) todavía no existe en este paquete.
    </p>
    <p>Corré la build de <code>ui/</code> (<code>npm run build:ui</code>) y volvé a cargar esta página.</p>
    <p>Mientras tanto, la API REST sigue disponible bajo <code>/api/*</code>.</p>
  </body>
</html>
`;
