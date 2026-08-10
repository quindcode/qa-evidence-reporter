/**
 * Tipo de archivo de evidencia, clasificado únicamente a partir de su
 * extensión (ver `resolveEvidenceKind`). `'other'` es el fallback para
 * cualquier extensión no reconocida — nunca se rechaza un archivo por su
 * `kind` en `core/evidence` (ver nota de diseño en `EvidenceStore` abajo).
 */
export type EvidenceKind = 'image' | 'video' | 'pdf' | 'other';

/**
 * Metadata de un archivo de evidencia ya guardado por un `EvidenceStore`.
 */
export interface EvidenceFile {
  /**
   * Id determinístico y corto (hash), NO un uuid aleatorio: se deriva de
   * `featureId + scenarioId + stepId + originalFilename` (ver
   * `core/evidence/evidenceStore.ts`). Esto permite reconstruir/recuperar
   * `EvidenceFile[]` completos escaneando el filesystem sin necesitar un
   * índice separado (ver JSDoc de `EvidenceStore.list`/`getThumbnail`).
   *
   * Consecuencia documentada: subir dos veces un archivo con el mismo
   * `originalFilename` para el mismo step produce el mismo id (y por lo
   * tanto sobrescribe el primero en disco) — es una simplificación
   * deliberada para esta fase; deduplicar con sufijos (`-2`, `-3`, ...)
   * queda para una fase futura si se necesita.
   */
  id: string;
  /** Nombre de archivo tal cual lo subió el QA (sin sanitizar: se preserva para mostrarlo en la UI/reporte). */
  originalFilename: string;
  /**
   * Ruta donde quedó guardado el archivo físico, RELATIVA al `baseDir` que
   * se le pasó a `createEvidenceStore` (ej. `"evidence/f0-login/.../foto.png"`).
   * Se guarda relativa (no absoluta) porque el server (fase 5) sirve
   * `evidence/` como estáticos y el reporte (fase 3) copia estos archivos a
   * `reports/assets/evidence/...`: ambos consumidores necesitan una ruta
   * portable, no un path absoluto del filesystem de quien generó la sesión.
   */
  path: string;
  kind: EvidenceKind;
  sizeBytes: number;
  /** Ruta relativa al thumbnail (mismo criterio que `path`). Solo para `kind === 'image'`. */
  thumbnailPath?: string;
  /** ISO 8601. */
  uploadedAt: string;
}

/** Input de `EvidenceStore.save`. */
export interface SaveEvidenceInput {
  featureId: string;
  scenarioId: string;
  stepId: string;
  originalFilename: string;
  buffer: Buffer;
}

/**
 * Puerto (interfaz) para guardar y consultar archivos de evidencia
 * (capturas, videos, PDFs) adjuntados a un step durante la ejecución
 * manual.
 *
 * Decisión de diseño (qué NO valida `EvidenceStore`): ni el tamaño máximo
 * (`qa-config.json` → `evidence.maxFileSizeMB`) ni el formato permitido
 * (`evidence.allowedFormats`) se validan aquí. `core/evidence` no conoce
 * `qa-config.json` (esa dependencia es de `core/config`, fase 4, y el único
 * consumidor que las cruza es `adapters/server` en fase 5, que sí conoce
 * ambos). `save` simplemente clasifica el `kind` con `resolveEvidenceKind`
 * (usando `'other'` para lo que no reconoce, nunca rechazando) y persiste
 * el archivo tal cual se lo pasaron. Si el caller necesita rechazar un
 * archivo por tamaño, debe chequear `buffer.length` ANTES de llamar a
 * `save` y lanzar `EvidenceFileTooLargeError` (`core/types/errors.ts`) él
 * mismo; si necesita rechazar por formato no permitido, debe chequear la
 * extensión contra `allowedFormats` antes de llamar a `save`.
 */
export interface EvidenceStore {
  /**
   * Copia `input.buffer` a
   * `evidence/{featureId}/{scenarioId}/{stepId}/{originalFilename}` (bajo
   * `baseDir`), creando los directorios necesarios. Si `kind === 'image'`,
   * genera además un thumbnail junto al original. Ver
   * `core/evidence/evidenceStore.ts` para el detalle de por qué
   * `featureId`/`scenarioId`/`stepId` (la misma terna que devuelve
   * `SessionEngine.getCurrentStep()`, ver `core/types/session.ts`) son
   * directamente los nombres de carpeta.
   */
  save(input: SaveEvidenceInput): Promise<EvidenceFile>;

  /**
   * Devuelve la ruta (relativa a `baseDir`) del thumbnail de
   * `evidenceFileId`, o `null` si el archivo no existe o no tiene
   * thumbnail (video/pdf/other, o una imagen cuyo thumbnail no se pudo
   * generar).
   */
  getThumbnail(evidenceFileId: string): Promise<string | null>;

  /**
   * Lista las evidencias guardadas para un step.
   *
   * Decisión de diseño: `SessionState` (ver `core/types/session.ts`) YA
   * guarda `evidenceFileIds` por step, lo que en el caso normal hace esta
   * lista "redundante" (quien arma la vista de un step podría simplemente
   * cruzar `session.json` con los `EvidenceFile` ya conocidos). Se
   * implementa igual como un escaneo real del directorio del step en el
   * filesystem (fuente de verdad independiente de `session.json`) — no un
   * espejo en memoria de lo que `save()` devolvió — precisamente para el
   * caso en que `session.json` se corrompa o pierda parcialmente: mientras
   * los archivos físicos sigan en `evidence/`, `list` puede reconstruir su
   * metadata (incluyendo el mismo `id` determinístico) sin depender de la
   * sesión. `stepId` aquí es el mismo `StepExecution.id` de `core/types/session.ts`.
   */
  list(stepId: string): Promise<EvidenceFile[]>;
}

/**
 * Registro extensible extensión→kind. Un objeto plano (no un `Map`) porque
 * se define una sola vez como constante estática y un objeto literal es más
 * simple de extender/leer que construir un `Map` a partir de entries.
 * Ampliar formatos soportados (p. ej. `'heic'`) es agregar una línea aquí,
 * sin tocar ningún `if/else` disperso por el código.
 */
export const EXTENSION_TO_KIND: Readonly<Record<string, EvidenceKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  mp4: 'video',
  webm: 'video',
  pdf: 'pdf',
};

/**
 * Clasifica una extensión de archivo (con o sin el `.` inicial,
 * case-insensitive) a su `EvidenceKind`. Cualquier extensión no presente en
 * `EXTENSION_TO_KIND` devuelve `'other'` — nunca lanza, ver nota de diseño
 * en `EvidenceStore` sobre por qué la clasificación nunca rechaza nada.
 */
export function resolveEvidenceKind(extension: string): EvidenceKind {
  const normalized = extension.replace(/^\./, '').toLowerCase();
  return EXTENSION_TO_KIND[normalized] ?? 'other';
}
