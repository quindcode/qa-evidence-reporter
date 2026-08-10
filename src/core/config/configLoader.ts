import { readFile as readFileFs } from 'node:fs/promises';

import { QaConfigSchema } from '../types/config.js';
import type { QaConfig } from '../types/config.js';
import { ConfigNotFoundError, ConfigValidationError } from '../types/errors.js';
import type { ConfigValidationIssue } from '../types/errors.js';

/**
 * Punto de extensión mínimo para inyectar dependencias en
 * `createConfigLoader`, mismo patrón que `GherkinParserDeps.readFile`
 * (`core/parser/gherkinParser.ts`): por defecto lee del filesystem real, los
 * tests pueden inyectar una lectura en memoria sin tocar disco.
 */
export interface ConfigLoaderDeps {
  /** Por defecto `(filePath) => readFile(filePath, 'utf-8')`. */
  readFile?: (filePath: string) => Promise<string>;
}

/** Puerto mínimo devuelto por `createConfigLoader`. */
export interface ConfigLoader {
  /**
   * Lee `configFilePath`, lo parsea como JSON y lo valida contra
   * `QaConfigSchema`.
   *
   * Decisión de diseño ("archivo inexistente" vs "asumir defaults"): a
   * diferencia de, por ejemplo, `git config` (que sí puede operar sin
   * archivo, usando todos los defaults en silencio), `loadConfig` es
   * ESTRICTO: si `configFilePath` no existe, lanza `ConfigNotFoundError` en
   * vez de devolver `QaConfigSchema.parse({})`. Motivo: en este mismo
   * paquete, el comando `init` de `adapters/cli` es quien crea
   * `qa-config.json` la primera vez (con `featuresDir`/`evidenceDir`/
   * `reportsDir` ya materializados como carpetas reales en disco, ver
   * `adapters/cli/commands/init.ts`). Si `run`/`report` asumieran defaults
   * silenciosos ante un archivo faltante, correrían igual pero apuntando a
   * carpetas que pueden no existir (o, peor, a las del cwd equivocado si el
   * usuario ejecuta el comando desde el lugar equivocado) sin ninguna señal
   * de que algo no se inicializó — un error temprano y explícito ("correé
   * init primero") es más accionable que un comportamiento silenciosamente
   * degradado. Mismo criterio que `SessionEngine.load()` con
   * `SessionNotFoundError` (ver su JSDoc en `core/types/session.ts`).
   *
   * Cualquier error de validación (JSON inválido, o JSON válido que no
   * cumple `QaConfigSchema`) se envuelve en `ConfigValidationError` con la
   * lista COMPLETA de problemas encontrados.
   */
  loadConfig(configFilePath: string): Promise<QaConfig>;
}

/**
 * Factory de `ConfigLoader`. Se eligió el mismo patrón de factory que
 * `createGherkinParser`/`createSessionEngine`/`createEvidenceStore`/
 * `createReportGenerator` (en vez de una función suelta `loadConfig(path)`)
 * por dos motivos: (1) consistencia — todo el resto de `core/**` expone sus
 * puertos así, y un caller de `adapters/cli` que ya conoce ese patrón no
 * necesita aprender uno distinto solo para config; (2) testabilidad — poder
 * inyectar `readFile` (ver `ConfigLoaderDeps`) sin tocar el filesystem real,
 * igual que hacen los tests de `gherkinParser.test.ts`. No hay estado
 * mutable interno (a diferencia de `SessionEngine`): cada llamada a
 * `loadConfig` es independiente, así que la factory solo existe para cerrar
 * sobre `deps`.
 */
export function createConfigLoader(deps: ConfigLoaderDeps = {}): ConfigLoader {
  const readFile = deps.readFile ?? ((filePath: string) => readFileFs(filePath, 'utf-8'));

  async function loadConfig(configFilePath: string): Promise<QaConfig> {
    let raw: string;
    try {
      raw = await readFile(configFilePath);
    } catch (error) {
      throw new ConfigNotFoundError(configFilePath, { cause: error });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new ConfigValidationError(
        [
          {
            path: '',
            message: `el archivo no contiene JSON válido (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
        { cause: error },
      );
    }

    const result = QaConfigSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new ConfigValidationError(toIssues(result.error), { cause: result.error });
    }

    return result.data;
  }

  return { loadConfig };
}

function toIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ConfigValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
