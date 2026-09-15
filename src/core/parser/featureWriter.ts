import { readFile as readFileFs, writeFile as writeFileFs } from 'node:fs/promises';

import { FeatureSourceDriftError } from '../types/errors.js';

/** Un único reemplazo de texto dirigido a una línea concreta del `.feature`. */
export interface TextEdit {
  /** Línea 1-based (ver `ParsedStep.sourceLocation`/`ParsedScenario.sourceLocation`). */
  line: number;
  /** Texto que se espera encontrar al final de esa línea ANTES de editar. */
  oldText: string;
  /** Texto nuevo que reemplaza a `oldText`. */
  newText: string;
}

/** Edits a aplicar sobre un único scenario dentro de un `.feature`. */
export interface ScenarioTextEdit {
  /** Renombrar el `Scenario:`/`Escenario:` — omitido si el nombre no cambia. */
  name?: TextEdit;
  /** Reescribir el texto de uno o más steps propios del scenario. */
  steps: TextEdit[];
}

/**
 * Aplica `edit` sobre el contenido `source` de un `.feature`, reescribiendo
 * SOLO las líneas indicadas — nunca reserializa el archivo completo (evitaría
 * el riesgo de reformatear comentarios/espaciado de scenarios que no se están
 * editando).
 *
 * Estrategia deliberadamente simple (reemplazo de sufijo de línea, no
 * aritmética de columnas): para cada `TextEdit`, la línea `line` debe
 * terminar (ignorando espacio en blanco final) exactamente en `oldText`
 * (ignorando su propio espacio en blanco final) — ese es el texto que la
 * sesión tenía guardado antes de este edit, y coincidir con él es la
 * verificación de que el archivo no cambió por fuera desde entonces. Si
 * coincide, se reemplaza ese sufijo por `newText`, preservando indentación y
 * keyword (`Given `/`Dado `/`Scenario: `/etc.) tal cual estaban. Si CUALQUIER
 * línea del lote no coincide, no se escribe nada — se lanza
 * `FeatureSourceDriftError` con la primera línea que falló.
 *
 * Preserva el estilo de fin de línea del archivo (`\r\n` si el archivo ya
 * usa `\r\n` en algún lado, `\n` si no) — el proyecto ya tiene cuidado
 * especial con rutas/archivos en Windows (ver commits recientes sobre
 * evidencia), mismo criterio acá.
 */
export function applyFeatureTextEdit(
  source: string,
  filePath: string,
  edit: ScenarioTextEdit,
): string {
  const usesCrlf = source.includes('\r\n');
  const lines = source.split(/\r\n|\n/);
  const edits = edit.name ? [edit.name, ...edit.steps] : edit.steps;

  for (const { line, oldText, newText } of edits) {
    const index = line - 1;
    const original = lines[index];
    if (original === undefined) {
      throw new FeatureSourceDriftError(filePath, line);
    }

    const trimmedOld = oldText.trimEnd();
    const trimmedOriginal = original.trimEnd();
    if (trimmedOld.length === 0 || !trimmedOriginal.endsWith(trimmedOld)) {
      throw new FeatureSourceDriftError(filePath, line);
    }

    const prefix = original.slice(0, trimmedOriginal.length - trimmedOld.length);
    lines[index] = prefix + newText;
  }

  return lines.join(usesCrlf ? '\r\n' : '\n');
}

/** Punto de extensión mínimo para inyectar I/O en tests, mismo patrón que `GherkinParserDeps`. */
export interface FeatureWriterDeps {
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
}

export interface FeatureWriter {
  /**
   * Lee `filePath`, aplica `edit` (ver `applyFeatureTextEdit`) y escribe el
   * resultado de vuelta al mismo archivo. Si `edit` no aplica limpiamente
   * (archivo cambió, o construcción no soportada), lanza
   * `FeatureSourceDriftError` y NO escribe nada.
   */
  updateScenario(filePath: string, edit: ScenarioTextEdit): Promise<void>;
}

/** Factory de referencia de `FeatureWriter`, análoga a `createGherkinParser`. */
export function createFeatureWriter(deps: FeatureWriterDeps = {}): FeatureWriter {
  const readFile = deps.readFile ?? ((filePath: string) => readFileFs(filePath, 'utf-8'));
  const writeFile = deps.writeFile ?? ((filePath: string, content: string) =>
    writeFileFs(filePath, content, 'utf-8'));

  async function updateScenario(filePath: string, edit: ScenarioTextEdit): Promise<void> {
    const source = await readFile(filePath);
    const updated = applyFeatureTextEdit(source, filePath, edit);
    await writeFile(filePath, updated);
  }

  return { updateScenario };
}
