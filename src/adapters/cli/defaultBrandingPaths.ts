import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Estándar de branding de Quind: valores fijos (logo + paleta) que `init`
 * escribe por defecto en todo proyecto QA nuevo, para que cualquier reporte/
 * runner generado con esta herramienta se vea igual sin que nadie tenga que
 * configurarlo a mano. Decisión post-fase 6: esta herramienta es de uso
 * exclusivo interno de Quind (confirmado explícitamente antes de este
 * cambio) — grabar la marca de Quind como default fijo del código fuente ya
 * no tiene el problema que tenía cuando `qa-evidence-reporter` se trataba
 * como una herramienta genérica redistribuible (ver ARCHITECTURE.md,
 * "Cambios registrados", entrada de branding original, y el `.gitignore`
 * previo a este cambio).
 */
export const DEFAULT_BRANDING = {
  primaryColor: '#1e3543',
  accentColor: '#00c4e9',
  highlightColor: '#ffb91c',
  ctaColor: '#ff5530',
} as const;

/**
 * Ruta absoluta al logo estándar de Quind, distribuido dentro del paquete
 * (`branding/logo.png`, ver `package.json`, campo `"files"`). Misma técnica
 * de resolución que `DEFAULT_TEMPLATE_DIR` (`templatePaths.ts`): a partir de
 * `import.meta.url` de este archivo, nunca de `process.cwd()` (que en
 * tiempo de ejecución es el proyecto del QA, no la instalación del
 * paquete) — y sube 3 niveles porque este archivo vive en
 * `src/adapters/cli/` (o `dist/adapters/cli/` ya compilado), exactamente la
 * misma profundidad que `templatePaths.ts`.
 */
export const DEFAULT_BRANDING_LOGO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'branding',
  'logo.png',
);
