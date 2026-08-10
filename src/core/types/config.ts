import { z } from 'zod';

/**
 * Esquema de `qa-config.json` (ver ARCHITECTURE.md, "Formato de
 * `qa-config.json`"). Es la única fuente de verdad para la forma de
 * `QaConfig`: el tipo se infiere de este esquema (`z.infer`) en vez de
 * mantener una `interface` escrita a mano por separado, para que agregar o
 * cambiar un campo nunca pueda desincronizar tipo y validación runtime.
 *
 * Decisión de diseño (`.prefault()` vs `.default()` en los objetos
 * anidados `server`/`evidence`/`logging`): en Zod v4, `.default(valor)`
 * sustituye el input `undefined` por `valor` TAL CUAL, sin volver a pasarlo
 * por el schema envuelto — es decir, `z.object({ port: z.number().default(3000) }).default({})`
 * parseado sobre `undefined` da `{}`, NO `{ port: 3000 }` (se comprobó este
 * comportamiento manualmente antes de escribir este archivo). `.prefault(valor)`,
 * en cambio, SÍ vuelve a correr `valor` por el schema interno, aplicando sus
 * propios defaults por campo. Como el caso que necesitamos soportar es
 * justamente "config parcial" (p. ej. `{ "server": { "port": 5000 } }` sin
 * `openBrowser`, que debe completarse con el default `true` de
 * `openBrowser`), se usa `.prefault({})` en los tres objetos anidados. Los
 * campos hoja (strings/arrays/enums de nivel superior o dentro de esos
 * objetos) no necesitan esta distinción porque no tienen, a su vez, campos
 * anidados con sus propios defaults.
 */

/** Nombre de proyecto genérico usado cuando `qa-config.json` no define `projectName` (no debería pasar en la práctica: `init` siempre lo escribe explícitamente a partir del nombre de carpeta o `--name`). Se documenta como decisión: `projectName` NO es obligatorio a nivel esquema (una config parcial hecha a mano sigue siendo válida), pero sí tiene un default genérico en vez de fallar la validación. */
export const DEFAULT_PROJECT_NAME = 'Mi Proyecto QA';

/** Formatos de evidencia soportados por defecto (ver `core/types/evidence.ts`, `EXTENSION_TO_KIND`: coincide exactamente con sus claves). */
export const DEFAULT_ALLOWED_EVIDENCE_FORMATS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'mp4',
  'webm',
  'pdf',
] as const;

/** Niveles soportados por `core/logger` — coinciden 1:1 con los métodos de la interfaz `Logger` (`core/types/logger.ts`); no se exponen `'trace'`/`'fatal'` de `pino` porque `Logger` no los modela. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  openBrowser: z.boolean().default(true),
});

const EvidenceConfigSchema = z.object({
  maxFileSizeMB: z.number().positive().default(50),
  allowedFormats: z.array(z.string()).default([...DEFAULT_ALLOWED_EVIDENCE_FORMATS]),
});

const LoggingConfigSchema = z.object({
  level: z.enum(LOG_LEVELS).default('info'),
});

/**
 * Esquema completo de `qa-config.json`. Cualquier clave desconocida en el
 * JSON de entrada (p. ej. `"$schema"`, presente en el archivo que escribe
 * `init` como hint para el editor) se descarta silenciosamente al parsear
 * (comportamiento por defecto de `z.object()` en Zod v4: "strip"), en vez de
 * hacer fallar la validación — así el propio `$schema` documentado en
 * ARCHITECTURE.md no rompe `loadConfig()`.
 */
export const QaConfigSchema = z.object({
  projectName: z.string().min(1).default(DEFAULT_PROJECT_NAME),
  team: z.array(z.string()).default([]),
  featuresDir: z.string().min(1).default('features'),
  evidenceDir: z.string().min(1).default('evidence'),
  reportsDir: z.string().min(1).default('reports'),
  server: ServerConfigSchema.prefault({}),
  evidence: EvidenceConfigSchema.prefault({}),
  logging: LoggingConfigSchema.prefault({}),
  /** Ruta a un `templateDir` custom, o `null` para usar el template embebido (`templates/default`) — ver `adapters/cli`. */
  reportTemplate: z.string().nullable().default(null),
});

/** Tipo inferido del esquema — única fuente de verdad, ver JSDoc de `QaConfigSchema`. */
export type QaConfig = z.infer<typeof QaConfigSchema>;

/** Nivel de log soportado, reexportado para que `core/logger` no necesite importar `zod` solo para tipar `level`. */
export type LogLevel = (typeof LOG_LEVELS)[number];
