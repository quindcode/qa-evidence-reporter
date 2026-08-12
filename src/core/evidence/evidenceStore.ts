import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

import { Jimp } from 'jimp';

import { resolveEvidenceKind } from '../types/evidence.js';
import type { EvidenceFile, EvidenceStore, SaveEvidenceInput } from '../types/evidence.js';

/** Ancho del thumbnail generado para imágenes, en píxeles (alto se ajusta manteniendo aspect ratio). */
const THUMBNAIL_WIDTH = 320;
/** Sufijo del archivo de thumbnail, agregado al nombre completo del original (ver ARCHITECTURE.md). */
const THUMBNAIL_SUFFIX = '.thumb.png';

/**
 * Punto de extensión para inyectar el procesamiento de imagen en
 * `createEvidenceStore` (usado por los tests para no depender de `jimp`
 * real, y en principio para poder reemplazar la estrategia de thumbnail sin
 * tocar `evidenceStore.ts`). Recibe el buffer original de una imagen y debe
 * devolver el buffer PNG del thumbnail ya redimensionado.
 */
export type ImageProcessor = (buffer: Buffer) => Promise<Buffer>;

export interface EvidenceStoreDeps {
  imageProcessor?: ImageProcessor;
}

/**
 * Factory del `EvidenceStore` de referencia: guarda archivos físicos bajo
 * `{baseDir}/...` y genera thumbnails de imagen con `jimp`.
 *
 * Decisión de diseño (`baseDir` como parámetro): igual que
 * `createSessionEngine` con `sessionFilePath` — `baseDir` es directamente la
 * carpeta raíz de evidencias ya resuelta (en producción real,
 * `resolve(projectRoot, config.evidenceDir)`, ver `qa-config.json` →
 * `evidenceDir`). Este módulo NO conoce `qa-config.json` ni asume ningún
 * nombre de carpeta fijo ("evidence") — decidir y resolver esa ruta es
 * responsabilidad exclusiva del caller (CLI/server), para que
 * `evidenceDir` sea realmente configurable de punta a punta.
 *
 * Decisión de diseño (id determinístico, no aleatorio): `EvidenceFile.id`
 * se deriva con un hash corto de `featureId:scenarioId:stepId:originalFilename`
 * (ver `computeEvidenceId` abajo). Esto es lo que permite que `list()` y
 * `getThumbnail()` reconstruyan la metadata completa escaneando el
 * filesystem, SIN mantener un índice separado en memoria ni en disco: dado
 * un archivo encontrado en
 * `evidence/{featureId}/{scenarioId}/{stepId}/{nombre}`, su id se puede
 * recalcular con la misma fórmula a partir de esos 4 valores, que son
 * exactamente los componentes de su propia ruta.
 *
 * `save()` deduplica `originalFilename` colisiones dentro del mismo step
 * ANTES de calcular el id (ver `resolveNonCollidingFilename` abajo) — la
 * fase anterior aceptaba deliberadamente que subir dos veces el mismo
 * nombre pisara el archivo previo (ver JSDoc viejo de `EvidenceFile.id` en
 * `core/types/evidence.ts`, actualizado junto con este cambio). Motivo real
 * para resolverlo ahora: pegar una imagen del portapapeles (`Ctrl+V`) le da
 * el mismo nombre genérico a CADA imagen pegada (típicamente `image.png`,
 * decisión del navegador, no algo que este código controle) — con el
 * comportamiento viejo, pegar una segunda imagen en el mismo step
 * silenciosamente reemplazaba la primera en vez de agregarse. La
 * deduplicación reutiliza `fileExists` (ya existente, usado por
 * `scanEvidenceTree`) para mantener la misma propiedad de "todo se puede
 * recalcular escaneando el filesystem, sin índice separado" — el nombre
 * deduplicado (p. ej. `image (1).png`) es el que efectivamente queda en
 * disco y el que se devuelve como `originalFilename`, así que no hay
 * ninguna metadata oculta que no esté ya en la ruta del archivo.
 */
