import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * Config de Vite (modo librería) para compilar `echarts.entry.js` a
 * `assets/echarts.custom.min.js` — el ÚNICO archivo `<script>` externo que
 * carga el reporte HTML (ver ARCHITECTURE.md/DESIGN.md: el reporte debe
 * seguir abriendo con `file://` sin red, así que este bundle viaja
 * físicamente dentro de `templates/default/assets/`, copiado a
 * `outputDir/assets/` por `ReportGenerator.generate()` igual que
 * `video-icon.svg`, nunca referenciado desde un CDN).
 *
 * Formato IIFE (no ES module): el reporte es HTML estático sin bundler
 * propio del lado del cliente — `<script src="assets/echarts.custom.min.js">`
 * necesita exponer `window.echarts` como global clásico para que los
 * scripts inline de los templates lo consuman, igual que cualquier librería
 * pre-2015 cargada por `<script>`.
 *
 * Salida gitignored (ver `.gitignore`): es un artefacto reproducible desde
 * `echarts.entry.js` + la versión de `echarts` fijada en `package.json`,
 * mismo criterio que `dist/` — se regenera con `npm run build:echarts`
 * (parte de `npm run build`), nunca se edita a mano.
 */
const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: rootDir,
  // `echarts`/`zrender` referencian `process.env.NODE_ENV` internamente
  // (patrón típico de librerías pensadas también para bundlers de Node) —
  // sin este `define`, Vite en modo librería no lo reemplaza en build time
  // (a diferencia del modo app), y el bundle final revienta con
  // "ReferenceError: process is not defined" apenas se ejecuta en un
  // browser real, que nunca tiene `process` global. Detectado corriendo el
  // bundle en un DOM headless ANTES de wirearlo al reporte, no en producción.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'assets',
    emptyOutDir: false,
    lib: {
      entry: 'echarts.entry.js',
      name: 'echarts',
      formats: ['iife'],
      fileName: () => 'echarts.custom.min.js',
    },
  },
});
