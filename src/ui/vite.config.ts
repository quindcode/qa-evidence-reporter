import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/**
 * Config de Vite para `src/ui/` (fase 5b, Preact — ver ARCHITECTURE.md,
 * tabla de stack tecnológico y "Fase 5a": "Ruta esperada del build de
 * `ui/`").
 *
 * `root` se fija explícitamente al directorio de este archivo (en vez de
 * depender del cwd desde el que se invoque `vite`/`vite build`): así
 * `npm run build:ui`/`npm run dev:ui` funcionan sin importar desde qué
 * directorio se ejecute `npm run`, siempre y cuando se invoquen con
 * `--config src/ui/vite.config.ts` (ver los scripts en `package.json`).
 *
 * `build.outDir` es literalmente `../../dist/ui` (relativo a `root`,
 * `src/ui/`), que resuelve a `<raíz del paquete>/dist/ui` — la ruta EXACTA
 * que `adapters/server/uiPaths.ts` (`UI_DIST_DIR`) espera encontrar para
 * servir la SPA como estáticos en vez del placeholder. No usar otra ruta acá
 * desalinearía el build de la UI del server sin ningún error visible (el
 * server simplemente seguiría sirviendo el placeholder).
 */
const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Puerto del server Express contra el que proxysear en desarrollo
// (`npm run dev:ui`). Configurable con `QA_DEV_SERVER_PORT` para el caso en
// que `qa-config.json` del proyecto de prueba use un puerto distinto al
// default (`server.port: 3000`, ver ARCHITECTURE.md).
const devServerPort = Number(process.env.QA_DEV_SERVER_PORT ?? 3000);
const devServerTarget = `http://localhost:${devServerPort}`;

export default defineConfig({
  root: rootDir,
  plugins: [preact()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Los 3 prefijos que `adapters/server/app.ts` monta además de `/`
      // (ver `staticPrefixes.ts`): la API REST y los dos prefijos estáticos
      // (previews de evidencia y de reporte generado). Sin este proxy, la UI
      // corrida con `vite` (puerto 5173) no podría alcanzar el server real
      // (puerto 3000) por same-origin/CORS durante desarrollo.
      '/api': devServerTarget,
      '/evidence-files': devServerTarget,
      '/reports-static': devServerTarget,
    },
  },
});