export function createEvidenceStore(baseDir: string, deps: EvidenceStoreDeps = {}): EvidenceStore {
  const imageProcessor = deps.imageProcessor ?? defaultImageProcessor;
  const evidenceRoot = baseDir;

  async function save(input: SaveEvidenceInput): Promise<EvidenceFile> {
    const { featureId, scenarioId, stepId, buffer } = input;

    const stepDir = join(evidenceRoot, featureId, scenarioId, stepId);
    await mkdir(stepDir, { recursive: true });

    const originalFilename = await resolveNonCollidingFilename(stepDir, input.originalFilename);
    const filePath = join(stepDir, originalFilename);
    await writeFile(filePath, buffer);

    const kind = resolveEvidenceKind(extname(originalFilename));
    let thumbnailPath: string | undefined;

    if (kind === 'image') {
      thumbnailPath = await tryGenerateThumbnail(filePath, buffer, imageProcessor);
    }

    return {
      id: computeEvidenceId(featureId, scenarioId, stepId, originalFilename),
      originalFilename,
      path: toPortablePath(baseDir, filePath),
      kind,
      sizeBytes: buffer.length,
      thumbnailPath: thumbnailPath ? toPortablePath(baseDir, thumbnailPath) : undefined,
      uploadedAt: new Date().toISOString(),
    };
  }

  async function getThumbnail(evidenceFileId: string): Promise<string | null> {
    const files = await scanEvidenceTree(evidenceRoot, baseDir);
    const match = files.find((file) => file.id === evidenceFileId);
    return match?.thumbnailPath ?? null;
  }

  async function list(stepId: string): Promise<EvidenceFile[]> {
    const files = await scanEvidenceTree(evidenceRoot, baseDir, stepId);
    return files;
  }

  async function remove(stepId: string, evidenceFileId: string): Promise<void> {
    const files = await scanEvidenceTree(evidenceRoot, baseDir, stepId);
    const match = files.find((file) => file.id === evidenceFileId);
    if (!match) return;

    await unlinkIfExists(join(baseDir, match.path));
    if (match.thumbnailPath) {
      await unlinkIfExists(join(baseDir, match.thumbnailPath));
    }
  }

  return { save, getThumbnail, list, remove };
}

/** `unlink` que no lanza si el archivo ya no existe (borrado concurrente, o llamada repetida). */
async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Intenta generar el thumbnail de una imagen. Es "best effort": si
 * `imageProcessor` falla (p. ej. el archivo tiene extensión de imagen pero
 * no es una imagen válida/decodificable), no se propaga el error — la
 * evidencia original ya quedó guardada correctamente, y no tener thumbnail
 * degrada la UX (se mostraría un ícono genérico) pero no debe hacer fallar
 * todo el `save()`.
 */
async function tryGenerateThumbnail(
  filePath: string,
  buffer: Buffer,
  imageProcessor: ImageProcessor,
): Promise<string | undefined> {
  try {
    const thumbnailBuffer = await imageProcessor(buffer);
    const thumbnailPath = `${filePath}${THUMBNAIL_SUFFIX}`;
    await writeFile(thumbnailPath, thumbnailBuffer);
    return thumbnailPath;
  } catch {
    return undefined;
  }
}

async function defaultImageProcessor(buffer: Buffer): Promise<Buffer> {
  const image = await Jimp.read(buffer);
  image.resize({ w: THUMBNAIL_WIDTH });
  return image.getBuffer('image/png');
}

function computeEvidenceId(
  featureId: string,
  scenarioId: string,
  stepId: string,
  originalFilename: string,
): string {
  return createHash('sha256')
    .update(`${featureId}:${scenarioId}:${stepId}:${originalFilename}`)
    .digest('hex')
    .slice(0, 16);
}

/** Convierte una ruta absoluta a una ruta relativa a `baseDir`, siempre con `/` (portable entre OS). */
function toPortablePath(baseDir: string, absolutePath: string): string {
  return relative(baseDir, absolutePath).split(sep).join('/');
}

async function listSubdirectories(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Si `stepDir/filename` ya existe, agrega un sufijo numérico entre
 * paréntesis antes de la extensión (" (1)", " (2)", ...) — mismo criterio
 * que "guardar copia" en cualquier explorador de archivos — hasta encontrar
 * un nombre libre dentro de ese step. Si no hay colisión, devuelve
 * `filename` tal cual (comportamiento sin cambios para nombres únicos, que
 * es el caso normal de file picker/drag&drop con nombres reales).
 */
async function resolveNonCollidingFilename(stepDir: string, filename: string): Promise<string> {
  if (!(await fileExists(join(stepDir, filename)))) return filename;

  const extension = extname(filename);
  const base = filename.slice(0, filename.length - extension.length);

  let attempt = 1;
  let candidate = `${base} (${attempt})${extension}`;
  while (await fileExists(join(stepDir, candidate))) {
    attempt++;
    candidate = `${base} (${attempt})${extension}`;
  }
  return candidate;
}

/**
 * Recorre `evidenceRoot` completo (`evidence/{featureId}/{scenarioId}/{stepId}/*`)
 * reconstruyendo un `EvidenceFile` por cada archivo original encontrado (se
 * excluyen los propios `.thumb.png`). Es la implementación real de
 * `list`/`getThumbnail` (ver sus JSDoc en `core/types/evidence.ts` para el
 * razonamiento de "por qué escanear el filesystem en vez de mantener un
 * índice"). Si se pasa `onlyStepId`, filtra para no reconstruir metadata de
 * más steps de los necesarios.
 */
async function scanEvidenceTree(
  evidenceRoot: string,
  baseDir: string,
  onlyStepId?: string,
): Promise<EvidenceFile[]> {
  const results: EvidenceFile[] = [];

  for (const featureId of await listSubdirectories(evidenceRoot)) {
    const featureDir = join(evidenceRoot, featureId);
    for (const scenarioId of await listSubdirectories(featureDir)) {
      const scenarioDir = join(featureDir, scenarioId);
      for (const stepId of await listSubdirectories(scenarioDir)) {
        if (onlyStepId && stepId !== onlyStepId) continue;

        const stepDir = join(scenarioDir, stepId);
        const entries = await readdir(stepDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || entry.name.endsWith(THUMBNAIL_SUFFIX)) continue;

          results.push(
            await reconstructEvidenceFile(
              baseDir,
              stepDir,
              featureId,
              scenarioId,
              stepId,
              entry.name,
            ),
          );
        }
      }
    }
  }

  return results;
}

async function reconstructEvidenceFile(
  baseDir: string,
  stepDir: string,
  featureId: string,
  scenarioId: string,
  stepId: string,
  originalFilename: string,
): Promise<EvidenceFile> {
  const filePath = join(stepDir, originalFilename);
  const fileStat = await stat(filePath);
  const kind = resolveEvidenceKind(extname(originalFilename));

  const thumbnailPath = `${filePath}${THUMBNAIL_SUFFIX}`;
  const hasThumbnail = kind === 'image' && (await fileExists(thumbnailPath));

  // `birthtime` no está soportado en todos los filesystems (algunos
  // devuelven epoch 0); si pasa, se usa `mtime` como aproximación. Para
  // archivos reconstruidos desde disco (sin pasar por `save()` en este
  // mismo proceso) no existe otra fuente de verdad para `uploadedAt`.
  const uploadedAt = fileStat.birthtime.getTime() > 0 ? fileStat.birthtime : fileStat.mtime;

  return {
    id: computeEvidenceId(featureId, scenarioId, stepId, originalFilename),
    originalFilename,
    path: toPortablePath(baseDir, filePath),
    kind,
    sizeBytes: fileStat.size,
    thumbnailPath: hasThumbnail ? toPortablePath(baseDir, thumbnailPath) : undefined,
    uploadedAt: uploadedAt.toISOString(),
  };
}
